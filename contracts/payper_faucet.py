# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

# Fallback definition for local Python import compatibility in tests
try:
    u256
except NameError:
    u256 = int

class PayPerFaucet(gl.Contract):
    owner: Address
    last_requests: TreeMap[str, str] # Maps recipient address (hex) -> last request date (YYYY-MM-DD)

    def __init__(self) -> None:
        self.owner = gl.message.sender_address

    @gl.public.write
    def request_faucet(self, recipient_address: str) -> None:
        """Dispenses exactly 20 GEN to the recipient. Limit: once per calendar day (UTC)."""
        clean_addr = Address(recipient_address).as_hex.lower()
        
        # Get current date from transaction timestamp (YYYY-MM-DD)
        dt_str = gl.message_raw["datetime"]
        assert len(dt_str) >= 10, "Invalid transaction datetime metadata"
        current_date = dt_str[:10]

        # Enforce rate limit (once per calendar day UTC)
        last_date = self.last_requests.get(clean_addr, "")
        assert last_date != current_date, "Faucet limit reached. Try again tomorrow!"

        # Fund amount: 20 GEN = 20 * 10^18 Wei
        payout_amt = u256(20000000000000000000)
        
        # Verify contract has enough funds
        contract_bal = gl.get_balance(gl.get_address())
        assert contract_bal >= payout_amt, "Faucet reservoir is dry! Please notify the owner."

        # Execute transfer
        gl.transfer(Address(clean_addr), payout_amt)

        # Update last request date
        self.last_requests[clean_addr] = current_date

    @gl.public.write.payable
    def deposit_faucet_funds(self) -> None:
        """Allows anyone to fund the faucet reservoir."""
        assert gl.message.value > 0, "Deposit amount must be greater than zero"

    @gl.public.view
    def get_faucet_balance(self) -> u256:
        """Returns the current balance of the faucet in Wei."""
        return gl.get_balance(gl.get_address())

    @gl.public.view
    def get_last_request_date(self, user_address: str) -> str:
        """Returns the date of the last faucet request for a user."""
        clean_addr = Address(user_address).as_hex.lower()
        return self.last_requests.get(clean_addr, "")
