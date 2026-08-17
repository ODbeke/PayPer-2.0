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
        def get_balance(self, addr):
            return 100 * 10**18
        def get_address(self):
            return "0x0000000000000000000000000000000000000000"
        def transfer(self, to_addr, amt):
            pass
    gl = MockGL()

class PayPerFaucet(gl.Contract):
    owner: Address
    last_requests: TreeMap[str, str] # Maps recipient address (hex) -> last request date (YYYY-MM-DD)

    def __init__(self) -> None:
        self.owner = gl.message.sender_address
        self.last_requests = TreeMap()

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

        # Execute transfer (underlying VM will revert if contract balance is insufficient)
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
