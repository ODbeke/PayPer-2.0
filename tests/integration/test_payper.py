from gltest import get_contract_factory, create_account
from gltest.assertions import tx_execution_succeeded, tx_execution_failed
import sys
import pytest
from pathlib import Path

# Add contracts path to sys.path to test internal methods directly
contracts_dir = str(Path(__file__).parent.parent.parent / "contracts")
if contracts_dir not in sys.path:
    sys.path.insert(0, contracts_dir)

def test_payper_faucet_lifecycle():
    # Deploy Faucet contract
    faucet_factory = get_contract_factory("PayPerFaucet")
    faucet = faucet_factory.deploy(args=[])
    
    owner = create_account()
    user = create_account()
    
    # 1. Fund the faucet (deposit 100 GEN = 100 * 10^18 Wei)
    fund_amt = 100 * 10**18
    rc_fund = faucet.connect(owner).deposit_faucet_funds().transact(value=fund_amt)
    assert tx_execution_succeeded(rc_fund)
    
    # Verify balance
    bal = faucet.get_faucet_balance().call()
    assert int(bal) == fund_amt

    # 2. User requests faucet (should succeed and get 20 GEN)
    rc_req = faucet.connect(user).request_faucet(args=[user.address]).transact()
    if not tx_execution_succeeded(rc_req):
        import pprint
        raise Exception(f"Faucet request failed! Receipt:\n{pprint.pformat(rc_req)}")
    
    # Check updated balance
    bal_after = faucet.get_faucet_balance().call()
    assert int(bal_after) == fund_amt - (20 * 10**18)
    
    # 3. User requests again on the same day (should fail)
    rc_req_fail = faucet.connect(user).request_faucet(args=[user.address]).transact()
    assert tx_execution_failed(rc_req_fail)

def test_payper_marketplace_escrow_lifecycle():
    # Deploy contracts
    registry_factory = get_contract_factory("PayPerRegistry")
    registry = registry_factory.deploy(args=[])
    
    escrow_factory = get_contract_factory("PayPerEscrow")
    escrow = escrow_factory.deploy(args=[registry.address])
    
    # Set escrow address in registry
    rc_escrow_set = registry.set_escrow_address(args=[escrow.address]).transact()
    assert tx_execution_succeeded(rc_escrow_set)

    buyer = create_account()
    seller = create_account()
    service_contract_address = create_account().address

    # 1. Seller registers service in the registry
    price_wei = 1 * 10**16  # 0.01 GEN
    rc_reg = registry.connect(seller).register_service(
        args=[
            service_contract_address,
            "Summarization Service",
            price_wei,
            "summarization",
            "Summarizes text using LLM in 3 sentences."
        ]
    ).transact()
    assert tx_execution_succeeded(rc_reg)
    
    # Check service in registry
    services = registry.get_services().call()
    assert len(services) == 1
    assert services[0]["name"] == "Summarization Service"
    assert services[0]["price"] == price_wei

    # 2. Buyer deposits GEN into escrow
    deposit_amt = 5 * 10**16  # 0.05 GEN
    rc_dep = escrow.connect(buyer).deposit().transact(value=deposit_amt)
    assert tx_execution_succeeded(rc_dep)
    
    buyer_bal = escrow.get_deposit(args=[buyer.address]).call()
    assert int(buyer_bal) == deposit_amt

    # 3. Buyer approves the service seller
    rc_approve = escrow.connect(buyer).approve_seller(
        args=[seller.address, deposit_amt]
    ).transact()
    assert tx_execution_succeeded(rc_approve)
    
    allowance = escrow.get_allowance(args=[buyer.address, seller.address]).call()
    assert int(allowance) == deposit_amt

    # 4. Seller claims payment for a successful task execution
    claim_val = price_wei
    rc_claim = escrow.connect(seller).claim_payment(
        args=[
            buyer.address,
            claim_val,
            180, # response_time_ms
            "Please summarize this long document.", # input
            "This is the summary output of the document.", # output
            "Must return a summary of at least 1 sentence." # criteria
        ]
    ).transact()
    assert tx_execution_succeeded(rc_claim)
    
    # Check claim status
    claims = escrow.get_claims(args=[0]).call()
    assert len(claims) == 1
    claim_id = claims[0]["id"]
    assert claims[0]["status"] == "PENDING"
    assert int(claims[0]["amount"]) == claim_val

    # 5. Buyer releases the claim
    rc_release = escrow.connect(buyer).release_claim(args=[claim_id]).transact(wait_triggered_transactions=True)
    if not tx_execution_succeeded(rc_release):
        import pprint
        raise Exception(f"Release claim failed! Receipt:\n{pprint.pformat(rc_release)}")
    
    # Check finalized claim status
    final_claim = escrow.get_claim(args=[claim_id]).call()
    assert final_claim["status"] == "SETTLED"
    
    # Check registry updated stats
    svc_data = registry.get_service(args=[service_contract_address]).call()
    assert int(svc_data["total_calls"]) == 1
    assert int(svc_data["success_rate"]) == 100
    assert int(svc_data["rating"]) == 50

def test_verdict_parser_parsing():
    from payper_escrow import _parse_verdict
    
    # Valid VALID verdict
    val_res = _parse_verdict('{"verdict": "VALID", "reason": "Successful completion"}')
    assert val_res["verdict"] == "VALID"
    assert val_res["reason"] == "Successful completion"
    
    # Valid INVALID verdict
    inval_res = _parse_verdict('{"verdict": "INVALID", "reason": "Returned system error"}')
    assert inval_res["verdict"] == "INVALID"
    assert inval_res["reason"] == "Returned system error"
    
    # Malformed verdict
    with pytest.raises(Exception):
        _parse_verdict('{"verdict": "UNKNOWN", "reason": "broken"}')
