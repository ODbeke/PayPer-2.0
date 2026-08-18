import sys
import os
import json
import time
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs

GET_CACHE = {}
CACHE_TTL_SECS = 15

# Add current workspace to path to resolve any contract imports
sys.path.insert(0, str(Path(__file__).parent))

try:
    from genlayer_py import create_client, create_account
    from eth_account import Account
    from genlayer_py.chains import localnet, studionet, testnet_asimov, testnet_bradbury
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

net_name = get_config_network()
chain_map = {
    "localnet": localnet,
    "studionet": studionet,
    "testnet_asimov": testnet_asimov,
    "testnet_bradbury": testnet_bradbury
}
selected_chain = chain_map.get(net_name, localnet)
print(f"Active network profile from configuration: {net_name}")

# Initialize deterministic deployer account for backend contract deployments
deployer_private_key = "0x" + "b" * 64  # Deterministic private key
deployer_account = Account.from_key(deployer_private_key)

print(f"Initializing GenLayer client on {net_name} with account: {deployer_account.address}")
client = create_client(chain=selected_chain, account=deployer_account)

if net_name == "localnet":
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
                bal = client.read_contract(
                    address=deployed_contracts["faucet"],
                    function_name="get_faucet_balance"
                )
                self.send_json(200, {"balance": int(bal)})
                return

            elif path == "/api/balance":
                address = query.get("address", [None])[0]
                if not address:
                    self.send_json(400, {"error": "Missing address parameter"})
                    return
                resp = client.provider.make_request("eth_getBalance", [address, "latest"])
                bal_hex = resp.get("result", "0x0")
                bal_wei = int(bal_hex, 16)
                self.send_json(200, {"balance": bal_wei})
                return

            elif path == "/api/registry/services":
                if not deployed_contracts["registry"]:
                      self.send_json(200, [])
                      return
                
                cache_key = "services"
                now = time.time()
                if cache_key in GET_CACHE and now - GET_CACHE[cache_key]["time"] < CACHE_TTL_SECS:
                    self.send_json(200, GET_CACHE[cache_key]["data"])
                    return

                services = client.read_contract(
                    address=deployed_contracts["registry"],
                    function_name="get_services"
                )
                # Convert address types to strings
                formatted_services = []
                for s in services:
                    formatted_services.append({
                        "address": s.get("address") or s.get("service_address", ""),
                        "endpoint": s.get("endpoint", ""),
                        "seller": s.get("seller", ""),
                        "name": s.get("name", ""),
                        "price": int(s.get("price", 0)),
                        "category": s.get("category", ""),
                        "description": s.get("description", ""),
                        "total_calls": int(s.get("total_calls", 0)),
                        "success_rate": int(s.get("success_rate", 100)),
                        "rating": int(s.get("rating", 50)),
                        "active": s.get("active", True)
                    })
                GET_CACHE[cache_key] = {
                    "time": now,
                    "data": formatted_services
                }
                self.send_json(200, formatted_services)
                return

            elif path == "/api/registry/stats":
                if not deployed_contracts["registry"]:
                    self.send_json(200, {"total_transactions": 0, "total_gen_volume": "0", "total_services": 0})
                    return
                try:
                    stats = client.read_contract(
                        address=deployed_contracts["registry"],
                        function_name="get_global_stats"
                    )
                    self.send_json(200, {
                        "total_transactions": int(stats.get("total_transactions", 0)),
                        "total_gen_volume": str(stats.get("total_gen_volume", "0")),
                        "total_services": int(stats.get("total_services", 0))
                    })
                except Exception as e:
                    self.send_json(200, {"total_transactions": 0, "total_gen_volume": "0", "total_services": 0})
                return

            elif path == "/api/escrow/deposit":
                user = query.get("user", [None])[0]
                if not user:
                    self.send_json(400, {"error": "Missing user address query parameter"})
                    return
                if not deployed_contracts["escrow"]:
                    self.send_json(400, {"error": "Escrow not deployed"})
                    return
                
                cache_key = f"deposit_{user}"
                now = time.time()
                if cache_key in GET_CACHE and now - GET_CACHE[cache_key]["time"] < CACHE_TTL_SECS:
                    self.send_json(200, GET_CACHE[cache_key]["data"])
                    return

                dep = client.read_contract(
                    address=deployed_contracts["escrow"],
                    function_name="get_deposit",
                    args=[user]
                )
                res_data = {"deposit": int(dep)}
                GET_CACHE[cache_key] = {
                    "time": now,
                    "data": res_data
                }
                self.send_json(200, res_data)
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
                
                cache_key = f"allowance_{buyer}_{seller}"
                now = time.time()
                if cache_key in GET_CACHE and now - GET_CACHE[cache_key]["time"] < CACHE_TTL_SECS:
                    self.send_json(200, GET_CACHE[cache_key]["data"])
                    return

                allowance = client.read_contract(
                    address=deployed_contracts["escrow"],
                    function_name="get_allowance",
                    args=[buyer, seller]
                )
                res_data = {"allowance": int(allowance)}
                GET_CACHE[cache_key] = {
                    "time": now,
                    "data": res_data
                }
                self.send_json(200, res_data)
                return

            elif path == "/api/escrow/claims":
                if not deployed_contracts["escrow"]:
                    self.send_json(200, [])
                    return
                claims = client.read_contract(
                    address=deployed_contracts["escrow"],
                    function_name="get_claims",
                    args=[0]
                )
                self.send_json(200, claims)
                return

            # Catch-all
            self.send_json(404, {"error": "Not Found"})

        except Exception as e:
            self.send_error_json(e)

    def do_POST(self):
        GET_CACHE.clear()
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
                client.write_contract(
                    address=registry_address,
                    function_name="set_escrow_address",
                    args=[escrow_address]
                )

                # Fund Faucet with 100 GEN (Only on localnet)
                if net_name == "localnet":
                    print("Funding Faucet with 100 GEN...")
                    try:
                        client.write_contract(
                            address=faucet_address,
                            function_name="deposit_faucet_funds",
                            value=100 * 10**18
                        )
                    except Exception as e:
                        print(f"Warning: could not fund faucet: {e}")

                save_config()
                self.send_json(200, deployed_contracts)
                return

            elif path == "/api/faucet/request":
                body = self.get_post_data()
                recipient = body.get("recipient")
                if not recipient:
                    self.send_json(400, {"error": "Missing recipient address"})
                    return
                
                tx = client.write_contract(
                    address=deployed_contracts["faucet"],
                    function_name="request_faucet",
                    args=[recipient]
                )
                self.send_json(200, {"tx_hash": tx})
                return

            elif path == "/api/registry/register":
                body = self.get_post_data()
                pkey = body.get("private_key")
                svc_addr = body.get("service_address")
                endpoint = body.get("endpoint")
                name = body.get("name")
                price = body.get("price")
                category = body.get("category")
                description = body.get("description")

                if not all([pkey, svc_addr, endpoint, name, price, category, description]):
                    self.send_json(400, {"error": "Missing registration parameters"})
                    return

                acc = Account.from_key(pkey)
                if net_name == "localnet":
                    client.fund_account(acc.address, 10 * 10**18)

                tx = client.write_contract(
                    address=deployed_contracts["registry"],
                    function_name="register_service",
                    account=acc,
                    args=[svc_addr, endpoint, name, int(price), category, description]
                )
                self.send_json(200, {"tx_hash": tx})
                return

            elif path == "/api/escrow/deposit":
                body = self.get_post_data()
                pkey = body.get("private_key")
                amount = body.get("amount")

                if not pkey or not amount:
                    self.send_json(400, {"error": "Missing private key or deposit amount"})
                    return

                acc = Account.from_key(pkey)
                if net_name == "localnet":
                    client.fund_account(acc.address, 10 * 10**18)

                tx = client.write_contract(
                    address=deployed_contracts["escrow"],
                    function_name="deposit",
                    account=acc,
                    value=int(amount)
                )
                self.send_json(200, {"tx_hash": tx})
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
                tx = client.write_contract(
                    address=deployed_contracts["escrow"],
                    function_name="approve_seller",
                    account=acc,
                    args=[seller, int(amount)]
                )
                self.send_json(200, {"tx_hash": tx})
                return

            elif path == "/api/escrow/claim":
                body = self.get_post_data()
                pkey = body.get("private_key")
                buyer = body.get("buyer")
                seller = body.get("seller")
                svc_addr = body.get("service_address")
                amount = body.get("amount")
                resp_time = body.get("response_time_ms")
                input_payload = body.get("input")
                output_payload = body.get("output")
                criteria = body.get("criteria")
                signature = body.get("signature")

                if not all([pkey, buyer, seller, svc_addr, amount, resp_time, input_payload, output_payload, criteria, signature]):
                    self.send_json(400, {"error": "Missing claim parameters including signature"})
                    return

                acc = Account.from_key(pkey)
                tx = client.write_contract(
                    address=deployed_contracts["escrow"],
                    function_name="claim_payment",
                    account=acc,
                    args=[
                        buyer,
                        seller,
                        svc_addr,
                        int(amount),
                        int(resp_time),
                        input_payload,
                        output_payload,
                        criteria,
                        signature
                    ]
                )
                client.wait_for_transaction_receipt(tx)
                self.send_json(200, {"tx_hash": tx})
                return

            elif path == "/api/escrow/release":
                body = self.get_post_data()
                pkey = body.get("private_key")
                claim_id = body.get("claim_id")

                if not pkey or not claim_id:
                    self.send_json(400, {"error": "Missing private key or claim ID"})
                    return

                acc = Account.from_key(pkey)
                tx_hash = client.write_contract(
                    address=deployed_contracts["escrow"],
                    function_name="release_claim",
                    account=acc,
                    args=[claim_id]
                )
                client.wait_for_transaction_receipt(tx_hash)
                self.send_json(200, {"tx_hash": tx_hash})
                return

            elif path == "/api/escrow/dispute":
                body = self.get_post_data()
                pkey = body.get("private_key")
                claim_id = body.get("claim_id")

                if not pkey or not claim_id:
                    self.send_json(400, {"error": "Missing private key or claim ID"})
                    return

                acc = Account.from_key(pkey)
                tx_hash = client.write_contract(
                    address=deployed_contracts["escrow"],
                    function_name="dispute_claim",
                    account=acc,
                    args=[claim_id]
                )
                client.wait_for_transaction_receipt(tx_hash)
                self.send_json(200, {"tx_hash": tx_hash})
                return

            # Catch-all
            self.send_json(404, {"error": "Not Found"})

        except Exception as e:
            self.send_error_json(e)

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

def run(port=5001):
    load_config()
    server_address = ('', port)
    httpd = ThreadedHTTPServer(server_address, GenLayerAPIHandler)
    print(f"Backend API server running on port {port}...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    print("Backend API server stopped.")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    run(port)
