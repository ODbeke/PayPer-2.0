import sys
import os
import json
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Add current workspace to path to resolve any contract imports
sys.path.insert(0, str(Path(__file__).parent))

try:
    from genlayer_py import create_client, create_account
    from eth_account import Account
except ImportError:
    print("Error: genlayer SDK not found in path.")
    sys.exit(1)

# Default Local RPC URL
RPC_URL = "http://127.0.0.1:4000/api"

# Initialize deterministic deployer account for backend contract deployments
deployer_private_key = "0x" + "b" * 64  # Deterministic private key
deployer_account = Account.from_key(deployer_private_key)

print(f"Initializing GenLayer client with deployer account: {deployer_account.address}")
client = create_client(endpoint=RPC_URL, account=deployer_account)

try:
    print(f"Funding deployer account on localnet...")
    client.fund_account(deployer_account.address, 1000 * 10**18)
except Exception as e:
    print(f"Warning: could not fund account on localnet: {e}")

CONFIG_PATH = Path(__file__).parent / "contracts.json"

# Deployed addresses state
deployed_contracts = {
    "registry": "",
    "escrow": "",
    "faucet": ""
}

def load_config():
    global deployed_contracts
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r") as f:
                data = json.load(f)
                deployed_contracts.update(data)
                print(f"Loaded contract configuration: {deployed_contracts}")
        except Exception as e:
            print(f"Error loading contracts.json: {e}")

def save_config():
    try:
        with open(CONFIG_PATH, "w") as f:
            json.dump(deployed_contracts, f, indent=2)
            print("Saved contract configuration to contracts.json")
    except Exception as e:
        print(f"Error saving contracts.json: {e}")

class GenLayerAPIHandler(BaseHTTPRequestHandler):
    def _set_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(200)
        self._set_cors_headers()
        self.end_headers()

    def send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self._set_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def send_error_json(self, message):
        self.send_json(500, {"error": str(message)})

    def get_post_data(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)
        return json.loads(post_data.decode('utf-8'))

    def do_GET(self):
        parsed_path = urlparse(self.path)
        path = parsed_path.path
        query = parse_qs(parsed_path.query)

        try:
            if path == "/api/config":
                self.send_json(200, deployed_contracts)
                return

            elif path == "/api/faucet/balance":
                if not deployed_contracts["faucet"]:
                    self.send_json(400, {"error": "Faucet not deployed"})
                    return
                faucet_inst = client.get_contract_at(deployed_contracts["faucet"])
                bal = faucet_inst.get_faucet_balance().call()
                self.send_json(200, {"balance": int(bal)})
                return

            elif path == "/api/registry/services":
                if not deployed_contracts["registry"]:
                    self.send_json(200, [])
                    return
                reg_inst = client.get_contract_at(deployed_contracts["registry"])
                services = reg_inst.get_services().call()
                # Convert address types to strings
                formatted_services = []
                for s in services:
                    formatted_services.append({
                        "address": s["address"],
                        "seller": s["seller"],
                        "name": s["name"],
                        "price": int(s["price"]),
                        "category": s["category"],
                        "description": s["description"],
                        "total_calls": int(s["total_calls"]),
                        "success_rate": int(s["success_rate"]),
                        "rating": int(s["rating"]),
                        "active": s["active"]
                    })
                self.send_json(200, formatted_services)
                return

            elif path == "/api/escrow/deposit":
                user = query.get("user", [None])[0]
                if not user:
                    self.send_json(400, {"error": "Missing user address query parameter"})
                    return
                if not deployed_contracts["escrow"]:
                    self.send_json(400, {"error": "Escrow not deployed"})
                    return
                escrow_inst = client.get_contract_at(deployed_contracts["escrow"])
                dep = escrow_inst.get_deposit(args=[user]).call()
                self.send_json(200, {"deposit": int(dep)})
                return

            elif path == "/api/escrow/allowance":
                buyer = query.get("buyer", [None])[0]
                seller = query.get("seller", [None])[0]
                if not buyer or not seller:
                    self.send_json(400, {"error": "Missing buyer or seller address parameters"})
                    return
                if not deployed_contracts["escrow"]:
                    self.send_json(400, {"error": "Escrow not deployed"})
                    return
                escrow_inst = client.get_contract_at(deployed_contracts["escrow"])
                allowance = escrow_inst.get_allowance(args=[buyer, seller]).call()
                self.send_json(200, {"allowance": int(allowance)})
                return

            elif path == "/api/escrow/claims":
                if not deployed_contracts["escrow"]:
                    self.send_json(200, [])
                    return
                escrow_inst = client.get_contract_at(deployed_contracts["escrow"])
                claims = escrow_inst.get_claims(args=[0]).call()
                self.send_json(200, claims)
                return

            # Catch-all
            self.send_json(404, {"error": "Not Found"})

        except Exception as e:
            self.send_error_json(e)

    def do_POST(self):
        parsed_path = urlparse(self.path)
        path = parsed_path.path

        try:
            if path == "/api/deploy":
                # Deploy Registry
                print("Deploying PayPerRegistry...")
                with open("contracts/payper_registry.py", "r") as f:
                    registry_code = f.read()
                
                reg_hash = client.deploy_contract(code=registry_code)
                reg_receipt = client.wait_for_transaction_receipt(reg_hash)
                registry_address = reg_receipt["to_address"]
                deployed_contracts["registry"] = registry_address
                print(f"Registry deployed at: {registry_address}")

                # Deploy Faucet
                print("Deploying PayPerFaucet...")
                with open("contracts/payper_faucet.py", "r") as f:
                    faucet_code = f.read()
                
                faucet_hash = client.deploy_contract(code=faucet_code)
                faucet_receipt = client.wait_for_transaction_receipt(faucet_hash)
                faucet_address = faucet_receipt["to_address"]
                deployed_contracts["faucet"] = faucet_address
                print(f"Faucet deployed at: {faucet_address}")

                # Deploy Escrow
                print("Deploying PayPerEscrow...")
                with open("contracts/payper_escrow.py", "r") as f:
                    escrow_code = f.read()
                
                escrow_hash = client.deploy_contract(code=escrow_code, args=[registry_address])
                escrow_receipt = client.wait_for_transaction_receipt(escrow_hash)
                escrow_address = escrow_receipt["to_address"]
                deployed_contracts["escrow"] = escrow_address
                print(f"Escrow deployed at: {escrow_address}")

                # Configure Registry Escrow Address
                print("Setting escrow address in Registry...")
                reg_inst = client.get_contract_at(registry_address)
                # Fund faucet with some tokens from default genesis deployer
                # GenVM default genesis deployer is the primary account of create_account() / client
                reg_inst.set_escrow_address(args=[escrow_address]).transact()

                # Fund Faucet with 100 GEN
                print("Funding Faucet with 100 GEN...")
                faucet_inst = client.get_contract_at(faucet_address)
                faucet_inst.deposit_faucet_funds().transact(value=100 * 10**18)

                save_config()
                self.send_json(200, deployed_contracts)
                return

            elif path == "/api/faucet/request":
                body = self.get_post_data()
                recipient = body.get("recipient")
                if not recipient:
                    self.send_json(400, {"error": "Missing recipient address"})
                    return
                
                faucet_inst = client.get_contract_at(deployed_contracts["faucet"])
                tx = faucet_inst.request_faucet(args=[recipient]).transact()
                self.send_json(200, {"tx_hash": tx.transaction_hash.hex() if hasattr(tx, 'transaction_hash') else str(tx)})
                return

            elif path == "/api/registry/register":
                body = self.get_post_data()
                pkey = body.get("private_key")
                svc_addr = body.get("service_address")
                name = body.get("name")
                price = body.get("price")
                category = body.get("category")
                description = body.get("description")

                if not all([pkey, svc_addr, name, price, category, description]):
                    self.send_json(400, {"error": "Missing registration parameters"})
                    return

                acc = Account.from_key(pkey)
                reg_inst = client.get_contract_at(deployed_contracts["registry"])
                tx = reg_inst.connect(acc).register_service(
                    args=[svc_addr, name, int(price), category, description]
                ).transact()
                self.send_json(200, {"tx_hash": tx.transaction_hash.hex() if hasattr(tx, 'transaction_hash') else str(tx)})
                return

            elif path == "/api/escrow/deposit":
                body = self.get_post_data()
                pkey = body.get("private_key")
                amount = body.get("amount")

                if not pkey or not amount:
                    self.send_json(400, {"error": "Missing private key or deposit amount"})
                    return

                acc = Account.from_key(pkey)
                escrow_inst = client.get_contract_at(deployed_contracts["escrow"])
                tx = escrow_inst.connect(acc).deposit().transact(value=int(amount))
                self.send_json(200, {"tx_hash": tx.transaction_hash.hex() if hasattr(tx, 'transaction_hash') else str(tx)})
                return

            elif path == "/api/escrow/approve":
                body = self.get_post_data()
                pkey = body.get("private_key")
                seller = body.get("seller")
                amount = body.get("amount")

                if not all([pkey, seller, amount]):
                    self.send_json(400, {"error": "Missing approval parameters"})
                    return

                acc = Account.from_key(pkey)
                escrow_inst = client.get_contract_at(deployed_contracts["escrow"])
                tx = escrow_inst.connect(acc).approve_seller(
                    args=[seller, int(amount)]
                ).transact()
                self.send_json(200, {"tx_hash": tx.transaction_hash.hex() if hasattr(tx, 'transaction_hash') else str(tx)})
                return

            elif path == "/api/escrow/claim":
                body = self.get_post_data()
                pkey = body.get("private_key")
                buyer = body.get("buyer")
                svc_addr = body.get("service_address")
                amount = body.get("amount")
                resp_time = body.get("response_time_ms")
                input_payload = body.get("input")
                output_payload = body.get("output")
                criteria = body.get("criteria")

                if not all([pkey, buyer, svc_addr, amount, resp_time, input_payload, output_payload, criteria]):
                    self.send_json(400, {"error": "Missing claim parameters"})
                    return

                acc = Account.from_key(pkey)
                escrow_inst = client.get_contract_at(deployed_contracts["escrow"])
                tx = escrow_inst.connect(acc).claim_payment(
                    args=[
                        buyer,
                        svc_addr,
                        int(amount),
                        int(resp_time),
                        input_payload,
                        output_payload,
                        criteria
                    ]
                ).transact()
                self.send_json(200, {"tx_hash": tx.transaction_hash.hex() if hasattr(tx, 'transaction_hash') else str(tx)})
                return

            elif path == "/api/escrow/release":
                body = self.get_post_data()
                pkey = body.get("private_key")
                claim_id = body.get("claim_id")

                if not pkey or not claim_id:
                    self.send_json(400, {"error": "Missing private key or claim ID"})
                    return

                acc = Account.from_key(pkey)
                escrow_inst = client.get_contract_at(deployed_contracts["escrow"])
                tx = escrow_inst.connect(acc).release_claim(
                    args=[claim_id]
                ).transact(wait_triggered_transactions=True)
                self.send_json(200, {"tx_hash": tx.transaction_hash.hex() if hasattr(tx, 'transaction_hash') else str(tx)})
                return

            elif path == "/api/escrow/dispute":
                body = self.get_post_data()
                pkey = body.get("private_key")
                claim_id = body.get("claim_id")

                if not pkey or not claim_id:
                    self.send_json(400, {"error": "Missing private key or claim ID"})
                    return

                acc = Account.from_key(pkey)
                escrow_inst = client.get_contract_at(deployed_contracts["escrow"])
                tx = escrow_inst.connect(acc).dispute_claim(
                    args=[claim_id]
                ).transact(wait_triggered_transactions=True)
                self.send_json(200, {"tx_hash": tx.transaction_hash.hex() if hasattr(tx, 'transaction_hash') else str(tx)})
                return

            # Catch-all
            self.send_json(404, {"error": "Not Found"})

        except Exception as e:
            self.send_error_json(e)

def run(port=5000):
    load_config()
    server_address = ('', port)
    httpd = HTTPServer(server_address, GenLayerAPIHandler)
    print(f"Backend API server running on port {port}...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    print("Backend API server stopped.")

if __name__ == "__main__":
    port = 5001
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    run(port)
