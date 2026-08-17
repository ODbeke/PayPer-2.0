# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json

# Fallback definition for local Python import compatibility in tests
try:
    u256
except NameError:
    u256 = int

try:
    gl
except NameError:
    class MockVM:
        class UserError(Exception):
            def __init__(self, message):
                self.message = message
                super().__init__(message)
    class MockWriteDecorator:
        def __call__(self, func):
            return func
        def payable(self, func):
            return func
    class MockPublicDecorator:
        write = MockWriteDecorator()
        def view(self, func):
            return func
    class MockGL:
        vm = MockVM
        public = MockPublicDecorator()
        class Contract:
            pass
    gl = MockGL()

ERR_EXPECTED_INPUT = "[EXPECTED_INPUT]"
ERR_CONVERGENCE_FAIL = "[CONVERGENCE_FAIL]"

def _parse_verdict(raw_output) -> dict:
    """Parses the JSON verdict from the AI jury."""
    if isinstance(raw_output, str):
        left_idx, right_idx = raw_output.find("{"), raw_output.rfind("}")
        if left_idx < 0 or right_idx < 0:
            raise gl.vm.UserError(f"{ERR_CONVERGENCE_FAIL} Could not locate JSON object in AI response.")
        raw_output = json.loads(raw_output[left_idx:right_idx + 1])
        
    if not isinstance(raw_output, dict):
        raise gl.vm.UserError(f"{ERR_CONVERGENCE_FAIL} Extracted response is not a dict.")
        
    verdict = str(raw_output.get("verdict", "")).strip().upper()
    if verdict not in ("VALID", "INVALID"):
        raise gl.vm.UserError(f"{ERR_CONVERGENCE_FAIL} Invalid verdict: {verdict}. Must be VALID or INVALID.")
        
    reason = str(raw_output.get("reason", "")).strip()[:240]
    return {"verdict": verdict, "reason": reason}

class PayPerEscrow(gl.Contract):
    owner: Address
    registry_address: Address
    deposits: TreeMap[str, u256]         # Maps buyer (hex) -> deposited balance (Wei)
    allowances: TreeMap[str, u256]       # Maps buyer_hex + ":" + seller_hex -> remaining authorized allowance (Wei)
    claims: TreeMap[str, str]            # Maps claim_id -> JSON string of Claim record
    claim_ids: DynArray[str]             # List of all claim IDs
    total_claims: u256

    def __init__(self, registry_address: str) -> None:
        self.owner = gl.message.sender_address
        self.registry_address = Address(registry_address)
        self.total_claims = u256(0)

    @gl.public.write.payable
    def deposit(self) -> None:
        """Allows buyers to deposit GEN tokens to fund their service usage."""
        buyer = gl.message.sender_address.as_hex.lower()
        amount = gl.message.value
        assert amount > 0, "Deposit amount must be greater than zero"
        
        current_dep = self.deposits.get(buyer, u256(0))
        self.deposits[buyer] = current_dep + amount

    @gl.public.write
    def withdraw_deposit(self, amount_wei: int) -> None:
        """Allows buyers to withdraw their unused GEN deposit."""
        buyer = gl.message.sender_address.as_hex.lower()
        amt = u256(amount_wei)
        current_dep = self.deposits.get(buyer, u256(0))
        assert current_dep >= amt, "Insufficient deposited funds"

        self.deposits[buyer] = current_dep - amt
        gl.transfer(gl.message.sender_address, amt)

    @gl.public.write
    def approve_seller(self, seller_address: str, allowance_wei: int) -> None:
        """Pre-authorizes a specific seller for a maximum spending allowance."""
        buyer = gl.message.sender_address.as_hex.lower()
        seller = Address(seller_address).as_hex.lower()
        key = buyer + ":" + seller
        self.allowances[key] = u256(allowance_wei)

    @gl.public.write
    def claim_payment(
        self,
        buyer_address: str,
        amount_wei: int,
        response_time_ms: int,
        input_payload: str,
        output_payload: str,
        criteria: str
    ) -> str:
        """Called by the seller to submit a claim for a performed task."""
        seller = gl.message.sender_address.as_hex.lower()
        buyer = Address(buyer_address).as_hex.lower()
        amt = u256(amount_wei)
        key = buyer + ":" + seller

        # Validate allowance and deposit
        allowance = self.allowances.get(key, u256(0))
        assert allowance >= amt, "Claim exceeds authorized seller allowance"
        
        deposit = self.deposits.get(buyer, u256(0))
        assert deposit >= amt, "Buyer has insufficient deposit balance"

        # Update allowance and lock deposit amount
        self.allowances[key] = allowance - amt
        self.deposits[buyer] = deposit - amt

        # Create Claim Record
        self.total_claims += u256(1)
        claim_id = f"C{int(self.total_claims)}"
        
        claim = {
            "id": claim_id,
            "buyer": buyer,
            "seller": seller,
            "amount": int(amt),
            "response_time_ms": int(response_time_ms),
            "input": input_payload,
            "output": output_payload,
            "criteria": criteria,
            "status": "PENDING", # PENDING, SETTLED, DISPUTED, REFUNDED
            "timestamp": gl.message_raw["datetime"],
            "verdict_reason": ""
        }

        self.claims[claim_id] = json.dumps(claim)
        self.claim_ids.append(claim_id)
        return claim_id

    @gl.public.write
    def release_claim(self, claim_id: str) -> None:
        """Releases the locked claim payment to the seller."""
        assert claim_id in self.claims, "Claim ID not found"
        claim = json.loads(self.claims[claim_id])
        assert claim["status"] == "PENDING", "Claim is not in PENDING state"
        
        # Only the buyer or seller can release
        caller = gl.message.sender_address.as_hex.lower()
        assert caller == claim["buyer"] or caller == claim["seller"], "Unauthorized"

        claim["status"] = "SETTLED"
        self.claims[claim_id] = json.dumps(claim)

        # Execute transfer to seller
        gl.transfer(Address(claim["seller"]), u256(claim["amount"]))

        # Report execution success to registry
        registry = gl.get_contract_at(self.registry_address.as_hex)
        registry.emit(on='finalized').record_execution(
            claim["seller"],
            True,
            claim["response_time_ms"],
            claim["amount"]
        )

    @gl.public.write
    def dispute_claim(self, claim_id: str) -> None:
        """Triggers AI arbitration on a pending claim."""
        assert claim_id in self.claims, "Claim ID not found"
        claim = json.loads(self.claims[claim_id])
        assert claim["status"] == "PENDING", "Claim must be PENDING to dispute"
        
        # Only the buyer can file a dispute
        caller = gl.message.sender_address.as_hex.lower()
        assert caller == claim["buyer"], "Only the buyer can dispute a claim"

        # Adjudicate via GenLayer AI validator jury
        verdict = self._arbitrate(claim["input"], claim["output"], claim["criteria"])
        
        if verdict["verdict"] == "VALID":
            # Seller wins dispute: Release funds
            claim["status"] = "SETTLED"
            claim["verdict_reason"] = verdict["reason"]
            self.claims[claim_id] = json.dumps(claim)
            
            gl.transfer(Address(claim["seller"]), u256(claim["amount"]))
            
            # Record execution success
            registry = gl.get_contract_at(self.registry_address.as_hex)
            registry.emit(on='finalized').record_execution(
                claim["seller"],
                True,
                claim["response_time_ms"],
                claim["amount"]
            )
        else:
            # Buyer wins dispute: Refund buyer
            claim["status"] = "REFUNDED"
            claim["verdict_reason"] = verdict["reason"]
            self.claims[claim_id] = json.dumps(claim)
            
            # Return funds to buyer's deposit
            buyer_hex = claim["buyer"]
            current_dep = self.deposits.get(buyer_hex, u256(0))
            self.deposits[buyer_hex] = current_dep + u256(claim["amount"])

            # Record execution failure in registry
            registry = gl.get_contract_at(self.registry_address.as_hex)
            registry.emit(on='finalized').record_execution(
                claim["seller"],
                False,
                claim["response_time_ms"],
                claim["amount"]
            )

    # --- Internal AI Court Adjudication ---

    def _arbitrate(self, input_payload: str, output_payload: str, criteria: str) -> dict:
        """Coordinates the on-chain validator consensus to evaluate the claim."""
        prompt = f"""You are the impartial JUDGE of an on-chain AI service marketplace (PayPer 2.0). 
A buyer has disputed a payment claim made by a seller.
Determine if the seller's output payload successfully complied with the input request and the service validation criteria.

INPUT REQUEST:
\"\"\"{input_payload}\"\"\"

SELLER RESPONSE OUTPUT:
\"\"\"{output_payload}\"\"\"

VALIDATION CRITERIA:
\"\"\"{criteria}\"\"\"

DECISION CRITERIA:
1. Output exactly one valid JSON object and nothing else.
2. If the seller's output is valid, has completed the task, is not an error message/empty response, and satisfies the validation criteria, return VALID.
3. If the seller's output failed, contains error messages, is empty, is garbage, or violates the criteria, return INVALID.

Respond with ONLY this JSON format:
{{"verdict": "VALID" | "INVALID", "reason": "<one short sentence explaining your judgment>"}}"""

        def leader_fn():
            raw_result = gl.nondet.exec_prompt(prompt, response_format="json")
            return _parse_verdict(raw_result)

        def validator_fn(leader_res: gl.vm.Result) -> bool:
            if not isinstance(leader_res, gl.vm.Return):
                return False
            local_val = leader_fn()
            leader_val = leader_res.calldata
            return local_val["verdict"] == leader_val.get("verdict")

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    # --- View Methods ---

    @gl.public.view
    def get_deposit(self, user_address: str) -> u256:
        """Returns the deposited balance of a buyer in Wei."""
        return self.deposits.get(Address(user_address).as_hex.lower(), u256(0))

    @gl.public.view
    def get_allowance(self, buyer_address: str, seller_address: str) -> u256:
        """Returns the remaining allowance approved for a seller in Wei."""
        buyer = Address(buyer_address).as_hex.lower()
        seller = Address(seller_address).as_hex.lower()
        return self.allowances.get(buyer + ":" + seller, u256(0))

    @gl.public.view
    def get_claims(self, start: u256) -> list:
        """Retrieves a page of claims, ordered newest first."""
        out = []
        n = len(self.claim_ids)
        idx = n - 1 - int(start)
        while idx >= 0 and len(out) < 20:
            out.append(json.loads(self.claims[self.claim_ids[idx]]))
            idx -= 1
        return out

    @gl.public.view
    def get_claim(self, claim_id: str) -> dict:
        """Retrieves details of a single claim."""
        assert claim_id in self.claims, "Claim ID not found"
        return json.loads(self.claims[claim_id])
