# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
try:
    from genlayer import *
except ModuleNotFoundError:
    # Local unit test mocks
    class Address:
        def __init__(self, val):
            self.val = str(val)
        @property
        def as_hex(self):
            return self.val
    class u256(int):
        pass
    class TreeMap:
        def __init__(self):
            self.data = {}
        def get(self, key, default=None):
            return self.data.get(key, default)
        def __getitem__(self, key):
            return self.data[key]
        def __setitem__(self, key, value):
            self.data[key] = value
        def __contains__(self, key):
            return key in self.data
    class DynArray:
        def __init__(self):
            self.data = []
        def append(self, item):
            self.data.append(item)
        def __len__(self):
            return len(self.data)
        def __getitem__(self, key):
            return self.data[key]
    class MockMessage:
        sender_address = Address("0x0000000000000000000000000000000000000000")
        value = 0
    class MockVM:
        class UserError(Exception):
            pass
    class MockGL:
        message = MockMessage()
        message_raw = {"datetime": "2026-08-17T00:00:00Z"}
        vm = MockVM()
        Contract = object
    gl = MockGL()

import json

# Fallback definition for local Python import compatibility in tests
try:
    u256
except NameError:
    u256 = int

class PayPerRegistry(gl.Contract):
    owner: Address
    escrow_address: Address
    listings: TreeMap[str, str]        # Maps service_address (hex) -> JSON string of listing details
    service_addresses: DynArray[str]   # List of registered service addresses (hex)
    total_transactions: u256
    total_gen_volume: u256

    def __init__(self) -> None:
        self.owner = gl.message.sender_address
        self.escrow_address = gl.message.sender_address # Set owner as initial escrow to allow manual config
        self.listings = TreeMap()
        self.service_addresses = DynArray()
        self.total_transactions = u256(0)
        self.total_gen_volume = u256(0)

    @gl.public.write
    def set_escrow_address(self, escrow_address: str) -> None:
        """Sets the address of the verified Escrow contract allowed to report execution stats."""
        assert gl.message.sender_address.as_hex == self.owner.as_hex, "Only registry owner can set escrow address"
        self.escrow_address = Address(escrow_address)

    @gl.public.write
    def register_service(
        self,
        service_address: str,
        name: str,
        price_wei: int,
        category: str,
        description: str
    ) -> None:
        """Allows a seller to register their deployed service contract address."""
        clean_addr = Address(service_address).as_hex.lower()
        seller_hex = gl.message.sender_address.as_hex.lower()

        # Check if already registered
        is_new = True
        for i in range(len(self.service_addresses)):
            if self.service_addresses[i].lower() == clean_addr:
                is_new = False
                break

        listing = {
            "service_address": clean_addr,
            "seller": seller_hex,
            "name": str(name).strip(),
            "price": int(price_wei),
            "category": str(category).strip().lower(),
            "description": str(description).strip(),
            "active": True,
            "success_rate": 100,      # In percent (0-100)
            "avg_response_time": 200, # In milliseconds
            "total_calls": 0,
            "rating": 50              # Multiplied by 10 (e.g. 50 = 5.0)
        }

        self.listings[clean_addr] = json.dumps(listing)
        if is_new:
            self.service_addresses.append(clean_addr)

    @gl.public.write
    def set_service_active(self, service_address: str, active: bool) -> None:
        """Allows a seller to toggle their service status (online/offline)."""
        clean_addr = Address(service_address).as_hex.lower()
        assert clean_addr in self.listings, "Service is not registered"

        listing = json.loads(self.listings[clean_addr])
        assert listing["seller"].lower() == gl.message.sender_address.as_hex.lower(), "Only the service owner can change active status"

        listing["active"] = bool(active)
        self.listings[clean_addr] = json.dumps(listing)

    @gl.public.write
    def record_execution(self, service_address: str, success: bool, response_time_ms: int, value_wei: int) -> None:
        """Updates service statistics after execution. Restricted to verified Escrow contract or Owner."""
        caller = gl.message.sender_address.as_hex.lower()
        owner = self.owner.as_hex.lower()
        escrow = self.escrow_address.as_hex.lower()
        assert caller == escrow or caller == owner, "Only the Escrow contract or Owner can record execution stats"

        clean_addr = Address(service_address).as_hex.lower()
        if clean_addr not in self.listings:
            return  # No-op if service isn't registered in directory

        listing = json.loads(self.listings[clean_addr])
        total = int(listing["total_calls"]) + 1
        listing["total_calls"] = total

        # Success rate moving average
        current_success_rate = int(listing["success_rate"])
        outcome_val = 100 if success else 0
        listing["success_rate"] = int((current_success_rate * 9 + outcome_val) / 10)

        # Average response time moving average
        current_time = int(listing["avg_response_time"])
        listing["avg_response_time"] = int((current_time * 9 + int(response_time_ms)) / 10)

        # Dynamic rating update based on performance
        if success:
            # Gradually increase to max 5.0 (50)
            listing["rating"] = min(50, int(listing["rating"]) + 1)
        else:
            # Settle downward rapidly on failures to reflect performance issues
            listing["rating"] = max(10, int(listing["rating"]) - 5)

        self.listings[clean_addr] = json.dumps(listing)

        # Update global stats
        self.total_transactions += u256(1)
        self.total_gen_volume += u256(value_wei)

    # --- View Methods ---

    @gl.public.view
    def get_services(self) -> list:
        """Returns all registered services."""
        out = []
        for i in range(len(self.service_addresses)):
            addr = self.service_addresses[i]
            if addr in self.listings:
                out.append(json.loads(self.listings[addr]))
        return out

    @gl.public.view
    def get_service(self, service_address: str) -> dict:
        """Returns the metadata details of a single service."""
        clean_addr = Address(service_address).as_hex.lower()
        assert clean_addr in self.listings, "Service address not found"
        return json.loads(self.listings[clean_addr])

    @gl.public.view
    def get_global_stats(self) -> dict:
        """Returns aggregate marketplace metrics."""
        return {
            "total_transactions": int(self.total_transactions),
            "total_gen_volume": str(self.total_gen_volume),
            "total_services": len(self.service_addresses)
        }
