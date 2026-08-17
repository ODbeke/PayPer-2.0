import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Wallet, Shield, Cpu, Terminal, Plus, Check, RefreshCw, Key, 
  ArrowRight, Settings, ExternalLink, AlertTriangle, AlertCircle, Play
} from 'lucide-react';
import { ethers } from 'ethers';
import './App.css';

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

interface ClaimRecord {
  id: string;
  buyer: string;
  seller: string;
  service_address: string;
  amount: number;
  response_time_ms: number;
  input: string;
  output: string;
  criteria: string;
  status: string; // PENDING, SETTLED, DISPUTED, REFUNDED
  timestamp: string;
  verdict_reason: string;
}

interface ConsoleLog {
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'consensus';
  message: string;
}

function App() {
  // --- States ---
  const [wallet, setWallet] = useState<BurnerWallet | null>(null);
  const [config, setConfig] = useState<ContractConfig>({ registry: '', escrow: '', faucet: '' });
  const [activeTab, setActiveTab] = useState<'buyer' | 'seller' | 'console' | 'settings'>('buyer');
  const [services, setServices] = useState<ServiceListing[]>([]);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [deposit, setDeposit] = useState<number>(0);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [showPrivateKey, setShowPrivateKey] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form states
  const [regForm, setRegForm] = useState({ name: '', price: '0.01', category: 'summarization', description: '', contractAddress: '' });
  const [depositAmt, setDepositAmt] = useState('0.05');
  const [approveAmt, setApproveAmt] = useState('0.05');
  const [approveSellerAddr, setApproveSellerAddr] = useState('');
  
  // Buyer test frame states
  const [selectedService, setSelectedService] = useState<ServiceListing | null>(null);
  const [testInput, setTestInput] = useState('Write an analysis of blockchain scaling solutions in 2 sentences.');
  const [testCriteria, setTestCriteria] = useState('Must mention Layer 2 and Rollups. Must be exactly 2 sentences.');
  const [testResult, setTestResult] = useState<{ output: string; time: number; claimId?: string } | null>(null);

  const consoleEndRef = useRef<HTMLDivElement>(null);

  // --- Console Logging Helper ---
  const log = useCallback((message: string, type: ConsoleLog['type'] = 'info') => {
    const time = new Date().toLocaleTimeString();
    setConsoleLogs(prev => [...prev, { timestamp: time, type, message }]);
  }, []);

  // Auto-scroll console
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLogs]);

  // --- Load / Create Burner Wallet ---
  useEffect(() => {
    let key = localStorage.getItem('payper_burner_key');
    let walletInstance: ethers.Wallet;
    
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
  }, [log]);

  // --- Fetch Config and Balances ---
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/config`);
      const data = await res.json();
      setConfig(data);
      if (!data.registry) {
        log('No contracts deployed. Please click "Deploy Contracts" in settings.', 'warning');
      } else {
        log(`Contracts loaded. Registry: ${data.registry.substring(0, 10)}...`, 'info');
      }
    } catch (e) {
      log(`Failed to connect to backend bridge server: ${e}`, 'error');
    }
  }, [log]);

  const updateBalancesAndData = useCallback(async () => {
    if (!wallet) return;

    // Get burner native balance
    try {
      const response = await fetch('http://127.0.0.1:4000/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getBalance',
          params: [wallet.address, 'latest'],
          id: 1
        })
      });
      const data = await response.json();
      if (data.result) {
        const balWei = BigInt(data.result);
        const balGen = Number(balWei) / 10**18;
        setWallet(prev => prev ? { ...prev, balance: balGen } : null);
      }
    } catch (e) {
      // Quietly ignore or log
    }

    // Get escrow deposit balance
    if (config.escrow) {
      try {
        const res = await fetch(`${API_BASE}/escrow/deposit?user=${wallet.address}`);
        const data = await res.json();
        if (data.deposit !== undefined) {
          setDeposit(data.deposit / 10**18);
        }
      } catch (e) {}
    }

    // Fetch services list
    if (config.registry) {
      try {
        const res = await fetch(`${API_BASE}/registry/services`);
        const data = await res.json();
        if (Array.isArray(data)) {
          setServices(data);
        }
      } catch (e) {}
    }

    // Fetch claims list
    if (config.escrow) {
      try {
        const res = await fetch(`${API_BASE}/escrow/claims`);
        const data = await res.json();
        if (Array.isArray(data)) {
          setClaims(data);
        }
      } catch (e) {}
    }
  }, [wallet, config, setWallet]);

  // Initial load
  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Live polling
  useEffect(() => {
    if (wallet && config.registry) {
      updateBalancesAndData();
      const interval = setInterval(updateBalancesAndData, 5000);
      return () => clearInterval(interval);
    }
  }, [wallet, config, updateBalancesAndData]);

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

  // --- Form Action Submissions ---

  const handleDeployContracts = async () => {
    setLoading(prev => ({ ...prev, deploy: true }));
    setErrorMsg(null);
    log('Compiling and deploying Intelligent Contracts to GenLayer...', 'info');
    try {
      const res = await fetch(`${API_BASE}/deploy`, { method: 'POST' });
      const data = await res.json();
      if (data.registry) {
        setConfig(data);
        log(`Contracts deployed successfully! Registry: ${data.registry}`, 'success');
        log(`Faucet funded with 100 GEN reservoir balance.`, 'success');
        setSuccessMsg('GenLayer Intelligent Contracts successfully compiled and deployed!');
        updateBalancesAndData();
      } else {
        setErrorMsg(data.error || 'Deployment failed');
        log(`Deployment failed: ${data.error}`, 'error');
      }
    } catch (e: any) {
      setErrorMsg(e.message);
      log(`Deployment error: ${e.message}`, 'error');
    } finally {
      setLoading(prev => ({ ...prev, deploy: false }));
    }
  };

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
        log(`Faucet payout processed successfully! Tx: ${data.tx_hash.substring(0, 16)}...`, 'success');
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

  const handleRegisterService = async () => {
    if (!wallet) return;
    setLoading(prev => ({ ...prev, register: true }));
    const priceWei = ethers.parseEther(regForm.price).toString();
    log(`Registering service "${regForm.name}" in directory...`, 'info');
    try {
      // Mock unique contract address for listing representation
      const mockContractAddr = regForm.contractAddress || ethers.Wallet.createRandom().address;
      const res = await fetch(`${API_BASE}/registry/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          private_key: wallet.privateKey,
          service_address: mockContractAddr,
          name: regForm.name,
          price: priceWei,
          category: regForm.category,
          description: regForm.description
        })
      });
      const data = await res.json();
      if (data.tx_hash) {
        log(`Service registered successfully! Tx: ${data.tx_hash.substring(0, 16)}...`, 'success');
        setSuccessMsg(`Registered service "${regForm.name}" under address ${mockContractAddr}.`);
        setRegForm({ name: '', price: '0.01', category: 'summarization', description: '', contractAddress: '' });
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
    if (!wallet || !selectedService) return;
    setLoading(prev => ({ ...prev, execute: true }));
    setTestResult(null);
    log(`[GOAL_RUNNER] Invoking service: ${selectedService.name} (Price: ${selectedService.price / 10**18} GEN)...`, 'info');
    
    // Simulate off-chain LLM processing delay
    setTimeout(async () => {
      let outputText = "";
      const isSummarize = selectedService.category === 'summarization';
      
      if (isSummarize) {
        outputText = "Layer 2 solutions improve blockchain scaling by processing transactions off-chain via Rollups. The finalized state transitions are then committed securely to Layer 1.";
      } else {
        outputText = "Code Analysis: No critical vulnerabilities found. 2 warnings: Unused state variable at line 42, missing return type on line 87.";
      }

      const durationMs = 120 + Math.floor(Math.random() * 80);
      log(`[OFF_CHAIN] Received output payload from seller in ${durationMs}ms.`, 'success');
      
      // Programmatically sign transaction voucher off-chain using the burner wallet
      log(`[BURNER_WALLET] Programmatically signing claim voucher authorization...`, 'success');
      const hashMsg = ethers.solidityPackedKeccak256(
        ['address', 'address', 'uint256', 'string'],
        [wallet.address, selectedService.seller, selectedService.price, outputText]
      );
      const signature = await new ethers.Wallet(wallet.privateKey).signMessage(ethers.getBytes(hashMsg));
      log(`[BURNER_WALLET] Voucher signed: ${signature.substring(0, 24)}... (Off-chain delay: 0.1ms)`, 'success');

      // Dispatching claim settlement to escrow contract
      log(`[ESCROW] Submitting signed claim to on-chain PayPerEscrow contract...`, 'info');
      try {
        const res = await fetch(`${API_BASE}/escrow/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            private_key: wallet.privateKey, // Claim signed by user/seller
            buyer: wallet.address,
            service_address: selectedService.address,
            amount: selectedService.price.toString(),
            response_time_ms: durationMs,
            input: testInput,
            output: outputText,
            criteria: testCriteria
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
    setTimeout(() => log(`[AI_COURT] Leader validator chosen. Compiling prompt verdict...`, 'consensus'), 2000);
    setTimeout(() => log(`[AI_COURT] Validator 1 (US Node): vote=AGREE (verdict=INVALID)`, 'consensus'), 4000);
    setTimeout(() => log(`[AI_COURT] Validator 2 (EU Node): vote=AGREE (verdict=INVALID)`, 'consensus'), 6000);
    setTimeout(() => log(`[AI_COURT] Validator 3 (AS Node): vote=AGREE (verdict=INVALID)`, 'consensus'), 8000);
    
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

  // --- Render ---

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '24px 16px', position: 'relative' }}>
      <div className="bg-grid"></div>

      {/* App Alert banners */}
      {errorMsg && (
        <div style={{ background: 'var(--accent-red-glow)', border: '1px solid var(--accent-red-border)', borderRadius: '8px', padding: '12px 16px', color: 'var(--accent-red)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
          <AlertCircle size={20} />
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', marginLeft: 'auto', fontWeight: 'bold' }}>X</button>
        </div>
      )}
      {successMsg && (
        <div style={{ background: 'var(--accent-green-glow)', border: '1px solid var(--accent-green-border)', borderRadius: '8px', padding: '12px 16px', color: 'var(--accent-green)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Check size={20} />
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} style={{ background: 'none', border: 'none', color: 'var(--accent-green)', cursor: 'pointer', marginLeft: 'auto', fontWeight: 'bold' }}>X</button>
        </div>
      )}

      {/* App Header */}
      <header className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '32px', margin: 0, fontWeight: 700, letterSpacing: '-0.04em', background: 'linear-gradient(90deg, var(--accent-green), var(--accent-blue))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Cpu size={28} className="terminal-glow-green" style={{ color: 'var(--accent-green)' }} />
            PayPer <span style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', padding: '2px 8px', border: '1px solid var(--border-color-hover)', borderRadius: '4px', color: 'var(--text-primary)' }}>2.0</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>Voucher-based Hot Path AI Marketplace on GenLayer</p>
        </div>

        {/* Contract State Badges */}
        <div style={{ display: 'flex', gap: '8px', fontSize: '0.75rem' }}>
          <span className={`badge ${config.registry ? 'badge-green' : 'badge-red'}`}>
            Registry: {config.registry ? `${config.registry.substring(0, 6)}...` : 'DISCONNECTED'}
          </span>
          <span className={`badge ${config.escrow ? 'badge-green' : 'badge-red'}`}>
            Escrow: {config.escrow ? `${config.escrow.substring(0, 6)}...` : 'DISCONNECTED'}
          </span>
          <span className={`badge ${config.faucet ? 'badge-green' : 'badge-red'}`}>
            Faucet: {config.faucet ? `${config.faucet.substring(0, 6)}...` : 'DISCONNECTED'}
          </span>
        </div>

        {/* Burner Wallet Card */}
        {wallet && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.02)', padding: '6px 14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                {wallet.address.substring(0, 6)}...{wallet.address.substring(38)}
              </span>
              <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--accent-green)', fontFamily: 'var(--font-mono)' }}>
                {wallet.balance.toFixed(2)} GEN
              </span>
            </div>
            <div style={{ background: 'var(--accent-green-glow)', p: '8px', borderRadius: '6px', border: '1px solid var(--accent-green-border)' }}>
              <Wallet size={18} style={{ color: 'var(--accent-green)' }} />
            </div>
          </div>
        )}
      </header>

      {/* Main Content Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '24px', minHeight: '650px' }}>
        
        {/* Navigation Sidebar */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block' }}>NAVIGATION</span>
            <button 
              onClick={() => setActiveTab('buyer')}
              className={`cyber-button ${activeTab === 'buyer' ? 'cyber-button-primary' : ''}`}
              style={{ width: '100%', justifyContent: 'flex-start' }}
            >
              <Cpu size={16} /> Buyer Workspace
            </button>
            <button 
              onClick={() => setActiveTab('seller')}
              className={`cyber-button ${activeTab === 'seller' ? 'cyber-button-secondary' : ''}`}
              style={{ width: '100%', justifyContent: 'flex-start' }}
            >
              <Plus size={16} /> Seller Workspace
            </button>
            <button 
              onClick={() => setActiveTab('console')}
              className={`cyber-button ${activeTab === 'console' ? 'cyber-button-primary' : ''}`}
              style={{ width: '100%', justifyContent: 'flex-start', borderStyle: 'dashed' }}
            >
              <Terminal size={16} /> GenVM Consensus Console
            </button>
            <button 
              onClick={() => setActiveTab('settings')}
              className={`cyber-button ${activeTab === 'settings' ? 'cyber-button-primary' : ''}`}
              style={{ width: '100%', justifyContent: 'flex-start' }}
            >
              <Settings size={16} /> Settings & Deployment
            </button>
          </div>

          {/* Faucet & Escrow Hot Controls */}
          {wallet && config.escrow && (
            <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Escrow Account</span>
              
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Escrow Deposit:</span>
                  <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{deposit.toFixed(2)} GEN</span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input 
                    type="number" 
                    value={depositAmt}
                    onChange={(e) => setDepositAmt(e.target.value)}
                    className="cyber-input" 
                    placeholder="Amt" 
                    style={{ flex: 1, padding: '6px 8px', fontSize: '0.85rem' }} 
                  />
                  <button 
                    onClick={handleDepositEscrow}
                    disabled={loading.deposit}
                    className="cyber-button cyber-button-primary"
                    style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                  >
                    {loading.deposit ? '...' : 'Deposit'}
                  </button>
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Pre-Auth Seller:</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <input 
                    type="text" 
                    value={approveSellerAddr}
                    onChange={(e) => setApproveSellerAddr(e.target.value)}
                    className="cyber-input" 
                    placeholder="Seller address 0x..." 
                    style={{ padding: '6px 8px', fontSize: '0.85rem' }} 
                  />
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input 
                      type="number" 
                      value={approveAmt}
                      onChange={(e) => setApproveAmt(e.target.value)}
                      className="cyber-input" 
                      placeholder="Amt" 
                      style={{ flex: 1, padding: '6px 8px', fontSize: '0.85rem' }} 
                    />
                    <button 
                      onClick={handleApproveSeller}
                      disabled={loading.approve}
                      className="cyber-button"
                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                    >
                      {loading.approve ? '...' : 'Approve'}
                    </button>
                  </div>
                </div>
              </div>

              <hr style={{ border: 'none', height: '1px', background: 'var(--border-color)' }} />
              
              <button 
                onClick={handleRequestFaucet}
                disabled={loading.faucet}
                className="cyber-button cyber-button-secondary"
                style={{ width: '100%', justifyContent: 'center', padding: '8px' }}
              >
                {loading.faucet ? <RefreshCw size={16} className="spin" /> : 'Request Faucet (20 GEN)'}
              </button>
            </div>
          )}
        </aside>

        {/* Dynamic Panel Workspace */}
        <main className="glass-panel" style={{ padding: '24px', overflowY: 'auto' }}>
          
          {/* TAB 1: BUYER WORKSPACE */}
          {activeTab === 'buyer' && (
            <div className="animate-slide-up">
              <h2 style={{ fontSize: '22px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Buyer Service Catalog
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '20px' }}>
                Discover services registered on-chain, pre-fund using escrow deposits, and call them off-chain with programmatic key signatures.
              </p>

              {/* Service list grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                {services.length === 0 ? (
                  <div style={{ gridColumn: '1/-1', border: '1px dashed var(--border-color-hover)', borderRadius: '8px', padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    No services found in registry. Deploy contracts and register a service to get started!
                  </div>
                ) : (
                  services.map((svc) => (
                    <div 
                      key={svc.address} 
                      onClick={() => {
                        setSelectedService(svc);
                        setApproveSellerAddr(svc.seller); // Pre-fill approve seller form
                        setTestResult(null);
                      }}
                      style={{ 
                        border: selectedService?.address === svc.address ? '1px solid var(--accent-green)' : '1px solid var(--border-color)',
                        background: selectedService?.address === svc.address ? 'rgba(0, 255, 102, 0.02)' : 'rgba(255, 255, 255, 0.01)',
                        cursor: 'pointer',
                        padding: '16px',
                        borderRadius: '8px',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span className="badge badge-blue">{svc.category}</span>
                        <span style={{ fontWeight: 700, color: 'var(--accent-green)', fontFamily: 'var(--font-mono)' }}>
                          {svc.price / 10**18} GEN
                        </span>
                      </div>
                      <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '6px' }}>{svc.name}</h3>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', minHeight: '38px', marginBottom: '12px' }}>{svc.description}</p>
                      
                      <div style={{ display: 'flex', gap: '12px', fontSize: '0.75rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                        <span>Calls: <strong>{svc.total_calls}</strong></span>
                        <span>Success: <strong>{svc.success_rate}%</strong></span>
                        <span>Rating: <strong>{(svc.rating / 10).toFixed(1)}★</strong></span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Execution Frame */}
              {selectedService && (
                <div style={{ border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px', background: 'var(--bg-console)' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Play size={18} style={{ color: 'var(--accent-blue)' }} />
                    Service Testing Frame: <span style={{ color: 'var(--accent-blue)' }}>{selectedService.name}</span>
                  </h3>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Input Request Payload</label>
                      <textarea 
                        value={testInput}
                        onChange={(e) => setTestInput(e.target.value)}
                        className="cyber-input" 
                        rows={4} 
                        style={{ resize: 'none', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }} 
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Arbitration Validation Criteria</label>
                      <textarea 
                        value={testCriteria}
                        onChange={(e) => setTestCriteria(e.target.value)}
                        className="cyber-input" 
                        rows={4} 
                        style={{ resize: 'none', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }} 
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Authorized Seller Wallet: <code style={{ fontSize: '0.75rem' }}>{selectedService.seller.substring(0, 10)}...</code>
                    </div>
                    <button 
                      onClick={executeServiceCall}
                      disabled={loading.execute || deposit < (selectedService.price / 10**18)}
                      className="cyber-button cyber-button-secondary"
                    >
                      {loading.execute ? <RefreshCw className="spin" size={16} /> : 'Call Service (Off-chain Hot Signature)'}
                    </button>
                  </div>

                  {deposit < (selectedService.price / 10**18) && (
                    <div style={{ marginTop: '10px', color: 'var(--accent-amber)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <AlertTriangle size={14} />
                      Insufficient Escrow Deposit balance. Please deposit at least {(selectedService.price / 10**18).toFixed(2)} GEN to call this service.
                    </div>
                  )}

                  {/* Results and Settlement Frame */}
                  {testResult && (
                    <div style={{ marginTop: '20px', border: '1px solid var(--border-color-hover)', borderRadius: '8px', padding: '16px', background: 'rgba(0, 229, 255, 0.01)' }}>
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '10px', color: 'var(--accent-blue)' }}>Response Output Payload</h4>
                      <pre style={{ background: '#050608', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.85rem', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', marginBottom: '16px', color: 'var(--text-primary)' }}>
                        {testResult.output}
                      </pre>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          Processing Time: <strong style={{ color: 'var(--text-primary)' }}>{testResult.time}ms</strong> | Claim ID: <strong style={{ color: 'var(--text-primary)' }}>{testResult.claimId || 'N/A'}</strong>
                        </span>

                        {testResult.claimId && (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button 
                              onClick={() => handleDisputePayment(testResult.claimId!)}
                              disabled={loading[testResult.claimId!]}
                              className="cyber-button cyber-button-danger"
                              style={{ padding: '8px 14px', fontSize: '0.85rem' }}
                            >
                              {loading[testResult.claimId!] ? 'Arbitrating...' : 'Dispute (AI Court)'}
                            </button>
                            <button 
                              onClick={() => handleReleasePayment(testResult.claimId!)}
                              disabled={loading[testResult.claimId!]}
                              className="cyber-button cyber-button-primary"
                              style={{ padding: '8px 14px', fontSize: '0.85rem' }}
                            >
                              {loading[testResult.claimId!] ? 'Settling...' : 'Acknowledge & Release'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SELLER WORKSPACE */}
          {activeTab === 'seller' && (
            <div className="animate-slide-up" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              
              {/* Left Column: Register service */}
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>Register AI Service</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
                  Register a service contract or endpoint in the directory to begin accepting pre-authorized payment vouchers.
                </p>

                <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Service Name</label>
                    <input 
                      type="text" 
                      value={regForm.name}
                      onChange={(e) => setRegForm(prev => ({ ...prev, name: e.target.value }))}
                      className="cyber-input" 
                      placeholder="e.g. GPT-4 Code Reviewer" 
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Price (GEN)</label>
                      <input 
                        type="number" 
                        step="0.001"
                        value={regForm.price}
                        onChange={(e) => setRegForm(prev => ({ ...prev, price: e.target.value }))}
                        className="cyber-input" 
                        placeholder="0.01" 
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Category</label>
                      <select 
                        value={regForm.category}
                        onChange={(e) => setRegForm(prev => ({ ...prev, category: e.target.value }))}
                        className="cyber-input cyber-select"
                      >
                        <option value="summarization">summarization</option>
                        <option value="moderation">moderation</option>
                        <option value="reviewer">reviewer</option>
                        <option value="translation">translation</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Service Contract Address (Optional)</label>
                    <input 
                      type="text" 
                      value={regForm.contractAddress}
                      onChange={(e) => setRegForm(prev => ({ ...prev, contractAddress: e.target.value }))}
                      className="cyber-input" 
                      placeholder="Auto-generates if left blank" 
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Description</label>
                    <textarea 
                      value={regForm.description}
                      onChange={(e) => setRegForm(prev => ({ ...prev, description: e.target.value }))}
                      className="cyber-input" 
                      rows={3} 
                      placeholder="Summarize the validation parameters of this endpoint..." 
                      style={{ resize: 'none' }}
                    />
                  </div>

                  <button 
                    onClick={handleRegisterService}
                    disabled={loading.register || !regForm.name}
                    className="cyber-button cyber-button-secondary"
                    style={{ justifyContent: 'center', marginTop: '8px' }}
                  >
                    {loading.register ? <RefreshCw className="spin" size={16} /> : 'Register Service Listing'}
                  </button>
                </div>
              </div>

              {/* Right Column: Claims Dashboard */}
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>Payment Claims</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
                  Track incoming billing vouchers and consensus dispute resolutions registered on-chain.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {claims.length === 0 ? (
                    <div style={{ border: '1px dashed var(--border-color-hover)', borderRadius: '8px', padding: '32px', textAlign: 'center', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.05)' }}>
                      No claims logged.
                    </div>
                  ) : (
                    claims.map((claim) => (
                      <div 
                        key={claim.id} 
                        style={{ 
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-console)',
                          padding: '14px',
                          borderRadius: '8px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>{claim.id}</span>
                          <span className={`badge ${
                            claim.status === 'SETTLED' ? 'badge-green' :
                            claim.status === 'PENDING' ? 'badge-amber' : 'badge-red'
                          }`}>{claim.status}</span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                          <div>Buyer: <code style={{ fontSize: '0.75rem' }}>{claim.buyer}</code></div>
                          <div>Service: <code style={{ fontSize: '0.75rem' }}>{claim.service_address.substring(0, 18)}...</code></div>
                          <div>Amount: <strong style={{ color: 'var(--text-primary)' }}>{claim.amount / 10**18} GEN</strong></div>
                        </div>

                        {claim.status === 'PENDING' && wallet?.address.toLowerCase() === claim.buyer.toLowerCase() && (
                          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                            <button 
                              onClick={() => handleDisputePayment(claim.id)}
                              disabled={loading[claim.id]}
                              className="cyber-button cyber-button-danger"
                              style={{ flex: 1, padding: '6px', fontSize: '0.8rem', justifyContent: 'center' }}
                            >
                              {loading[claim.id] ? 'Disputing...' : 'Dispute (AI Court)'}
                            </button>
                            <button 
                              onClick={() => handleReleasePayment(claim.id)}
                              disabled={loading[claim.id]}
                              className="cyber-button cyber-button-primary"
                              style={{ flex: 1, padding: '6px', fontSize: '0.8rem', justifyContent: 'center' }}
                            >
                              {loading[claim.id] ? 'Releasing...' : 'Release Payment'}
                            </button>
                          </div>
                        )}

                        {claim.verdict_reason && (
                          <div style={{ marginTop: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '8px', fontSize: '0.75rem', color: 'var(--accent-amber)' }}>
                            <strong>AI Judge Verdict Reason:</strong> {claim.verdict_reason}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: GENVM CONSENSUS CONSOLE */}
          {activeTab === 'console' && (
            <div className="animate-slide-up" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>GenVM Active Simulator Logs</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
                Real-time consensus validator execution logs and smart contract transaction state updates.
              </p>

              <div style={{ flex: 1, minHeight: '380px', background: '#040507', border: '1px solid var(--border-color-hover)', borderRadius: '8px', padding: '16px', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {consoleLogs.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '160px' }}>
                    --- Console Idle. Call services or dispute payments to view active transactions. ---
                  </div>
                ) : (
                  consoleLogs.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '10px', lineHeight: 1.4 }}>
                      <span style={{ color: 'var(--text-muted)' }}>[{item.timestamp}]</span>
                      <span style={{ 
                        color: 
                          item.type === 'success' ? 'var(--accent-green)' :
                          item.type === 'warning' ? 'var(--accent-amber)' :
                          item.type === 'error' ? 'var(--accent-red)' :
                          item.type === 'consensus' ? 'var(--accent-blue)' : '#cbd5e1'
                      }}>
                        {item.message}
                      </span>
                    </div>
                  ))
                )}
                <div ref={consoleEndRef} />
              </div>
            </div>
          )}

          {/* TAB 4: SETTINGS & DEPLOYMENT */}
          {activeTab === 'settings' && (
            <div className="animate-slide-up" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              
              {/* Contract settings */}
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>Contract Administration</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
                  Deploy new contract iterations or view current address parameters on the GenVM local test network.
                </p>

                <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <button 
                    onClick={handleDeployContracts}
                    disabled={loading.deploy}
                    className="cyber-button cyber-button-primary"
                    style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
                  >
                    {loading.deploy ? <RefreshCw className="spin" size={18} /> : 'Compile & Deploy Contracts'}
                  </button>

                  <hr style={{ border: 'none', height: '1px', background: 'var(--border-color)' }} />

                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Registry Address</label>
                    <input type="text" readOnly value={config.registry} className="cyber-input" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', background: 'rgba(0,0,0,0.1)' }} />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Escrow Address</label>
                    <input type="text" readOnly value={config.escrow} className="cyber-input" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', background: 'rgba(0,0,0,0.1)' }} />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Faucet Address</label>
                    <input type="text" readOnly value={config.faucet} className="cyber-input" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', background: 'rgba(0,0,0,0.1)' }} />
                  </div>
                </div>
              </div>

              {/* Wallet settings */}
              {wallet && (
                <div>
                  <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>Burner Wallet Settings</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
                    Reveal or export your programmatic burner wallet's private key to import it elsewhere.
                  </p>

                  <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Wallet Address</span>
                      <code style={{ display: 'block', padding: '10px', background: 'var(--bg-console)', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                        {wallet.address}
                      </code>
                    </div>

                    <div>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Private Key</span>
                      
                      {!showPrivateKey ? (
                        <button 
                          onClick={() => setShowPrivateKey(true)}
                          className="cyber-button"
                          style={{ width: '100%', justifyContent: 'center', padding: '10px' }}
                        >
                          <Key size={16} /> Reveal Private Key
                        </button>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <code style={{ display: 'block', padding: '10px', background: 'var(--bg-console)', borderRadius: '6px', border: '1px solid var(--accent-amber-border)', color: 'var(--accent-amber)', fontSize: '0.8rem', wordBreak: 'break-all' }}>
                            {wallet.privateKey}
                          </code>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(wallet.privateKey);
                                setSuccessMsg('Private key copied to clipboard!');
                              }}
                              className="cyber-button cyber-button-primary"
                              style={{ flex: 1, padding: '8px', fontSize: '0.85rem', justifyContent: 'center' }}
                            >
                              Copy Key
                            </button>
                            <button 
                              onClick={() => setShowPrivateKey(false)}
                              className="cyber-button"
                              style={{ flex: 1, padding: '8px', fontSize: '0.85rem', justifyContent: 'center' }}
                            >
                              Hide
                            </button>
                          </div>
                          <span style={{ color: 'var(--accent-red)', fontSize: '0.75rem', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <AlertCircle size={12} /> WARNING: Never share this key with anyone. It controls your GEN tokens.
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

        </main>
      </div>

      {/* Footer */}
      <footer style={{ marginTop: '40px', borderTop: '1px solid var(--border-color)', paddingTop: '20px', display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
        <span>&copy; 2026 PayPer 2.0. Powered by GenLayer Intelligent Contracts & AI Consensus.</span>
        <div style={{ display: 'flex', gap: '16px' }}>
          <a href="https://github.com/ODbeke/PayPer-2.0" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}>
            GitHub Repository <ExternalLink size={12} />
          </a>
        </div>
      </footer>
    </div>
  );
}

export default App;
