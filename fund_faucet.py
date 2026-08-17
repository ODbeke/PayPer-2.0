import sys
import json
from pathlib import Path
from eth_account import Account

try:
    from genlayer_py import create_client
    from genlayer_py.chains import studionet, localnet, testnet_bradbury, testnet_asimov
except ImportError:
    print("Error: genlayer SDK not found in path.")
    sys.exit(1)

# Helper to dynamically read network from gltest.config.yaml
def get_config_network():
    yaml_path = Path(__file__).parent / "gltest.config.yaml"
    if yaml_path.exists():
        try:
            with open(yaml_path, "r") as f:
                for line in f:
                    if line.strip().startswith("network:"):
                        return line.split(":", 1)[1].strip()
        except Exception:
            pass
    return "localnet"

def main():
    print("=== GenLayer PayPer Faucet Funding Utility ===")
    
    # Load contracts.json
    config_path = Path("contracts.json")
    if not config_path.exists():
        print("Error: contracts.json not found. Deploy your contracts first.")
        return
        
    with open(config_path, "r") as f:
        config = json.load(f)
        
    faucet_addr = config.get("faucet")
    if not faucet_addr:
        print("Error: Faucet contract address not found in contracts.json")
        return
        
    print(f"Target Faucet Contract: {faucet_addr}")
    
    # Prompt for private key
    pkey = input("Enter the private key of the account funding the faucet (0x...): ").strip()
    if not pkey.startswith("0x"):
        pkey = "0x" + pkey
        
    try:
        acc = Account.from_key(pkey)
        print(f"Funding Account Address: {acc.address}")
    except Exception as e:
        print(f"Error parsing private key: {e}")
        return
        
    # Prompt for amount
    try:
        amt_gen = float(input("Enter amount of GEN to deposit (e.g. 50): ").strip())
        value_wei = int(amt_gen * 10**18)
    except ValueError:
        print("Invalid amount.")
        return
        
    print(f"Depositing {amt_gen} GEN ({value_wei} Wei) to Faucet...")
    
    # Determine network
    net_name = get_config_network()
    chain_map = {
        "localnet": localnet,
        "studionet": studionet,
        "testnet_bradbury": testnet_bradbury,
        "testnet_asimov": testnet_asimov
    }
    selected_chain = chain_map.get(net_name, localnet)
    print(f"Connecting to network: {net_name}")
    
    try:
        client = create_client(chain=selected_chain, account=acc)
        
        # Check current balance of funding account via JSON-RPC
        resp = client.provider.make_request("eth_getBalance", [acc.address, "latest"])
        bal_hex = resp.get("result", "0x0")
        bal_wei = int(bal_hex, 16)
        
        print(f"Current funding account balance: {bal_wei / 10**18} GEN")
        if bal_wei < value_wei:
            print("Error: Insufficient balance to fund the faucet contract.")
            return
            
        print("Broadcasting payable transaction...")
        tx_hash = client.write_contract(
            address=faucet_addr,
            function_name="deposit_faucet_funds",
            account=acc,
            value=value_wei,
            args=[]
        )
        print(f"Transaction submitted! Hash: {tx_hash}")
        print("Waiting for confirmation on GenLayer network...")
        client.wait_for_transaction_receipt(tx_hash)
        print("Faucet funded successfully!")
        
        # Fetch new contract balance
        new_bal = client.read_contract(
            address=faucet_addr,
            function_name="get_faucet_balance"
        )
        print(f"Updated Faucet Reservoir Balance: {int(new_bal) / 10**18} GEN")
        
    except Exception as e:
        print(f"Transaction failed: {e}")

if __name__ == "__main__":
    main()
