# PayPer 2.0: Agent-to-Agent Nanopayment Marketplace on GenLayer

PayPer 2.0 is a next-generation agent-to-agent payment network and capability marketplace powered by **GenLayer Intelligent Contracts**. By integrating GenLayer's off-chain hot path voucher signatures and validator-level AI consensus courts, PayPer 2.0 solves the trust and latency bottleneck for machine-to-machine AI service transactions.

---

## ✦ Key Architecture & Core Workflow

In traditional blockchain networks, waiting 10-15 seconds for on-chain block consensus makes real-time agent API integrations unusable. PayPer 2.0 introduces a **Voucher-Based Hot Path** settlement backed by **AI Consensus Courts**:

```
[Buyer Agent]                                   [Seller Agent]
     │                                                │
     │  ─── 1. Call API Category Endpoint ──────────> │
     │  <── 2. Return Output & Payment Challenge ─────│  (Off-chain execution: <200ms)
     │                                                │
     │  ─── 3. Sign Voucher (EIP-191 Hash) ─────────> │  (Sub-second locally)
     │                                                │
     │                                          [GenLayer Escrow]
     │                                                │
     │                                                │ ── 4. Settle Signed Voucher ──> [On-Chain Claim Logged]
     │                                                │
     │  ─── 5. Release Deposit OR File Dispute ───────┼──> (If Dispute: Summon AI Jury)
     │                                                │
```

1. **Voucher Authorization:** The buyer agent's burner wallet programmatically signs an off-chain payment voucher containing the hashed execution output and price.
2. **On-Chain Claims:** The seller logs the signed voucher on the `PayPerEscrow` contract to request payment.
3. **Escrow Guarantee:** Funds are locked in the escrow contract until the buyer releases them or the dispute timer expires.
4. **AI Court Arbitration:** If the seller's API output violates the specified prompt criteria, the buyer agent files a dispute. GenLayer's decentralized AI validators evaluate the execution output against the prompt criteria and return an automated verdict. If the dispute is valid, a refund is instantly returned to the buyer's deposit.

---

## ⚡ Active Contract Addresses (StudioNet)

All contracts are written in Python for the GenLayer VM and deployed on **StudioNet**:

| Contract Name | StudioNet Address | Purpose |
|---|---|---|
| **PayPerRegistry** | `0xb13a464D0Bdf8B1A606D270Be25CCF455a8d57ef` | Tracks capability profiles, prices, ratings, and API endpoints. |
| **PayPerEscrow** | `0xF0d00A4511bD2d47631b33486E850f1dA80aEAEc` | Handles deposits, allowance limits, voucher claims, and AI disputes. |
| **PayPerFaucet** | `0x1f462f9ce2B69910800845DC984F7b14C176150C` | Dispenses daily GEN allowances to test burner wallets. |

---

## 📁 Repository Structure

```
├── contracts/                  # GenLayer VM Intelligent Contracts
│   ├── payper_registry.py      # Seller service registry directory
│   ├── payper_escrow.py        # Escrow, voucher verification & dispute logics
│   └── payper_faucet.py        # Cooldown-based developer token faucet
├── frontend/                   # React + TypeScript + Vite Web App
│   ├── src/
│   │   ├── App.tsx             # Interactive dashboard, workbench & slides
│   │   └── index.css           # Custom cyber-terminal design system styles
│   └── index.html              # Core font imports and SEO headers
├── server.py                   # Python HTTP backend bridge & caching server
├── fund_faucet.py              # CLI utility to deposit GEN to faucet state
├── gltest.config.yaml          # Active network config (localnet vs. studionet)
└── contracts.json              # Mapped deployed contract addresses
```

---

## ⚙️ Running Locally

### Prerequisites
- Python 3.10+
- Node.js v18+
- GenLayer Py SDK (`pip install genlayer_py eth_account`)

### 1. Start the Backend Bridge Server
The backend bridge handles CORS requests, delegates JSON-RPC calls, and caches contract reads using a **15-second TTL cache** to avoid GenLayer node rate limits (500 requests/hour):
```bash
python3 server.py
```
*Port:* Runs on `http://localhost:5001`.

### 2. Fund the Faucet Contract
The faucet contract tracks its own state balance. To fund it with GEN on StudioNet so burner wallets can request daily allowances, use the CLI funding utility:
```bash
python3 fund_faucet.py
```
Enter a funded deployment private key and specify the amount of GEN to deposit (e.g. `50`).

### 3. Launch the Frontend Dev Server
Run the Vite development server to start the client application:
```bash
cd frontend
npm install
npm run dev
```
*URL:* Open **`http://localhost:5173`** in your browser.

---

## 🛠️ Step-by-Step UI Transaction Guide

1. **Access Faucet Funds:** Launch the web app. The sidebar will generate a secure burner wallet locally and automatically request a `20 GEN` dispense from the `PayPerFaucet` contract (if its balance is zero).
2. **Deposit Escrow:** Enter an amount (e.g., `0.05 GEN`) in the deposit sidebar input and click **Deposit**. This locks funds in the `PayPerEscrow` contract.
3. **Approve Seller Limit:** Enter a seller's wallet address and set a pre-authorized allowance limit (e.g., `0.05 GEN`) to authorize service billing.
4. **Call Service:** Click on any registered service card (e.g. *AI Summarizer*) to open the details modal. Input a payload prompt and prompt validation criteria, then click **Call Service**. The app will:
   - Call the seller API.
   - Return the output.
   - Use your burner wallet to sign the payment voucher off-chain.
   - Log the settlement on the `PayPerEscrow` contract.
5. **Release or Dispute:**
   - **Acknowledge & Release:** Unlocks the escrowed payment and routes it directly to the seller's wallet address.
   - **Dispute (AI Court):** Files a dispute transaction. GenLayer validators will vote on whether the output met the prompt criteria, returning a verdict and refunding the escrow to your deposit on approval.
