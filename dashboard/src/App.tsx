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
  Zap,
  Trash2
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
  const [rewardData, setRewardData] = useState<{ totalEarned: number, earnings?: any, history: any[] }>({ totalEarned: 0, history: [] });
  const [costBasis, setCostBasis] = useState<{ totalUsdc: number, totalAlgo: number, formattedUsdc: number, formattedAlgo: number }>({ totalUsdc: 0, totalAlgo: 0, formattedUsdc: 0, formattedAlgo: 0 });
  const [activityData, setActivityData] = useState<any[]>([]);
  const [positionsData, setPositionsData] = useState<{ orders: any[], positions: any[], warning?: string }>({ orders: [], positions: [] });
  const [extraUsdInputs, setExtraUsdInputs] = useState<Record<string, string>>({});
  const [markets, setMarkets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [refillLoading, setRefillLoading] = useState(false);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const [configRes, statusRes, rewardsRes, activityRes, positionsRes, marketsRes, costRes] = await Promise.all([
        axios.get(`${BACKEND_URL}/api/bot/config`),
        axios.get(`${BACKEND_URL}/api/bot/status`),
        axios.get(`${BACKEND_URL}/api/bot/rewards`),
        axios.get(`${BACKEND_URL}/api/bot/activity`),
        axios.get(`${BACKEND_URL}/api/bot/positions`),
        axios.get(`${BACKEND_URL}/api/markets`),
        axios.get(`${BACKEND_URL}/api/bot/cost-basis?userAddress=${activeAddress || ''}`)
      ]);
      setBotConfig(configRes.data);
      setBotStatus(statusRes.data);
      setRewardData(rewardsRes.data);
      setCostBasis(costRes.data);
      setActivityData(activityRes.data);
      setPositionsData(positionsRes.data);
      // New: handle nested { markets, lastRefresh }
      setMarkets(marketsRes.data.markets || []);
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

  const handleBotControl = async (botId: string, command: string, amountUsd?: number) => {
    try {
      await axios.post(`${BACKEND_URL}/api/bot/control`, { botId, command, amountUsd });
      if (command === 'add-budget') {
        const nextIdx = { ...extraUsdInputs };
        delete nextIdx[botId];
        setExtraUsdInputs(nextIdx);
      }
      alert(`Command sent: ${command}${amountUsd ? ` ($${amountUsd})` : ''}. Effective on next tick.`);
      fetchStatus();
    } catch (err: any) {
      alert(`Command failed: ${err.message}`);
    }
  };

  const handleCleanup = async () => {
    try {
      setLoading(true);
      // 1. Dry Run First
      const dryRunResp = await axios.post(`${BACKEND_URL}/api/bot/cleanup?dryRun=true`);
      const { count, estimatedReclaim } = dryRunResp.data;

      if (count === 0) {
        alert("Wallet is already clean! No unused assets found.");
        return;
      }

      // 2. Ask for confirmation with facts
      const confirmed = window.confirm(
        `🧹 CLEANUP PREVIEW:\n\n` +
        `• Found ${count} unused market assets.\n` +
        `• Reclaiming these will unlock ~${estimatedReclaim.toFixed(1)} ALGO.\n` +
        `• Active orders and current bot markets are PROTECTED.\n\n` +
        `Proceed with opt-out?`
      );

      if (!confirmed) return;

      // 3. Execute real cleanup
      const resp = await axios.post(`${BACKEND_URL}/api/bot/cleanup`);
      alert(resp.data.message);
      fetchStatus();
    } catch (err: any) {
      alert(`Cleanup failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getBestOpportunity = () => {
    const activeMarketId = botConfig?.targetMarketId;
    if (!activeMarketId || !markets.length) return null;

    const currentMarket = markets.find(m => m.marketAppId === Number(activeMarketId));
    if (!currentMarket) return null;

    const currentScore = currentMarket.efficiencyScore || 0;
    const currentMin = currentMarket.rewardsMinContracts || 0;

    const betterMarket = markets
      .filter(m => 
        m.isReward && 
        m.marketAppId !== Number(activeMarketId) &&
        (m.safetyGap || 0) >= 0 &&
        (m.rewardsMinContracts || 0) <= (currentMin * 1.5)
      )
      .sort((a, b) => (b.efficiencyScore || 0) - (a.efficiencyScore || 0))[0];

    if (betterMarket && currentScore > 0 && (betterMarket.efficiencyScore || 0) > (currentScore * 1.25)) {
      return {
        market: betterMarket,
        improvementPercent: Math.round(((betterMarket.efficiencyScore / currentScore) - 1) * 100)
      };
    }
    return null;
  };

  const bestOp = getBestOpportunity();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-72 border-r border-white/10 flex flex-col p-6 space-y-8 bg-black/20 backdrop-blur-md sticky top-0 h-screen overflow-y-auto">
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
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Bot Fleet</p>
                <span className="text-[10px] bg-white/5 px-2 py-0.5 rounded-full text-gray-400 font-bold border border-white/10">
                  {botStatus?.fleet?.length || 0} Active
                </span>
             </div>

              {botStatus?.fleet && botStatus.fleet.length > 0 ? (
                botStatus.fleet.map((bot: any, idx: number) => (
                  <div key={`${bot.botId || 'fleet'}-${idx}`} className="bg-gradient-to-br p-4 rounded-2xl border transition-all from-green-600/10 to-blue-600/10 border-green-500/20">
                   <div className="flex flex-col gap-3">
                     <div className="flex items-center justify-between">
                       <div className="flex items-center gap-2">
                         <div className={`w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]`} />
                         <p className="text-[10px] font-black uppercase tracking-widest text-green-400 truncate max-w-[120px]">
                           {bot.name}
                         </p>
                       </div>
                       <span className="text-[8px] text-gray-500 font-bold">
                         {new Date(bot.lastHeartbeat).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                       </span>
                     </div>

                     {bot.poolPercentage > 0 ? (
                       <div className="flex items-center justify-between bg-white/5 p-2 rounded-lg border border-white/5">
                          <span className="text-[10px] font-black text-amber-400">
                            {bot.poolPercentage.toFixed(1)}% Share
                          </span>
                          <span className="text-[8px] font-bold text-blue-400 uppercase">Rank: {bot.competitionPercentile || '...'}%</span>
                       </div>
                     ) : (
                       <div className="py-2 px-3 bg-white/5 rounded-lg border border-white/5 text-center">
                         <p className="text-[8px] font-bold text-gray-500 uppercase tracking-widest">{"< 0.1% Global Share"}</p>
                       </div>
                     )}
                   </div>
                  
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase font-bold text-gray-500 tracking-tighter italic">Targeting Market</p>
                    <p className="text-[11px] font-bold text-white leading-tight truncate">
                      {markets.find(m => m.marketAppId === Number(bot.marketId))?.title || `Market #${bot.marketId}`}
                    </p>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[8px] font-bold text-gray-500">$</span>
                      <input 
                        type="number"
                        placeholder="Deploy Extra"
                        className="w-full bg-black/40 border border-white/10 rounded-lg text-[9px] pl-4 pr-1 py-1.5 focus:outline-none focus:border-green-500/50 text-white font-bold"
                        value={extraUsdInputs[bot.botId] || ''}
                        onChange={(e) => setExtraUsdInputs({ ...extraUsdInputs, [bot.botId]: e.target.value })}
                      />
                    </div>
                    <button 
                      disabled={!extraUsdInputs[bot.botId]}
                      onClick={() => handleBotControl(bot.botId, 'add-budget', parseFloat(extraUsdInputs[bot.botId]))}
                      className="px-3 py-1.5 bg-green-500 hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-[9px] font-black uppercase rounded-lg transition-all shadow-lg shadow-green-600/10"
                    >
                      Inject
                    </button>
                  </div>

                  <div className="flex gap-2 mt-4 pt-3 border-t border-white/5">
                    <button 
                      onClick={() => handleBotControl(bot.botId, 'shutdown-keep')}
                      className="flex-1 px-2 py-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 text-[8px] font-black uppercase rounded-lg border border-yellow-500/20 transition-all"
                    >
                      Stop (Keep)
                    </button>
                    <button 
                      onClick={() => handleBotControl(bot.botId, 'shutdown-clean')}
                      className="flex-1 px-2 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 text-[8px] font-black uppercase rounded-lg border border-red-500/20 transition-all"
                    >
                      Stop (Clean)
                    </button>
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
                <p className="text-yellow-500/80 text-sm font-medium">{botStatus.warning}. Your hot wallet needs more USDC to place yield-earning orders.</p>
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
        
        {positionsData?.warning && (
          <div className="mb-6">
            <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-2xl flex items-center gap-4 shadow-lg shadow-red-500/10">
              <div className="bg-red-500/20 p-2 rounded-xl text-red-400">
                <AlertCircle size={24} />
              </div>
              <div>
                <p className="text-sm font-black text-red-400 uppercase tracking-wide">Data Sync Paused</p>
                <p className="text-xs font-bold text-red-400/70">{positionsData.warning}</p>
              </div>
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

        {bestOp && (currentView === 'dashboard' || currentView === 'rewards') && (
          <div className="mb-8 p-6 bg-gradient-to-r from-blue-600/20 to-purple-600/20 border border-blue-500/30 rounded-3xl flex items-center justify-between group animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/40">
                <Zap className="text-white animate-pulse" size={24} />
              </div>
              <div>
                <h4 className="text-lg font-black text-white">Yield Opportunity Found: +{bestOp.improvementPercent}% Score Improvement!</h4>
                <p className="text-sm text-blue-200/70 font-medium">
                  <span className="font-bold text-white">{bestOp.market.title}</span> offers significantly better efficiency at similar risk.
                </p>
              </div>
            </div>
            <button 
              onClick={() => setCurrentView('markets')}
              className="px-6 py-3 bg-white text-blue-600 font-black rounded-2xl hover:scale-105 transition-all shadow-xl shadow-black/20 flex items-center gap-2 text-sm"
            >
              View In Markets <ChevronRight size={18} />
            </button>
          </div>
        )}

        {currentView === 'dashboard' ? (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">
            
            {/* Status Section */}
            <div className="xl:col-span-2 space-y-8">
              <div className="bg-white/5 border border-white/10 p-8 rounded-3xl relative overflow-hidden group">
                <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity">
                  <Activity size={120} />
                </div>
                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Total Rewards Earned
                </div>
                <div className="flex items-baseline gap-2">
                  <h3 className={`text-5xl font-black ${((rewardData?.totalEarned || 0) - (costBasis?.totalUsdc || 0)) >= 0 ? 'text-white' : 'text-red-400'}`}>
                    {((rewardData?.totalEarned || 0) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </h3>
                  <span className="text-gray-500 font-bold">USDC</span>
                </div>
                <p className="text-[10px] font-bold text-gray-500 mt-2 uppercase tracking-tighter">
                  {(rewardData?.totalEarned || 0) > 0 && (costBasis?.totalUsdc || 0) > 0 ? (
                    <span className="text-green-400">+{(((rewardData?.totalEarned || 0) / (costBasis?.totalUsdc || 1)) * 100).toFixed(1)}% Yield on Basis</span>
                  ) : 'Awaiting first harvest...'}
                </p>
              </div>

              {/* Yield Breakdown Statistics */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white/5 border border-white/10 p-6 rounded-2xl">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">Last 1 Hour</p>
                  <p className="text-2xl font-black">
                    {((rewardData?.earnings?.last1h || 0) / 1_000_000).toFixed(2)} <span className="text-xs text-gray-500">USDC</span>
                  </p>
                </div>
                <div className="bg-white/5 border border-white/10 p-6 rounded-2xl">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">Last 24 Hours</p>
                  <p className="text-2xl font-black text-green-400">
                    {((rewardData?.earnings?.last24h || 0) / 1_000_000).toFixed(2)} <span className="text-xs text-gray-500">USDC</span>
                  </p>
                </div>
                <div className="bg-white/5 border border-white/10 p-6 rounded-2xl">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">Last 7 Days</p>
                  <p className="text-2xl font-black">
                    {((rewardData.earnings?.last7d || 0) / 1_000_000).toFixed(2)} <span className="text-xs text-gray-500">USDC</span>
                  </p>
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
                  <span className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-full border bg-green-500/20 text-green-400 border-green-500/20">
                    {Object.keys(botStatus?.fleet || {}).length} Bots Active
                  </span>
                </div>
                
                {/* LIVE ACTIVITY MONITOR */}
                <div className="mb-4 bg-black/40 border border-white/5 rounded-lg p-2 font-mono text-[10px] text-green-400 overflow-hidden relative">
                  <div className="flex items-center gap-2 mb-1 border-b border-white/5 pb-1 opacity-50">
                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                    <span>BOT_ACTIVITY_STREAM</span>
                  </div>
                  <div className="whitespace-nowrap animate-in fade-in slide-in-from-left-2 duration-300">
                    {">"} Monitoring {Object.keys(botStatus?.fleet || {}).length} market streams...
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.values(botStatus?.fleet || {}).map((bot: any, idx: number) => (
                    <div key={`${bot.botId || 'bot'}-${idx}`} className="bg-black/20 rounded-2xl p-5 border border-white/5 space-y-4 hover:border-blue-500/30 transition-all">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{bot.name || 'Bot Instance'}</p>
                          <p className="font-mono font-bold text-xs text-blue-400 truncate max-w-[120px]">{bot.botId}</p>
                        </div>
                        <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter ${bot.status === 'online' ? 'bg-green-400/20 text-green-400' : 'bg-orange-400/20 text-orange-400'}`}>
                          {bot.status}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/5">
                        <div>
                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Market ID</p>
                          <p className="font-bold text-xs">{bot.marketId}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Share</p>
                          <p className="font-bold text-xs text-green-400">{bot.poolPercentage ? bot.poolPercentage.toFixed(2) : '0.00'}%</p>
                        </div>
                      </div>
                      <div className="text-[9px] text-gray-500 italic truncate opacity-70">
                         {bot.activity}
                      </div>
                    </div>
                  ))}
                  {(!botStatus?.fleet || botStatus.fleet.length === 0) && (
                    <div className="col-span-full py-8 text-center text-gray-500 italic text-sm border-2 border-dashed border-white/5 rounded-2xl">
                      No active bots detected in fleet.
                    </div>
                  )}
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
              <div className="bg-white p-6 rounded-3xl text-black shadow-2xl shadow-blue-500/10 transition-transform hover:scale-[1.01]">
                <h3 className="text-lg font-black mb-3 flex items-center gap-2">
                  <PlusCircle size={20} /> Refill Bot
                </h3>
                <p className="text-sm font-medium text-gray-600 mb-6 leading-relaxed">
                  Quick-fund your trading bot with USDC. Ensure it has enough liquidity to cover position hedging.
                </p>
                <div className="space-y-3">
                  <button 
                    onClick={() => handleRefill(50)}
                    disabled={!activeAddress || refillLoading}
                    className="w-full flex items-center justify-center gap-3 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-2xl transition-all shadow-lg shadow-blue-600/30 disabled:opacity-50 disabled:shadow-none text-sm"
                  >
                    {refillLoading ? <RefreshCcw size={18} className="animate-spin" /> : <ArrowRightLeft size={18} />}
                    Refill 50 USDC
                  </button>
                  <p className="text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    Or custom amount
                  </p>
                  <div className="flex items-center bg-gray-100 rounded-2xl p-1 border-2 border-transparent focus-within:border-blue-500 transition-all">
                    <input 
                      type="number"
                      placeholder="10.00"
                      id="customAmount"
                      className="flex-1 min-w-0 bg-transparent border-none px-3 py-2.5 font-bold focus:ring-0 text-black outline-none"
                    />
                    <button 
                      onClick={() => {
                        const val = (document.getElementById('customAmount') as HTMLInputElement).value;
                        if (val) handleRefill(parseFloat(val));
                      }}
                      disabled={!activeAddress || refillLoading}
                      className="px-4 py-2.5 bg-black text-white text-xs font-black uppercase rounded-xl hover:bg-gray-900 transition-all disabled:opacity-50 flex-shrink-0"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 p-6 rounded-3xl space-y-4">
                <h3 className="text-sm font-black flex items-center gap-2">
                  <ShieldCheck size={18} className="text-blue-400" /> Wallet Health
                </h3>
                <p className="text-[10px] text-gray-500 font-medium leading-relaxed">
                  Cleanup unused market tokens to reclaim ALGO Minimum Balance (MBR). 
                  Each unused market token locks 0.1 ALGO.
                </p>
                <button 
                  onClick={handleCleanup}
                  disabled={loading}
                  className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                >
                  {loading ? <RefreshCcw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Reclaim ALGO MBR
                </button>
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
            botStatus={botStatus}
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
