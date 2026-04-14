import { useState, useEffect } from 'react';
import { useWallet } from '@txnlab/use-wallet-react';
import { 
  Activity, 
  Wallet, 
  PlusCircle, 
  ArrowRightLeft, 
  RefreshCcw,
  Bot as BotIcon,
  LayoutDashboard,
  BarChart3,
  ChevronRight,
  ShieldCheck, 
  AlertCircle, 
  TrendingUp, 
  Gift,
  Zap
} from 'lucide-react';
import algosdk from 'algosdk';
import axios from 'axios';
import MarketList from './components/MarketList';
import RewardsTable from './components/RewardsTable';
import ActivityLog from './components/ActivityLog';


const BACKEND_URL = 'http://localhost:3001';
const USDC_ID = 31566704;

function App() {
  const { activeAccount, wallets, signTransactions, algodClient } = useWallet();
  const activeAddress = activeAccount?.address;
  
  const [currentView, setCurrentView] = useState<'dashboard' | 'markets' | 'rewards' | 'activity'>('dashboard');
  const [botConfig, setBotConfig] = useState<any>(null);
  const [botStatus, setBotStatus] = useState<any>(null);
  const [rewardData, setRewardData] = useState<{ totalEarned: number, history: any[] }>({ totalEarned: 0, history: [] });
  const [activityData, setActivityData] = useState<any[]>([]);
  const [positionsData, setPositionsData] = useState<{ orders: any[], positions: any[] }>({ orders: [], positions: [] });
  const [markets, setMarkets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [refillLoading, setRefillLoading] = useState(false);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const [configRes, statusRes, rewardsRes, activityRes, positionsRes, marketsRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/bot/config`),
        axios.get(`${BACKEND_URL}/api/bot/status`),
        axios.get(`${BACKEND_URL}/api/bot/rewards`),
        axios.get(`${BACKEND_URL}/api/bot/activity`),
        axios.get(`${BACKEND_URL}/api/bot/positions`),
        axios.get(`${BACKEND_URL}/api/markets`)
      ]);
      setBotConfig(configRes.data);
      setBotStatus(statusRes.data);
      setRewardData(rewardsRes.data);
      setActivityData(activityRes.data);
      setPositionsData(positionsRes.data);
      setMarkets(marketsRes.data);
    } catch (err) {
      console.error('Failed to fetch bot data:', err);
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefill = async (amountUSDC: number) => {
    if (!activeAddress || !botConfig) return;
    try {
      setRefillLoading(true);
      const suggestedParams = await algodClient.getTransactionParams().do();
      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: botConfig.address,
        assetIndex: USDC_ID,
        amount: Math.round(amountUSDC * 1_000_000),
        suggestedParams,
      });

      const signedTxns = await signTransactions([txn]);
      const validSignedTxns = signedTxns.filter((t): t is Uint8Array => !!t);
      if (validSignedTxns.length === 0) throw new Error('Transaction not signed');

      const response = await algodClient.sendRawTransaction(validSignedTxns).do();
      const txId = typeof response === 'string' ? response : (response as any).txId;
      await algosdk.waitForConfirmation(algodClient, txId, 4);
      alert(`Successfully sent ${amountUSDC} USDC to bot!`);
      fetchStatus();
    } catch (err: any) {
      alert(`Refill failed: ${err.message}`);
    } finally {
      setRefillLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-72 border-r border-white/10 flex flex-col p-6 space-y-8 bg-black/20 backdrop-blur-md sticky top-0 h-screen">
        <div className="flex items-center gap-3 px-2">
          <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
            <TrendingUp size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tighter leading-none">ALPHA</h1>
            <p className="text-[10px] uppercase tracking-widest text-blue-400 font-bold">ARCADE</p>
          </div>
        </div>

        <nav className="flex-1 space-y-2">
          <button 
            onClick={() => setCurrentView('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${currentView === 'dashboard' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
          >
            <LayoutDashboard size={20} />
            <span className="font-bold text-sm">Dashboard</span>
            {currentView === 'dashboard' && <ChevronRight size={16} className="ml-auto" />}
          </button>
          <button 
            onClick={() => setCurrentView('markets')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${currentView === 'markets' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
          >
            <BarChart3 size={20} />
            <span className="font-bold text-sm">Markets</span>
            {currentView === 'markets' && <ChevronRight size={16} className="ml-auto" />}
          </button>
          <button 
            onClick={() => setCurrentView('rewards')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${currentView === 'rewards' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
          >
            <Gift size={20} />
            <span className="font-bold text-sm">Rewards</span>
            {currentView === 'rewards' && <ChevronRight size={16} className="ml-auto" />}
          </button>
          <button 
            onClick={() => setCurrentView('activity')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${currentView === 'activity' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
          >
            <Activity size={20} />
            <span className="font-bold text-sm">Activity</span>
            {currentView === 'activity' && <ChevronRight size={16} className="ml-auto" />}
          </button>
        </nav>

        <div className="pt-6 border-t border-white/5 space-y-4">
          <div className="bg-white/5 p-4 rounded-2xl border border-white/10 overflow-hidden relative group">
            <div className="absolute top-0 right-0 p-2 opacity-20 group-hover:opacity-40 transition-opacity">
              <ShieldCheck size={40} className="text-blue-500" />
            </div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Connected Hot Wallet</p>
            <p className="text-xs font-mono font-bold truncate text-blue-400">
              {botConfig?.address || 'Searching...'}
            </p>
          </div>

          {/* New: Bot Fleet Monitoring section */}
          <div className="space-y-3">
             <div className="flex items-center justify-between px-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Bot Fleet Monitoring</p>
                <span className="text-[10px] bg-white/5 px-2 py-0.5 rounded-full text-gray-400 font-bold border border-white/10">
                  {botStatus?.fleet?.length || 0} ACTIVE
                </span>
             </div>

             {botStatus?.fleet && botStatus.fleet.length > 0 ? (
               botStatus.fleet.map((bot: any) => (
                <div key={bot.botId} className={`bg-gradient-to-br p-4 rounded-2xl border transition-all from-green-600/10 to-blue-600/10 border-green-500/20`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]`} />
                      <p className="text-[10px] font-black uppercase tracking-widest text-green-400">
                        {bot.name}
                      </p>
                    </div>
                    <span className="text-[8px] text-gray-500 font-bold">
                      {new Date(bot.lastHeartbeat).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase font-bold text-gray-500 tracking-tighter italic">Targeting Market</p>
                    <p className="text-[11px] font-bold text-white leading-tight truncate">
                      {markets.find(m => m.marketAppId === Number(bot.marketId))?.title || `Market #${bot.marketId}`}
                    </p>
                  </div>
                </div>
               ))
             ) : (
                <div className="bg-white/5 p-6 rounded-2xl border border-dashed border-white/10 flex flex-col items-center justify-center text-center">
                  <BotIcon size={20} className="text-gray-600 mb-2" />
                  <p className="text-[10px] font-bold text-gray-500 uppercase">No Active Bots Found</p>
                </div>
             )}
          </div>

          <div className="flex flex-col gap-2 pt-4">
            {!activeAddress ? (
              wallets.map(w => (
                <button 
                  key={w.id}
                  onClick={() => w.connect()}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-white text-black font-bold rounded-xl text-xs hover:bg-gray-200 transition-colors"
                >
                  <Wallet size={16} /> Connect {w.metadata.name}
                </button>
              ))
            ) : (
              <button 
                onClick={() => wallets.find(w => w.isActive)?.disconnect()}
                className="w-full py-3 bg-red-500/10 text-red-500 border border-red-500/20 font-bold rounded-xl text-xs hover:bg-red-500/20 transition-colors"
              >
                Disconnect Wallet
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-12 overflow-y-auto">
        {botStatus?.warning && (
          <div className="mb-6 animate-pulse">
            <div className="bg-yellow-400/10 border border-yellow-400/20 p-4 rounded-2xl flex items-center gap-4">
              <div className="bg-yellow-400/20 p-2 rounded-xl text-yellow-500">
                <AlertCircle size={24} />
              </div>
              <div>
                <h4 className="text-yellow-500 font-bold">Funding Required</h4>
                <p className="text-yellow-500/80 text-sm font-medium">Your hot wallet needs more USDC to place yield-earning orders.</p>
              </div>
              <button 
                onClick={() => window.open(`https://pact.fi/swap?asset_in=0&asset_out=31566704`, '_blank')}
                className="ml-auto bg-yellow-400 text-yellow-950 px-4 py-2 rounded-xl font-bold text-sm hover:bg-yellow-300 transition-colors"
              >
                Get USDC
              </button>
            </div>
          </div>
        )}

        <header className="flex justify-between items-end mb-12">
          <div>
            <h2 className="text-4xl font-black tracking-tight mb-2">
              {currentView === 'dashboard' ? 'Bot Overview' : currentView === 'rewards' ? 'Incentivized Markets' : currentView === 'activity' ? 'Bot History' : 'Alpha Market Explorer'}
            </h2>
            <p className="text-gray-500 font-medium">
              {currentView === 'dashboard' 
                ? 'Monitor and manage your yield earning bot status' 
                : currentView === 'rewards'
                ? 'Markets currently offering additional USDC liquidity incentives'
                : currentView === 'activity'
                ? 'Review the hot wallet audit trail and recent executions'
                : 'Discover live yield-bearing markets on the Alpha Protocol'}
            </p>
          </div>
          {(currentView === 'dashboard' || currentView === 'activity') && (
            <button 
              onClick={fetchStatus}
              className={`p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-all ${loading ? 'animate-spin' : ''}`}
            >
              <RefreshCcw size={20} />
            </button>
          )}
        </header>

        {currentView === 'dashboard' ? (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">
            
            {/* Status Section */}
            <div className="xl:col-span-2 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white/5 border border-white/10 p-8 rounded-3xl relative overflow-hidden group">
                  <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Activity size={120} />
                  </div>
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Lifetime Yield (USDC)
                  </div>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-5xl font-black">
                      {(rewardData.totalEarned / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </h3>
                    <span className="text-gray-500 font-bold">USDC</span>
                  </div>
                </div>


                <div className="bg-white/5 border border-white/10 p-8 rounded-3xl relative overflow-hidden group">
                  <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <TrendingUp size={120} />
                  </div>
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500" /> Gas Reserve (ALGO)
                  </div>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-5xl font-black">
                      {botStatus ? (botStatus.algo / 1_000_000).toFixed(2) : '0.00'}
                    </h3>
                    <span className="text-gray-500 font-bold">ALGO</span>
                  </div>
                </div>
              </div>

              <div className="bg-blue-600/10 border border-blue-600/20 p-8 rounded-3xl">
                <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                      <BotIcon className="text-white" size={24} />
                    </div>
                    <h3 className="text-xl font-bold">Active Market Management</h3>
                  </div>
                  <span className="px-4 py-1.5 bg-green-500/20 text-green-400 text-[10px] font-black uppercase tracking-widest rounded-full border border-green-500/20">
                    Running Perfectly
                  </span>
                </div>
                <div className="bg-black/20 rounded-2xl p-6 border border-white/5 grid grid-cols-2 md:grid-cols-4 gap-8">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Target ID</p>
                    <p className="font-mono font-bold text-sm text-blue-400">{botConfig?.targetMarketId || '...'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Tick Rate</p>
                    <p className="font-bold text-sm">30 Seconds</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Min Balance</p>
                    <p className="font-bold text-sm">{(botStatus?.minBalance / 1_000_000).toFixed(2)} A</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Network</p>
                    <p className="font-bold text-sm">Mainnet</p>
                  </div>
                </div>
              </div>

              {/* Positions & Orders Section */}
              <div className="mt-8 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-purple-600/10 rounded-lg flex items-center justify-center text-purple-500">
                      <ShieldCheck size={18} />
                    </div>
                    <h3 className="text-xl font-bold">Active Inventory & Orders</h3>
                  </div>
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest bg-white/5 px-3 py-1 rounded-full border border-white/10">
                    {positionsData.positions.length} Positions • {positionsData.orders.length} Open Orders
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Active Positions */}
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-4 flex items-center gap-2">
                      <Gift size={12} className="text-purple-400" /> Held Shares
                    </h4>
                    {positionsData.positions.length > 0 ? (
                      <div className="space-y-3">
                        {positionsData.positions.map(p => (
                          <div key={p.marketAppId} className="flex items-center justify-between bg-black/30 p-3 rounded-xl border border-white/5">
                            <span className="text-xs font-mono font-bold text-blue-400">ID: {p.marketAppId}</span>
                            <div className="flex gap-3">
                              {p.yes > 0 && <span className="text-[10px] font-black text-green-400 bg-green-400/10 px-2 py-0.5 rounded">YES: {p.yes / 1e6}</span>}
                              {p.no > 0 && <span className="text-[10px] font-black text-red-400 bg-red-400/10 px-2 py-0.5 rounded">NO: {p.no / 1e6}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-600 italic">No shares held in bot wallet.</p>
                    )}
                  </div>

                  {/* Open Orders */}
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mb-4 flex items-center gap-2">
                      <Zap size={12} className="text-yellow-400" /> Live Limit Orders
                    </h4>
                    {positionsData.orders.length > 0 ? (
                      <div className="space-y-3">
                        {positionsData.orders.map(o => (
                          <div key={o.id} className="flex items-center justify-between bg-black/30 p-3 rounded-xl border border-white/5">
                            <span className="text-xs font-mono font-bold text-blue-400">ID: {o.marketAppId}</span>
                            <span className={`text-[9px] font-black rounded px-2 py-0.5 ${o.position === 'YES' ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10'}`}>
                              {o.side} {o.position} @ {o.price.toFixed(3)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-600 italic">No open orders on the books.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Rewards History Section */}
              <div className="mt-12">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 bg-blue-600/10 rounded-lg flex items-center justify-center text-blue-500">
                    <Gift size={18} />
                  </div>
                  <h3 className="text-xl font-bold">Recent Payouts</h3>
                </div>
                <RewardsTable history={rewardData.history} />
              </div>
            </div>



            {/* Actions Section */}
            <div className="space-y-6">
              <div className="bg-white p-8 rounded-3xl text-black shadow-2xl shadow-blue-500/10 transition-transform hover:scale-[1.01]">
                <h3 className="text-xl font-black mb-4 flex items-center gap-2">
                  <PlusCircle size={24} /> Refill Bot
                </h3>
                <p className="text-sm font-medium text-gray-600 mb-8 leading-relaxed">
                  Quick-fund your trading bot with USDC. Ensure it has enough liquidity to cover position hedging.
                </p>
                <div className="space-y-4">
                  <button 
                    onClick={() => handleRefill(50)}
                    disabled={!activeAddress || refillLoading}
                    className="w-full flex items-center justify-center gap-3 py-4 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-2xl transition-all shadow-lg shadow-blue-600/30 disabled:opacity-50 disabled:shadow-none"
                  >
                    {refillLoading ? <RefreshCcw size={20} className="animate-spin" /> : <ArrowRightLeft size={20} />}
                    Refill 50 USDC
                  </button>
                  <p className="text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    Or custom amount
                  </p>
                  <div className="flex gap-2">
                    <input 
                      type="number"
                      placeholder="10.00"
                      id="customAmount"
                      className="flex-1 bg-gray-100 border-none rounded-2xl px-5 py-4 font-bold focus:ring-2 focus:ring-blue-500 transition-all"
                    />
                    <button 
                      onClick={() => {
                        const val = (document.getElementById('customAmount') as HTMLInputElement).value;
                        if (val) handleRefill(parseFloat(val));
                      }}
                      disabled={!activeAddress || refillLoading}
                      className="px-6 bg-black text-white font-black rounded-2xl hover:bg-gray-900 transition-all disabled:opacity-50"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-yellow-500/5 border border-yellow-500/10 p-6 rounded-3xl flex gap-4">
                <AlertCircle className="text-yellow-500 flex-shrink-0" size={24} />
                <p className="text-xs text-yellow-500 font-medium leading-relaxed italic">
                  Bot identity is derived from your MNEMONIC. Keep it secure and never share it.
                </p>
              </div>
            </div>

          </div>
        ) : currentView === 'activity' ? (
          <div className="space-y-6">
             <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-600/10 rounded-xl flex items-center justify-center text-blue-500 shadow-inner">
                  <Activity size={22} />
                </div>
                <h3 className="text-2xl font-black">Transaction Ledger</h3>
              </div>
            <ActivityLog activity={activityData} />
          </div>
        ) : (
          <MarketList 
            rewardsOnly={currentView === 'rewards'} 
            targetId={Number(botConfig?.targetMarketId)} 
          />
        )}
      </main>

      <footer className="fixed bottom-6 right-8 text-[10px] font-bold text-gray-600 uppercase tracking-[0.2em]">
        ARCADE v1.2.0 • PROPRIETARY EXECUTION ENGINE
      </footer>
    </div>
  );
}

export default App;
