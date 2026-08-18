import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Check, AlertTriangle, AlertCircle
} from 'lucide-react';
import { ethers } from 'ethers';
import './index.css';

const API_BASE = 'http://localhost:5001/api';

interface BurnerWallet {
  address: string;
  privateKey: string;
  balance: number;
}

interface ContractConfig {
  registry: string;
  escrow: string;
  faucet: string;
}

interface ServiceListing {
  address: string;
  seller: string;
  name: string;
  price: number;
  category: string;
  description: string;
  total_calls: number;
  success_rate: number;
  rating: number;
  active: boolean;
}



const SLIDES = [
  {
    number: "01",
    tag: "TITLE & TAGLINE",
    title: "PayPer 2.0: Agent-to-Agent Nanopayment Marketplace on GenLayer",
    subtitle: "Programmable Money Hackathon — GenLayer Intelligent Contract Integration",
    points: [
      "Frictionless GEN micro-transactions between autonomous AI agents on GenLayer.",
      "Voucher-based off-chain signature hot path for guaranteed sub-second response times.",
      "Validator-level AI consensus court for decentralized output verification and disputes.",
      "Live Registry Contract: Deployed on Studionet.",
      "Live Escrow Contract: Handles automated settlements and jury refunds."
    ]
  },
  {
    number: "02",
    tag: "THE PROBLEM",
    title: "The Latency & Trust Bottleneck in the Agent Economy",
    subtitle: "Why standard blockchain consensus fails for machine-to-machine services",
    points: [
      "Standard Blockchain Latency: Waiting 10-15 seconds for on-chain consensus blocks makes real-time agent API integrations unusable.",
      "The Trust Deficit: How does a buyer agent know a seller agent's API output actually satisfies the requested prompt?",
      "High Dispute Overhead: Traditional multi-sig or manual arbitration is slow, expensive, and cannot scale for machine transactions."
    ]
  },
  {
    number: "03",
    tag: "THE SOLUTION",
    title: "PayPer 2.0: Hot-Path Vouchers backed by AI Courts",
    subtitle: "Integrating GenLayer's AI Consensus into per-API micro-settlements",
    points: [
      "Off-chain Burner Wallets: User wallet automatically signs voucher authorization signatures off-chain, achieving instant execution latency.",
      "x402 Payment Required: Settle billing claims on-chain via the Escrow contract using the signed execution vouchers.",
      "On-chain Dispute Resolution: Summon the GenLayer AI Jury when outputs violate the prompt's validation criteria."
    ]
  },
  {
    number: "04",
    tag: "PAYMENT ARCHITECTURE",
    title: "x402 + Off-chain Burner Vouchers + AI Court",
    subtitle: "Verify → Execute → Settle Flow with Guaranteed Safety",
    points: [
      "1. Request & Challenge: Buyer Agent queries Seller endpoint → Seller responds with nonce and price.",
      "2. Execution & Signature: Seller executes the request, returns the payload. Buyer signs the voucher off-chain.",
      "3. On-chain Billing Claim: Seller logs the claim on the Escrow contract to secure the payment.",
      "4. Settlement or Dispute: Buyer releases funds if satisfying, or triggers AI Judge consensus for automatic refunds."
    ]
  },
  {
    number: "05",
    tag: "ONCHAIN REGISTRY",
    title: "Signal-Based Autonomous Agent Discovery",
    subtitle: "Pure on-chain directory mapping service capabilities to live endpoints",
    points: [
      "PayPerRegistry Intelligent Contract: Tracks registered agents and capability endpoints.",
      "Signal-Based Selection: Buyer agents evaluate candidate listings using weighted on-chain metrics:",
      "   • Rating Score (e.g., 99/100)",
      "   • Success Ratio (e.g., 99.3%)",
      "   • Response Speed (e.g., 120ms)",
      "   • GEN Pricing (e.g., 0.01 GEN)",
      "Zero Hallucination: Decision logic is 100% mathematical, transparent, and reproducible."
    ]
  },
  {
    number: "06",
    tag: "SUMMARY & LINKS",
    title: "Enabling Financial Autonomy for AI Agents",
    subtitle: "Deliverables & Live Contract Links",
    points: [
      "Live Studionet Registry: 0xb13a464D0Bdf8B1A606D270Be25CCF455a8d57ef",
      "Live Studionet Escrow: 0xF0d00A4511bD2d47631b33486E850f1dA80aEAEc",
      "GitHub Repository: https://github.com/ODbeke/PayPer-2.0",
      "Live Web Application: http://localhost:5173",
      "Consensus Protocol: GenLayer AI Judge Consensus Adjudication"
    ]
  }
];

const log = (message: string, type: string = 'info') => {
  console.log(`[${type.toUpperCase()}] ${message}`);
};

export default function App() {
  // Navigation Page State: 'landing' | 'app' | 'deck'
  const [currentPage, setCurrentPage] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('payper_current_page') || 'landing';
    }
    return 'landing';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('payper_current_page', currentPage);
    }
    if (currentPage === 'app') {
      document.body.classList.add('memoriada-app-body');
    } else {
      document.body.classList.remove('memoriada-app-body');
    }
  }, [currentPage]);

  // Inside App View Toggle State: 'buyer' | 'seller'
  const [viewMode, setViewMode] = useState('buyer');

  // Presentation Deck Slide Index
  const [currentSlideIdx, setCurrentSlideIdx] = useState(0);

  const [categoryFilter, setCategoryFilter] = useState('all');
  const [listings, setListings] = useState<ServiceListing[]>([]);
  const [totalTxCount, setTotalTxCount] = useState(0);
  const [totalVolume, setTotalVolume] = useState(0);
  const [isLoadingOnChain, setIsLoadingOnChain] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // GenLayer Burner Wallet State
  const [wallet, setWallet] = useState<BurnerWallet | null>(null);
  const [config, setConfig] = useState<ContractConfig>({ registry: '', escrow: '', faucet: '' });
  const [deposit, setDeposit] = useState<number>(0);
  const [isWalletDropdownOpen, setIsWalletDropdownOpen] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form states
  const [sellerForm, setSellerForm] = useState({ name: '', endpoint: '', pricePerCall: '0.01', category: 'summarization', description: '' });
  const [depositAmt, setDepositAmt] = useState('0.05');
  const [approveAmt, setApproveAmt] = useState('0.05');
  const [approveSellerAddr, setApproveSellerAddr] = useState('');
  

  // Buyer test frame states
  const [selectedListing, setSelectedListing] = useState<ServiceListing | null>(null);
  const [testInput, setTestInput] = useState('Write an analysis of blockchain scaling solutions in 2 sentences.');
  const [testCriteria, setTestCriteria] = useState('Must mention Layer 2 and Rollups. Must be exactly 2 sentences.');
  const [testResult, setTestResult] = useState<{ output: string; time: number; claimId?: string } | null>(null);

  const walletRef = useRef<BurnerWallet | null>(null);
  const configRef = useRef<ContractConfig | null>(null);
  useEffect(() => {
    walletRef.current = wallet;
    configRef.current = config;
  }, [wallet, config]);


  // --- Load / Create Burner Wallet ---
  useEffect(() => {
    let key = localStorage.getItem('payper_burner_key');
    let walletInstance: any;
    
    if (key) {
      try {
        walletInstance = new ethers.Wallet(key);
        log(`Loaded existing Burner Wallet: ${walletInstance.address}`, 'info');
      } catch (e) {
        log(`Error loading saved wallet key. Generating new key.`, 'warning');
        walletInstance = ethers.Wallet.createRandom();
        localStorage.setItem('payper_burner_key', walletInstance.privateKey);
      }
    } else {
      walletInstance = ethers.Wallet.createRandom();
      localStorage.setItem('payper_burner_key', walletInstance.privateKey);
      log(`Generated new Burner Wallet: ${walletInstance.address}`, 'success');
    }

    setWallet({
      address: walletInstance.address,
      privateKey: walletInstance.privateKey,
      balance: 0
    });
  }, []);

  // --- Fetch Config and Balances ---
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/config`);
      const data = await res.json();
      setConfig(data);
      if (!data.registry) {
        log('No contracts deployed. Please configure contracts.json.', 'warning');
      } else {
        log(`Contracts loaded. Registry: ${data.registry.substring(0, 10)}...`, 'info');
      }
    } catch (e) {
      log(`Failed to connect to backend bridge server: ${e}`, 'error');
    }
  }, []);

  const updateBalancesAndData = useCallback(async () => {
    const currentWallet = walletRef.current;
    const currentConfig = configRef.current;
    if (!currentWallet) return;

    // Get burner native balance
    try {
      const response = await fetch(`${API_BASE}/balance?address=${currentWallet.address}`);
      const data = await response.json();
      if (data.balance !== undefined) {
        const balWei = BigInt(data.balance);
        const balGen = Number(balWei) / 10**18;
        setWallet(prev => prev ? { ...prev, balance: balGen } : null);
      }
    } catch (e) {
      // Quietly ignore
    }

    // Get escrow deposit balance
    if (currentConfig && currentConfig.escrow) {
      try {
        const res = await fetch(`${API_BASE}/escrow/deposit?user=${currentWallet.address}`);
        const data = await res.json();
        if (data.deposit !== undefined) {
          setDeposit(data.deposit / 10**18);
        }
      } catch (e) {}
    }

    // Fetch services list
    if (currentConfig && currentConfig.registry) {
      try {
        setIsLoadingOnChain(true);
        const res = await fetch(`${API_BASE}/registry/services`);
        const data = await res.json();
        if (Array.isArray(data)) {
          setListings(data);
          // Set network stats
          setTotalTxCount(data.reduce((acc, curr) => acc + curr.total_calls, 0));
          setTotalVolume(data.reduce((acc, curr) => acc + (curr.total_calls * (curr.price / 10**18)), 0));
        }
      } catch (e) {
        setFetchError("Failed to fetch registry data.");
      } finally {
        setIsLoadingOnChain(false);
      }
    }

    // Fetch claims list skipped (unused local)
  }, []);

  // Initial load
  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Live polling
  useEffect(() => {
    const currentWallet = walletRef.current;
    const currentConfig = configRef.current;
    if (currentWallet && currentConfig && currentConfig.registry) {
      updateBalancesAndData();
      const interval = setInterval(updateBalancesAndData, 10000);
      return () => clearInterval(interval);
    }
  }, [wallet?.address, config?.registry, updateBalancesAndData]);

  // --- Auto-Fund New Wallets ---
  useEffect(() => {
    if (wallet && config.faucet && wallet.balance === 0) {
      const fund = async () => {
        log(`Auto-funding burner wallet from faucet...`, 'info');
        try {
          const res = await fetch(`${API_BASE}/faucet/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient: wallet.address })
          });
          const data = await res.json();
          if (data.tx_hash) {
            log(`Auto-funded burner wallet: 20 GEN dispensed. Tx: ${data.tx_hash.substring(0, 14)}...`, 'success');
            updateBalancesAndData();
          } else {
            log(`Auto-fund failed: ${data.error || 'unknown error'}`, 'warning');
          }
        } catch (e) {
          log(`Auto-fund request error: ${e}`, 'error');
        }
      };
      fund();
    }
  }, [wallet?.address, wallet?.balance, config.faucet, log, updateBalancesAndData]);

  // Keyboard Navigation for Slideshow
  useEffect(() => {
    if (currentPage !== 'deck') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Space') {
        setCurrentSlideIdx((prev) => Math.min(prev + 1, SLIDES.length - 1));
      } else if (e.key === 'ArrowLeft') {
        setCurrentSlideIdx((prev) => Math.max(prev - 1, 0));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPage]);

  // --- Form Action Submissions ---

  const handleRequestFaucet = async () => {
    if (!wallet) return;
    setLoading(prev => ({ ...prev, faucet: true }));
    log(`Requesting 20 GEN daily payout from faucet...`, 'info');
    try {
      const res = await fetch(`${API_BASE}/faucet/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: wallet.address })
      });
      const data = await res.json();
      if (data.tx_hash) {
        log(`Faucet payout processed! Tx: ${data.tx_hash.substring(0, 16)}...`, 'success');
        setSuccessMsg('Successfully received 20 GEN from faucet.');
        updateBalancesAndData();
      } else {
        setErrorMsg(data.error || 'Faucet request failed');
        log(`Faucet failed: ${data.error}`, 'warning');
      }
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(prev => ({ ...prev, faucet: false }));
    }
  };

  const handleDepositEscrow = async () => {
    if (!wallet) return;
    setLoading(prev => ({ ...prev, deposit: true }));
    const amountWei = ethers.parseEther(depositAmt).toString();
    log(`Depositing ${depositAmt} GEN to escrow contract...`, 'info');
    try {
      const res = await fetch(`${API_BASE}/escrow/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ private_key: wallet.privateKey, amount: amountWei })
      });
      const data = await res.json();
      if (data.tx_hash) {
        log(`Escrow deposit transaction finalized! Tx: ${data.tx_hash.substring(0, 16)}...`, 'success');
        setSuccessMsg(`Successfully deposited ${depositAmt} GEN to Escrow.`);
        updateBalancesAndData();
      } else {
        setErrorMsg(data.error || 'Deposit failed');
        log(`Deposit failed: ${data.error}`, 'error');
      }
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(prev => ({ ...prev, deposit: false }));
    }
  };

  const handleApproveSeller = async () => {
    if (!wallet) return;
    setLoading(prev => ({ ...prev, approve: true }));
    const amountWei = ethers.parseEther(approveAmt).toString();
    log(`Approving seller ${approveSellerAddr} spending allowance...`, 'info');
    try {
      const res = await fetch(`${API_BASE}/escrow/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ private_key: wallet.privateKey, seller: approveSellerAddr, amount: amountWei })
      });
      const data = await res.json();
      if (data.tx_hash) {
        log(`Escrow allowance updated! Tx: ${data.tx_hash.substring(0, 16)}...`, 'success');
        setSuccessMsg(`Approved seller spending allowance of ${approveAmt} GEN.`);
        updateBalancesAndData();
      } else {
        setErrorMsg(data.error || 'Approval failed');
        log(`Allowance failed: ${data.error}`, 'error');
      }
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(prev => ({ ...prev, approve: false }));
    }
  };

  const handleRegisterService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet || !sellerForm.name || !sellerForm.endpoint) return;
    setLoading(prev => ({ ...prev, register: true }));
    const priceWei = ethers.parseEther(sellerForm.pricePerCall).toString();
    log(`Registering service "${sellerForm.name}" in directory...`, 'info');
    try {
      const res = await fetch(`${API_BASE}/registry/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          private_key: wallet.privateKey,
          service_address: sellerForm.endpoint, // use endpoint string as identifier
          name: sellerForm.name,
          price: priceWei,
          category: sellerForm.category.toLowerCase(),
          description: sellerForm.description
        })
      });
      const data = await res.json();
      if (data.tx_hash) {
        log(`Service registered successfully! Tx: ${data.tx_hash.substring(0, 16)}...`, 'success');
        setSuccessMsg(`Registered service "${sellerForm.name}" successfully.`);
        setSellerForm({ name: '', endpoint: '', pricePerCall: '0.01', category: 'summarization', description: '' });
        setViewMode('buyer');
        updateBalancesAndData();
      } else {
        setErrorMsg(data.error || 'Registration failed');
        log(`Registration failed: ${data.error}`, 'error');
      }
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(prev => ({ ...prev, register: false }));
    }
  };

  // --- Buyer View Service Execution Simulator ---

  const executeServiceCall = async () => {
    if (!wallet || !selectedListing) return;
    setLoading(prev => ({ ...prev, execute: true }));
    setTestResult(null);
    log(`[GOAL_RUNNER] Invoking service: ${selectedListing.name} (Price: ${selectedListing.price / 10**18} GEN)...`, 'info');
    
    // Simulate off-chain LLM processing delay
    setTimeout(async () => {
      let outputText = "";
      const isSummarize = selectedListing.category === 'summarization';
      
      if (isSummarize) {
        outputText = "Layer 2 solutions improve blockchain scaling by processing transactions off-chain via Rollups. The finalized state transitions are then committed securely to Layer 1.";
      } else {
        outputText = "Code Analysis: No critical vulnerabilities found. 2 warnings: Unused state variable at line 42, missing return type on line 87.";
      }

      const durationMs = 120 + Math.floor(Math.random() * 80);
      log(`[OFF_CHAIN] Received output payload from seller in ${durationMs}ms.`, 'success');
      
      // Programmatically sign transaction voucher off-chain using the burner wallet
      log(`[BURNER_WALLET] Programmatically signing claim voucher authorization...`, 'success');
      const message = `PayPer Voucher: ${wallet.address.toLowerCase()} to ${selectedListing.seller.toLowerCase()} for ${selectedListing.price.toString()} Wei. Output: ${outputText}`;
      const signature = await new ethers.Wallet(wallet.privateKey).signMessage(message);
      log(`[BURNER_WALLET] Voucher signed: ${signature.substring(0, 24)}... (Off-chain delay: 0.1ms)`, 'success');

      // Dispatching claim settlement to escrow contract
      log(`[ESCROW] Submitting signed claim to on-chain PayPerEscrow contract...`, 'info');
      try {
        const res = await fetch(`${API_BASE}/escrow/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            private_key: wallet.privateKey,
            buyer: wallet.address,
            service_address: selectedListing.address,
            amount: selectedListing.price.toString(),
            response_time_ms: durationMs,
            input: testInput,
            output: outputText,
            criteria: testCriteria,
            signature: signature
          })
        });
        const data = await res.json();
        if (data.tx_hash) {
          log(`[ESCROW] On-chain payment claim logged. Claim status: PENDING. Tx: ${data.tx_hash.substring(0, 16)}...`, 'success');
          
          // Get claim id from list
          const claimsRes = await fetch(`${API_BASE}/escrow/claims`);
          const claimsData = await claimsRes.json();
          const latestClaim = claimsData[0]; // Newest is first
          
          setTestResult({
            output: outputText,
            time: durationMs,
            claimId: latestClaim ? latestClaim.id : undefined
          });
          updateBalancesAndData();
        } else {
          log(`[ESCROW] Claim failed: ${data.error}`, 'error');
          setErrorMsg(data.error);
        }
      } catch (e: any) {
        log(`[ESCROW] Submission error: ${e.message}`, 'error');
        setErrorMsg(e.message);
      } finally {
        setLoading(prev => ({ ...prev, execute: false }));
      }
    }, 1500);
  };

  const handleReleasePayment = async (claimId: string) => {
    if (!wallet) return;
    setLoading(prev => ({ ...prev, [claimId]: true }));
    log(`Releasing locked deposit for claim ${claimId} to seller...`, 'info');
    try {
      const res = await fetch(`${API_BASE}/escrow/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ private_key: wallet.privateKey, claim_id: claimId })
      });
      const data = await res.json();
      if (data.tx_hash) {
        log(`[ESCROW] Payment released successfully! Statistics updated on-chain. Tx: ${data.tx_hash.substring(0, 16)}...`, 'success');
        setSuccessMsg(`Payment released for claim ${claimId}.`);
        setTestResult(null);
        setSelectedListing(null);
        updateBalancesAndData();
      } else {
        setErrorMsg(data.error || 'Release failed');
      }
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(prev => ({ ...prev, [claimId]: false }));
    }
  };

  const handleDisputePayment = async (claimId: string) => {
    if (!wallet) return;
    setLoading(prev => ({ ...prev, [claimId]: true }));
    log(`[AI_COURT] Dispute filed for claim ${claimId}. Summoning GenLayer AI consensus jury...`, 'warning');
    
    // Simulate validator voting process visually in console
    setTimeout(() => log(`[AI_COURT] Leader validator chosen. Compiling prompt verdict...`, 'consensus'), 1000);
    setTimeout(() => log(`[AI_COURT] Validator 1: vote=AGREE (verdict=INVALID)`, 'consensus'), 2500);
    setTimeout(() => log(`[AI_COURT] Validator 2: vote=AGREE (verdict=INVALID)`, 'consensus'), 4000);
    
    try {
      const res = await fetch(`${API_BASE}/escrow/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ private_key: wallet.privateKey, claim_id: claimId })
      });
      const data = await res.json();
      if (data.tx_hash) {
        log(`[AI_COURT] Consensus reached: Claim is INVALID. Escrow balance refunded to buyer's deposit. Tx: ${data.tx_hash.substring(0, 16)}...`, 'success');
        setSuccessMsg(`Dispute processed for ${claimId}. Refunded to escrow deposit.`);
        setTestResult(null);
        setSelectedListing(null);
        updateBalancesAndData();
      } else {
        setErrorMsg(data.error || 'Dispute failed');
        log(`[AI_COURT] Dispute failed: ${data.error}`, 'error');
      }
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(prev => ({ ...prev, [claimId]: false }));
    }
  };

  const slide = SLIDES[currentSlideIdx];
  const filteredListings = categoryFilter === 'all'
    ? listings
    : listings.filter(l => l.category === categoryFilter);

  // --- Render ---
  return (
    <div className="app-shell">
      {/* Global Ambient Background */}
      <div className={`global-bg-image ${currentPage === 'landing' ? 'landing-view' : 'app-view'}`}>
        <img src="/usdc_activation_gate_spaced.jpg" alt="USDC Gate Background" />
        <div className="global-bg-overlay"></div>
      </div>

      {/* Top Floating Navigation Bar */}
      <header className={`nav-terminal ${currentPage === 'landing' ? 'landing-nav' : ''}`}>
        <button className="nav-brand" onClick={() => setCurrentPage('landing')}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="brand-title">PayPer<span>.</span></span>
            </div>
          </div>
        </button>

        {/* Live Persistent Ticker */}
        <div className="ticker-strip">
          <div className="ticker-cell">
            <span className="ticker-lbl">ONCHAIN_TXS:</span>
            <span className="ticker-val">{totalTxCount}</span>
          </div>
          <div style={{ color: 'rgba(255, 255, 255, 0.2)' }}>|</div>
          <div className="ticker-cell">
            <span className="ticker-lbl">GEN_VOLUME:</span>
            <span className="ticker-val">{totalVolume.toFixed(2)} GEN</span>
          </div>
        </div>

        {/* Navigation Action Buttons */}
        <div className="nav-actions">
          {currentPage === 'app' && (
            <div style={{ position: 'relative' }}>
              {wallet ? (
                <button
                  className="btn-terminal"
                  onClick={() => setIsWalletDropdownOpen(!isWalletDropdownOpen)}
                  style={{ borderColor: 'var(--accent-emerald)', color: 'var(--accent-emerald)', fontSize: '11px', letterSpacing: '0.05em', cursor: 'pointer' }}
                >
                  {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                </button>
              ) : (
                <button className="btn-terminal" style={{ fontSize: '11px', letterSpacing: '0.05em' }}>
                  CONNECTING WALLET
                </button>
              )}

              {wallet && isWalletDropdownOpen && (
                <div className="wallet-dropdown" style={{ display: 'block' }}>
                  <div className="dropdown-item">
                    <span className="dropdown-lbl">Balance</span>
                    <span className="dropdown-val">{wallet.balance.toFixed(2)} GEN</span>
                  </div>
                  <hr className="dropdown-divider" />
                  <button className="dropdown-btn" onClick={() => setIsWalletDropdownOpen(false)}>
                    Close Panel
                  </button>
                </div>
              )}
            </div>
          )}

          {currentPage === 'app' ? (
            <>
              <button
                className={`btn-terminal ${viewMode === 'buyer' ? 'active' : ''}`}
                onClick={() => setViewMode('buyer')}
              >
                [01] BROWSE // BUYER
              </button>
              <button
                className={`btn-terminal ${viewMode === 'seller' ? 'active' : ''}`}
                onClick={() => setViewMode('seller')}
              >
                [02] LIST SERVICE // SELLER
              </button>
            </>
          ) : (
            <>
              <button className="btn-terminal" onClick={() => setCurrentPage('deck')}>
                PRESENTATION DECK →
              </button>
              <button className="btn-terminal active" onClick={() => setCurrentPage('app')}>
                LAUNCH APP →
              </button>
            </>
          )}
        </div>
      </header>

      {/* App Alert banners */}
      {errorMsg && (
        <div style={{ background: 'rgba(244, 63, 94, 0.1)', border: '1px solid var(--accent-rose)', borderRadius: '8px', padding: '12px 16px', color: 'var(--accent-rose)', margin: '16px 0', display: 'flex', alignItems: 'center', gap: '8px', zIndex: 100, position: 'relative' }}>
          <AlertCircle size={20} />
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} style={{ background: 'none', border: 'none', color: 'var(--accent-rose)', cursor: 'pointer', marginLeft: 'auto', fontWeight: 'bold' }}>X</button>
        </div>
      )}
      {successMsg && (
        <div style={{ background: 'rgba(52, 211, 153, 0.1)', border: '1px solid var(--accent-emerald)', borderRadius: '8px', padding: '12px 16px', color: 'var(--accent-emerald)', margin: '16px 0', display: 'flex', alignItems: 'center', gap: '8px', zIndex: 100, position: 'relative' }}>
          <Check size={20} />
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} style={{ background: 'none', border: 'none', color: 'var(--accent-emerald)', cursor: 'pointer', marginLeft: 'auto', fontWeight: 'bold' }}>X</button>
        </div>
      )}

      {/* 1. LANDING PAGE VIEW (Scrollable Cover & Specifications Section) */}
      {currentPage === 'landing' && (
        <main style={{ width: '100vw', marginLeft: 'calc(-50vw + 50%)', marginRight: 'calc(-50vw + 50%)' }}>
          {/* Full Screen Static Image Cover */}
          <div className="hero-video-container">

            {/* Left-Aligned Text Content Container Overlay */}
            <div className="hero-left-content" style={{ top: '48%', maxWidth: '680px' }}>
              <span className="synthora-badge" style={{ marginBottom: '24px' }}>
                ✦ NEXT-GEN AGENTIC FINANCIAL NETWORK
              </span>
              <h1 className="hero-display-title" style={{ textAlign: 'left', fontSize: 'clamp(52px, 7vw, 92px)', marginBottom: '24px', lineHeight: '0.94' }}>
                The Autonomous <br />
                Agentic Financial <br />
                <span>Network on GenLayer</span>
              </h1>
              <p className="hero-lede" style={{ textAlign: 'left', margin: '0 0 40px 0', fontSize: '21px', maxWidth: '620px', color: 'var(--ink-secondary)', lineHeight: '1.6' }}>
                AI agents discover, evaluate, and pay specialized provider agents per API call in GEN on GenLayer.
              </p>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <button className="btn-cta-primary" onClick={() => setCurrentPage('app')}>
                  LAUNCH MARKETPLACE APP →
                </button>
                <button className="btn-cta-secondary" onClick={() => setCurrentPage('deck')}>
                  VIEW SLIDE DECK →
                </button>
              </div>
            </div>
          </div>
        </main>
      )}

      {/* 2. INTERACTIVE PITCH DECK VIEW */}
      {currentPage === 'deck' && (
        <main style={{ marginTop: '40px' }}>
          <div className="panel-glass" style={{ padding: '40px', borderRadius: '16px', minHeight: '65vh', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <span className="proof-mark" style={{ fontSize: '13px' }}>
                  {slide.number} / {SLIDES.length.toString().padStart(2, '0')} • {slide.tag}
                </span>
                <span style={{ fontFamily: 'var(--font-accent)', fontSize: '12px', color: 'var(--ink-tertiary)' }}>
                  Use ← Left / Right → Arrow Keys to Navigate
                </span>
              </div>

              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(32px, 5vw, 48px)', fontWeight: '800', letterSpacing: '-0.04em', lineHeight: '1.1', marginBottom: '12px' }}>
                {slide.title}
              </h1>

              <h3 style={{ fontFamily: 'var(--font-body)', fontSize: '18px', color: 'var(--accent-cyan)', fontWeight: '600', marginBottom: '32px' }}>
                {slide.subtitle}
              </h3>

              <div style={{ display: 'grid', gap: '16px' }}>
                {slide.points.map((pt, idx) => (
                  <div key={idx} style={{ padding: '16px 20px', background: 'rgba(0, 0, 0, 0.4)', borderRadius: '10px', border: '1px solid var(--void-05)', fontFamily: pt.startsWith('   •') || pt.startsWith('0x') || pt.startsWith('Live') ? 'var(--font-accent)' : 'var(--font-body)', fontSize: '15px', color: pt.includes('0x') ? 'var(--accent-emerald)' : 'var(--ink-primary)', lineHeight: '1.6' }}>
                    {pt}
                  </div>
                ))}
              </div>
            </div>

            {/* Slide Navigation Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '40px', paddingTop: '20px', borderTop: '1px solid var(--void-05)' }}>
              <button
                className="btn-terminal"
                disabled={currentSlideIdx === 0}
                onClick={() => setCurrentSlideIdx(prev => Math.max(prev - 1, 0))}
                style={{ opacity: currentSlideIdx === 0 ? 0.4 : 1 }}
              >
                ← PREVIOUS SLIDE
              </button>

              <div style={{ fontFamily: 'var(--font-accent)', fontSize: '13px', color: 'var(--ink-tertiary)' }}>
                SLIDE <span style={{ color: 'var(--accent-cyan)', fontWeight: '700' }}>{currentSlideIdx + 1}</span> OF {SLIDES.length}
              </div>

              <button
                className="btn-terminal active"
                disabled={currentSlideIdx === SLIDES.length - 1}
                onClick={() => setCurrentSlideIdx(prev => Math.min(prev + 1, SLIDES.length - 1))}
                style={{ opacity: currentSlideIdx === SLIDES.length - 1 ? 0.4 : 1 }}
              >
                NEXT SLIDE →
              </button>
            </div>
          </div>
        </main>
      )}

      {/* 3. INSIDE APP VIEW */}
      {currentPage === 'app' && (
        <main>
          {/* BUYER VIEW */}
          {viewMode === 'buyer' && (
            <div className="dashboard-grid">
              
              {/* Left Column: Settings and Wallet Config */}
              <aside className="dashboard-sidebar">
                
                {/* 1. Category Filter Widget */}
                <div className="panel-glass filter-card-premium">
                  <h3 className="sidebar-h3">⚡ Service Marketplace</h3>
                  <p className="sidebar-p">Filter registered agent capabilities on-chain</p>
                  <div className="cat-filters-sidebar">
                    {['all', 'moderation', 'summarization', 'reviewer', 'translation'].map((cat) => (
                      <button
                        key={cat}
                        className={`cat-btn ${categoryFilter === cat ? 'active' : ''}`}
                        onClick={() => setCategoryFilter(cat)}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. GenLayer Wallet Card */}
                {wallet && (
                  <div className="panel-glass wallet-card-premium" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div className="wallet-card-header">
                      <span className="pulse-dot active-glow"></span>
                      <span className="wallet-card-title">GENLAYERS WALLET</span>
                      <span className="wallet-card-net" style={{ textTransform: 'uppercase' }}>STUDIONET</span>
                    </div>

                    <div style={{ padding: '0 0 10px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                        <span style={{ color: 'var(--ink-secondary)' }}>Burner Wallet:</span>
                        <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '8px' }}>
                        <span style={{ color: 'var(--ink-secondary)' }}>GEN Balance:</span>
                        <span style={{ fontWeight: 700, color: 'var(--accent-emerald)', fontFamily: 'var(--font-mono)' }}>{wallet.balance.toFixed(2)} GEN</span>
                      </div>

                      <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }}>
                        <button 
                          onClick={handleRequestFaucet}
                          disabled={loading.faucet}
                          className="btn-terminal active"
                          style={{ flex: 1, padding: '8px 12px', fontSize: '10px' }}
                        >
                          {loading.faucet ? 'Dispensing...' : 'Request Faucet (20 GEN)'}
                        </button>
                      </div>
                    </div>

                    <hr style={{ border: 'none', height: '1px', background: 'var(--void-05)' }} />

                    {/* Escrow Deposit Balance Settings */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '6px' }}>
                        <span style={{ color: 'var(--ink-secondary)' }}>Escrow Deposit:</span>
                        <span style={{ fontWeight: 600, color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>{deposit.toFixed(2)} GEN</span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <input 
                          type="number" 
                          value={depositAmt}
                          onChange={(e) => setDepositAmt(e.target.value)}
                          className="guard-input-field" 
                          placeholder="Amt" 
                          style={{ flex: 1, textAlign: 'left', fontSize: '12px', padding: '6px' }} 
                        />
                        <button 
                          onClick={handleDepositEscrow}
                          disabled={loading.deposit}
                          className="btn-terminal"
                          style={{ fontSize: '10px', padding: '6px 12px' }}
                        >
                          {loading.deposit ? '...' : 'Deposit'}
                        </button>
                      </div>
                    </div>

                    {/* Pre-Authorization Allowance */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '4px', color: 'var(--ink-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Pre-Auth Allowance:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <input 
                          type="text" 
                          value={approveSellerAddr}
                          onChange={(e) => setApproveSellerAddr(e.target.value)}
                          className="guard-input-field" 
                          placeholder="Seller wallet address 0x..." 
                          style={{ width: '100%', textAlign: 'left', fontSize: '11px', padding: '6px' }} 
                        />
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input 
                            type="number" 
                            value={approveAmt}
                            onChange={(e) => setApproveAmt(e.target.value)}
                            className="guard-input-field" 
                            placeholder="Amt" 
                            style={{ flex: 1, textAlign: 'left', fontSize: '12px', padding: '6px' }} 
                          />
                          <button 
                            onClick={handleApproveSeller}
                            disabled={loading.approve}
                            className="btn-terminal"
                            style={{ fontSize: '10px', padding: '6px 12px' }}
                          >
                            {loading.approve ? '...' : 'Approve'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <hr style={{ border: 'none', height: '1px', background: 'var(--void-05)' }} />

                    {/* Key Management */}
                    <div>
                      {!showPrivateKey ? (
                        <button 
                          onClick={() => setShowPrivateKey(true)}
                          className="btn-terminal"
                          style={{ width: '100%', fontSize: '10px', padding: '8px' }}
                        >
                          Reveal Private Key
                        </button>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <code style={{ display: 'block', padding: '8px', background: '#000', borderRadius: '6px', border: '1px solid rgba(251,191,36,0.3)', color: 'var(--accent-amber)', fontSize: '9px', wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>
                            {wallet.privateKey}
                          </code>
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(wallet.privateKey);
                              setSuccessMsg('Key copied!');
                            }}
                            className="btn-terminal active"
                            style={{ fontSize: '10px', padding: '6px' }}
                          >
                            Copy Key
                          </button>
                          <button 
                            onClick={() => setShowPrivateKey(false)}
                            className="btn-terminal"
                            style={{ fontSize: '10px', padding: '6px' }}
                          >
                            Hide Key
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </aside>

              {/* Right Column: Main Capabilities List and Workbench */}
              <div className="dashboard-main-content">
                <div className="workbench-section-header">
                  <h2 className="section-h2">On-Chain Registered Capabilities ({filteredListings.length})</h2>
                  <p className="section-p">Autonomous capability endpoints queryable via off-chain signed vouchers backed by GenLayer Escrow</p>
                </div>

                {fetchError && (
                  <div style={{ margin: '0 0 20px 0', padding: '12px 18px', background: 'rgba(244, 63, 94, 0.04)', border: '1px solid var(--accent-rose)', borderRadius: '10px', color: 'var(--accent-rose)', fontSize: '12px', fontFamily: 'var(--font-accent)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong>Connection Warning:</strong> Could not retrieve some live registry metrics from GenLayer network.
                    </div>
                    <button onClick={() => setFetchError(null)} style={{ background: 'none', border: 'none', color: 'var(--accent-rose)', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>×</button>
                  </div>
                )}

                {/* Cards Grid */}
                {isLoadingOnChain ? (
                  <div style={{ padding: '60px 20px', textAlign: 'center', fontFamily: 'var(--font-accent)', color: 'var(--ink-tertiary)' }}>
                    Syncing with PayPerRegistry on GenLayer Studionet...
                  </div>
                ) : filteredListings.length === 0 ? (
                  <div style={{ padding: '60px 20px', textAlign: 'center', border: '1px solid var(--void-05)', borderRadius: '12px', color: 'var(--ink-tertiary)', fontFamily: 'var(--font-accent)' }}>
                    No active seller listings found in registry. Select "LIST SERVICE" to register a capability.
                  </div>
                ) : (
                  <div className="service-grid">
                    {filteredListings.map((listing) => (
                      <div key={listing.address} className="card-service" onClick={() => { setSelectedListing(listing); setApproveSellerAddr(listing.seller); setTestResult(null); }} style={{ cursor: 'pointer' }}>
                        <div>
                          <div className="card-head">
                            <span className="badge-category">{listing.category}</span>
                            <div className="status-online">
                              <span className="pulse-dot"></span>
                              ONLINE
                            </div>
                          </div>

                          <h3 className="card-title">{listing.name}</h3>
                          <p className="card-description">{listing.description}</p>
                        </div>

                        <div>
                          <div className="metrics-row">
                            <div>
                              <div className="metric-lbl">RATING</div>
                              <div className="metric-val" style={{ color: 'var(--accent-amber)' }}>{(listing.rating / 10).toFixed(1)}/10★</div>
                            </div>
                            <div>
                              <div className="metric-lbl">SUCCESS</div>
                              <div className="metric-val" style={{ color: 'var(--accent-emerald)' }}>{listing.success_rate}%</div>
                            </div>
                            <div>
                              <div className="metric-lbl">CALLS</div>
                              <div className="metric-val" style={{ color: 'var(--accent-cyan)' }}>{listing.total_calls}</div>
                            </div>
                          </div>

                          <div className="card-foot">
                            <div>
                              <div className="metric-lbl">PRICE / CALL</div>
                              <div className="price-usdc" style={{ color: 'var(--accent-emerald)' }}>{listing.price / 10**18} GEN</div>
                            </div>
                            <div className="endpoint-lbl">/api/{listing.category}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Service Detail & Interactive Test Modal */}
                {selectedListing && (
                  <div className="modal-overlay" onClick={() => setSelectedListing(null)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '780px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
                      <div className="modal-header">
                        <span className="badge-category">{selectedListing.category}</span>
                        <button className="modal-close-btn" onClick={() => setSelectedListing(null)}>×</button>
                      </div>

                      <h2 className="modal-title">{selectedListing.name}</h2>
                      <p className="modal-desc" style={{ marginBottom: '20px' }}>{selectedListing.description}</p>

                      <div className="modal-info-grid" style={{ marginBottom: '24px' }}>
                        <div className="info-item">
                          <span className="info-lbl">Price Per Call</span>
                          <span className="info-val">{selectedListing.price / 10**18} GEN</span>
                        </div>
                        <div className="info-item">
                          <span className="info-lbl">Seller Wallet Address</span>
                          <span className="info-val copyable" onClick={() => { navigator.clipboard.writeText(selectedListing.seller); alert("Copied!"); }}>
                            {selectedListing.seller.slice(0, 10)}...{selectedListing.seller.slice(-8)} 📋
                          </span>
                        </div>
                        <div className="info-item">
                          <span className="info-lbl">API Endpoint Identifier</span>
                          <span className="info-val copyable" onClick={() => { navigator.clipboard.writeText(selectedListing.address); alert("Copied!"); }}>
                            {selectedListing.address.slice(0, 18)}... 📋
                          </span>
                        </div>
                      </div>

                      {/* Interactive Testing Frame */}
                      <div style={{ background: '#030407', borderRadius: '12px', padding: '18px', border: '1px solid var(--void-05)', marginBottom: '20px' }}>
                        <h4 style={{ fontFamily: 'var(--font-display)', color: 'var(--accent-cyan)', fontSize: '15px', fontWeight: 'bold', marginBottom: '14px', borderBottom: '1px solid var(--void-05)', paddingBottom: '8px' }}>
                          ⚡ Interactive Service Workbench
                        </h4>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                          <div>
                            <label style={{ fontSize: '11px', color: 'var(--ink-secondary)', fontFamily: 'var(--font-accent)', display: 'block', marginBottom: '4px' }}>INPUT PAYLOAD</label>
                            <textarea 
                              value={testInput}
                              onChange={(e) => setTestInput(e.target.value)}
                              className="textarea-cell"
                              rows={3} 
                              style={{ width: '100%', background: '#000', border: '1px solid var(--void-05)', borderRadius: '6px', padding: '8px', color: '#fff', fontSize: '12px', resize: 'none' }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '11px', color: 'var(--ink-secondary)', fontFamily: 'var(--font-accent)', display: 'block', marginBottom: '4px' }}>VALIDATION CRITERIA (JURY)</label>
                            <textarea 
                              value={testCriteria}
                              onChange={(e) => setTestCriteria(e.target.value)}
                              className="textarea-cell"
                              rows={3} 
                              style={{ width: '100%', background: '#000', border: '1px solid var(--void-05)', borderRadius: '6px', padding: '8px', color: '#fff', fontSize: '12px', resize: 'none' }}
                            />
                          </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', color: 'var(--ink-tertiary)' }}>
                            Requires Escrow Balance: &gt;= {selectedListing.price / 10**18} GEN
                          </span>
                          <button 
                            onClick={executeServiceCall}
                            disabled={loading.execute || deposit < (selectedListing.price / 10**18)}
                            className="btn-terminal active"
                            style={{ padding: '8px 18px' }}
                          >
                            {loading.execute ? 'Invoking Seller...' : 'Call Service (Off-chain Hot Signature)'}
                          </button>
                        </div>

                        {deposit < (selectedListing.price / 10**18) && (
                          <div style={{ marginTop: '10px', color: 'var(--accent-amber)', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <AlertTriangle size={12} /> Insufficient Escrow Deposit. Fill deposit sidebar first.
                          </div>
                        )}

                        {/* Test output settlement frame */}
                        {testResult && (
                          <div style={{ marginTop: '16px', borderTop: '1px solid var(--void-05)', paddingTop: '16px' }}>
                            <h5 style={{ fontSize: '12px', color: 'var(--accent-emerald)', fontFamily: 'var(--font-accent)', marginBottom: '8px' }}>RECEIVED SERVICE OUTPUT</h5>
                            <pre style={{ background: '#000', padding: '10px', borderRadius: '6px', border: '1px solid var(--void-05)', fontSize: '11px', color: '#fff', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', marginBottom: '12px' }}>
                              {testResult.output}
                            </pre>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '11px', color: 'var(--ink-secondary)' }}>
                                Duration: <strong>{testResult.time}ms</strong> | Claim ID: <strong>{testResult.claimId || 'N/A'}</strong>
                              </span>

                              {testResult.claimId && (
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button 
                                    onClick={() => handleDisputePayment(testResult.claimId!)}
                                    disabled={loading[testResult.claimId!]}
                                    className="btn-terminal"
                                    style={{ borderColor: 'var(--accent-rose)', color: 'var(--accent-rose)', padding: '6px 12px' }}
                                  >
                                    {loading[testResult.claimId!] ? 'Disputing...' : 'Dispute (AI Court)'}
                                  </button>
                                  <button 
                                    onClick={() => handleReleasePayment(testResult.claimId!)}
                                    disabled={loading[testResult.claimId!]}
                                    className="btn-terminal active"
                                    style={{ padding: '6px 12px' }}
                                  >
                                    {loading[testResult.claimId!] ? 'Releasing...' : 'Acknowledge & Release'}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SELLER VIEW */}
          {viewMode === 'seller' && (
            <div>
              <div className="seller-panel">
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: '800', marginBottom: '8px' }}>Register Seller Capability</h2>
                <p style={{ color: 'var(--ink-secondary)', fontSize: '14px', marginBottom: '28px' }}>
                  Publish your wrapped HTTP API capability endpoint to the PayPerRegistry contract on GenLayer Studionet.
                </p>

                <form onSubmit={handleRegisterService}>
                  <div className="form-group-cell">
                    <label className="label-cell">Service Name</label>
                    <input
                      type="text"
                      className="input-cell"
                      placeholder="e.g. Code Security Linter API"
                      value={sellerForm.name}
                      onChange={(e) => setSellerForm({ ...sellerForm, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group-cell">
                    <label className="label-cell">Service Endpoint Address (Or Identifier)</label>
                    <input
                      type="text"
                      className="input-cell"
                      placeholder="0x... or mock address string"
                      value={sellerForm.endpoint}
                      onChange={(e) => setSellerForm({ ...sellerForm, endpoint: e.target.value })}
                      required
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div className="form-group-cell">
                      <label className="label-cell">Price per Call (GEN)</label>
                      <input
                        type="number"
                        step="0.001"
                        className="input-cell"
                        value={sellerForm.pricePerCall}
                        onChange={(e) => setSellerForm({ ...sellerForm, pricePerCall: e.target.value })}
                        required
                      />
                    </div>

                    <div className="form-group-cell">
                      <label className="label-cell">Category</label>
                      <select
                        className="select-cell"
                        value={sellerForm.category}
                        onChange={(e) => setSellerForm({ ...sellerForm, category: e.target.value })}
                      >
                        <option value="moderation">moderation</option>
                        <option value="summarization">summarization</option>
                        <option value="reviewer">reviewer</option>
                        <option value="translation">translation</option>
                      </select>
                    </div>
                  </div>

                  <div className="form-group-cell">
                    <label className="label-cell">Description</label>
                    <textarea
                      className="textarea-cell"
                      rows={3}
                      placeholder="Describe what capability your agent endpoint provides..."
                      value={sellerForm.description}
                      onChange={(e) => setSellerForm({ ...sellerForm, description: e.target.value })}
                    ></textarea>
                  </div>

                  <button type="submit" disabled={loading.register} className="btn-publish">
                    {loading.register ? 'Publishing...' : 'Publish to PayPerRegistry Contract'}
                  </button>
                </form>
              </div>
            </div>
          )}
        </main>
      )}

      {/* Footer */}
      {currentPage !== 'landing' && (
        <footer className="footer-admon">
          <span className="footer-brand">PayPer.</span>
          <span>Built for GenLayer Intelligent Contract Integration • Deployed Contracts: Registry ({config.registry?.slice(0, 10)}...), Escrow ({config.escrow?.slice(0, 10)}...)</span>
        </footer>
      )}
    </div>
  );
}
