import { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Search, 
  Copy, 
  Check, 
  ExternalLink,
  TrendingUp,
  Zap,
  Activity,
  ArrowRightLeft,
  RefreshCcw,
  Sparkles,
  Clock
} from 'lucide-react';
import RulesBanner from './RulesBanner';


interface Market {
  marketAppId: number;
  title: string;
  volume: number;
  resolutionValue: string;
  source: string;
  isReward?: boolean;
  rewardsMinContracts?: number;
  lastRewardAmount?: number;
  totalRewards?: number;
  rewardsPaidOut?: number;
  competitionTag?: string;
  competitionPercentile?: number;
  competitionWalletCount?: number;
  endTs?: number;
  currentMidpointLiquidity?: number;
  totalZoneLiquidity?: number;
  opportunityScore?: number;
  efficiencyScore?: number;
  projectedShare?: number;
  estDailyYield?: number;
  closingTime?: number;
  crowding?: number;
  safetyGap?: number;
  midpoint?: number;
  isTrap?: boolean;
  categories?: string[];
  bilateralEntryCost?: number;
  dailyPot?: number;
  twentyFourHrVolume?: number;
}


interface MarketListProps {
  rewardsOnly?: boolean;
  targetId?: number;
  botStatus?: any;
}


const MarketList = ({ rewardsOnly = false, targetId }: MarketListProps) => {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<'volume' | 'cost' | 'efficiency'>(rewardsOnly ? 'efficiency' : 'volume');
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [showSports, setShowSports] = useState<boolean>(true);
  const [aiRecommendation, setAiRecommendation] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [btcData, setBtcData] = useState<{ price: number, target: number } | null>(null);

  const fetchMarkets = async (force = false) => {
    try {
      if (force) setIsScanning(true);
      const res = await axios.get(`http://localhost:3001/api/markets${force ? '?force=true' : ''}`);
      setMarkets(res.data.markets || []);
      setLastScanned(res.data.lastRefresh);
      if (res.data.btcPrice) {
        setBtcData({ price: res.data.btcPrice, target: res.data.btcTargetPrice });
      }
    } catch (err) {
      console.error('Scan failed:', err);
    } finally {
      setIsScanning(false);
      setLoading(false);
    }
  };

  const getAiRecommendations = async () => {
    try {
      setIsAiLoading(true);
      const res = await axios.get(`http://localhost:3001/api/ai/recommendations`);
      setAiRecommendation(res.data.recommendations);
    } catch (err) {
      console.error('AI Scan failed:', err);
      alert('AI Analysis failed. Check server logs.');
    } finally {
      setIsAiLoading(false);
    }
  };

  const getTimeRemaining = (closingTime?: number) => {
    if (!closingTime) return 'N/A';
    const diff = closingTime * 1000 - Date.now();
    if (diff <= 0) return 'Closed';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    return `${days}d ${hours}h`;
  };

  useEffect(() => {
    fetchMarkets();
  }, []);





  const handleCopy = (id: number) => {
    navigator.clipboard.writeText(id.toString());
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredMarkets = markets
    .filter(m => {
      // Search filter
      const matchesSearch = m.title.toLowerCase().includes(search.toLowerCase()) || 
                           m.marketAppId.toString().includes(search);
      
      // Category filter
      const isSports = (m.categories && m.categories.some(c => c.toLowerCase().includes('sport'))) || 
                       m.title.toLowerCase().includes('match');

      const matchesCategory = 
        selectedCategory === 'All' ? (!isSports || showSports) :
        selectedCategory === 'Sports' ? isSports :
        selectedCategory === 'Politics' ? m.title.toLowerCase().includes('election') :
        (m.categories && m.categories.some(c => c.toLowerCase() === selectedCategory.toLowerCase()));

      // Rewards filter
      if (rewardsOnly) return matchesSearch && matchesCategory && m.isReward && (!m.endTs || m.endTs * 1000 > Date.now());
      // Default: Only live markets
      return matchesSearch && matchesCategory && (!m.endTs || m.endTs * 1000 > Date.now());
    })
    .sort((a, b) => {
      if (sortBy === 'efficiency') {
        return (b.efficiencyScore || 0) - (a.efficiencyScore || 0);
      }
      if (sortBy === 'cost') {
        return (a.rewardsMinContracts || 0) - (b.rewardsMinContracts || 0);
      }
      return (b.volume || 0) - (a.volume || 0);
    });


  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        <p className="text-gray-400 animate-pulse">Scanning Alpha Protocol...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {rewardsOnly && (
        <div className="flex flex-col gap-6">
          {btcData && (
            <div className="flex items-center justify-between bg-black/40 border border-white/10 rounded-2xl p-4 animate-in slide-in-from-right-4 duration-500">
               <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-orange-500/10 rounded-xl flex items-center justify-center text-orange-500 shadow-inner">
                    <Activity size={20} />
                  </div>
                  <div>
                    <h5 className="text-[10px] font-black uppercase tracking-widest text-gray-500">Live Bitcoin Shield</h5>
                    <p className="text-xl font-black text-white">
                      ${btcData.price.toLocaleString()}
                    </p>
                  </div>
               </div>
               
               {btcData.target && (
                 <div className="text-right">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Distance to Strike</p>
                    <p className={`text-sm font-black ${Math.abs(btcData.price - btcData.target) / btcData.target < 0.02 ? 'text-red-500' : 'text-green-500'}`}>
                      {((Math.abs(btcData.price - btcData.target) / btcData.target) * 100).toFixed(2)}% Away
                    </p>
                 </div>
               )}
            </div>
          )}
          <RulesBanner />
          
          <button 
            onClick={getAiRecommendations}
            disabled={isAiLoading}
            className={`w-full flex items-center justify-center gap-3 py-6 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white rounded-3xl text-sm font-black uppercase transition-all shadow-xl shadow-indigo-600/20 active:scale-[0.98] ${isAiLoading ? 'animate-pulse cursor-not-allowed' : ''}`}
          >
            <Sparkles size={20} className={isAiLoading ? 'animate-spin' : ''} />
            {isAiLoading ? 'Gemini is auditing the protocol...' : 'Run Gemini AI Market Audit (Top 4 Picks)'}
          </button>
        </div>
      )}

      {/* AI Recommendation Result */}
      {aiRecommendation && (
        <div className="bg-gradient-to-br from-indigo-950/60 to-slate-900/40 border border-indigo-500/30 rounded-[2.5rem] p-10 mb-8 relative overflow-hidden animate-in zoom-in-95 duration-500">
           <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
              <Sparkles size={200} className="text-indigo-400" />
           </div>
           <div className="flex items-center justify-between mb-8 border-b border-indigo-500/20 pb-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-indigo-500/40">
                  <Sparkles size={24} className="text-white" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-white leading-tight">Gemini Strategy Report</h3>
                  <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Autonomous Alpha Audit</p>
                </div>
              </div>
              <button 
                onClick={() => setAiRecommendation(null)}
                className="bg-white/5 hover:bg-white/10 px-5 py-2.5 rounded-xl text-[10px] font-black text-gray-400 hover:text-white uppercase tracking-widest transition-all"
              >
                Dismiss
              </button>
           </div>
           <div 
             className="prose prose-invert prose-indigo max-w-none 
                        prose-h2:text-indigo-300 prose-h2:text-2xl prose-h2:font-black prose-h2:uppercase prose-h2:tracking-tighter prose-h2:mb-6 prose-h2:border-b prose-h2:border-white/10 prose-h2:pb-2
                        prose-h3:text-white prose-h3:font-black prose-h3:text-xl prose-h3:mb-2 prose-h3:mt-10 prose-h3:flex prose-h3:items-center prose-h3:before:content-['•'] prose-h3:before:mr-2 prose-h3:before:text-indigo-500
                        prose-p:text-gray-300 prose-p:leading-relaxed prose-p:mb-4
                        prose-strong:text-indigo-400 prose-strong:font-black"
             dangerouslySetInnerHTML={{ __html: aiRecommendation }}
           />
        </div>
      )}

      {/* Search Header */}
      <div className="flex flex-col md:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={20} />
          <input 
            type="text"
            placeholder="Search by title or App ID..."
            className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-lg"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        
        <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
          <button 
            onClick={() => setSortBy('efficiency')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${sortBy === 'efficiency' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
          >
            Efficiency Ranking
          </button>
          <button 
             onClick={() => setSortBy('volume')}
             className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${sortBy === 'volume' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
          >
            Highest Volume
          </button>
          <button 
             onClick={() => setSortBy('cost')}
             className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${sortBy === 'cost' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
          >
            Entry Cost
          </button>
        </div>

        <div className="flex items-center gap-4">
          {lastScanned && (
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
              Last Scan: {new Date(lastScanned).toLocaleTimeString()}
            </span>
          )}
          <div className="flex gap-2">
            <button 
              onClick={() => fetchMarkets(true)}
              disabled={isScanning}
              className={`flex items-center gap-2 px-4 py-2.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-600/20 rounded-xl text-xs font-black uppercase transition-all ${isScanning ? 'animate-pulse' : ''}`}
            >
              <RefreshCcw size={14} className={isScanning ? 'animate-spin' : ''} />
              {isScanning ? 'Scanning Protocol...' : 'Scan For Rewards Now'}
            </button>
          </div>
        </div>
      </div>
      </div>

      {/* Category Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 pb-2">
        {['All', 'Sports', 'Politics', 'Crypto', 'Geopolitics', 'Finance'].map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border ${
              selectedCategory === cat
                ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-500/20'
                : 'bg-white/5 text-gray-400 border-white/10 hover:border-white/30 hover:bg-white/10'
            }`}
          >
            {cat}
          </button>
        ))}
        
        <div className="flex items-center gap-3 ml-auto px-4 py-1.5 bg-black/40 rounded-full border border-white/5">
          <span className="text-[9px] font-black text-gray-600 uppercase tracking-widest">Crowding:</span>
          <div className="flex items-center gap-2">
             <span className="w-2 h-2 rounded-full bg-green-500" title="Low Competition / High Yield Share"></span>
             <span className="w-2 h-2 rounded-full bg-yellow-500" title="Moderate Competition"></span>
             <span className="w-2 h-2 rounded-full bg-red-500" title="Oversaturated / Low Yield Share"></span>
          </div>
        </div>

        <label className="flex items-center gap-2 p-2 bg-white/5 rounded-xl border border-white/10 cursor-pointer hover:bg-white/10 transition-all">
          <input 
            type="checkbox" 
            checked={showSports} 
            onChange={(e) => setShowSports(e.target.checked)}
            className="w-4 h-4 rounded border-white/10 bg-black/40 text-blue-600 focus:ring-0 focus:ring-offset-0"
          />
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Include Sports</span>
        </label>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredMarkets.map((market) => (
          <div key={market.marketAppId} className="bg-white/5 border border-white/10 p-6 rounded-2xl hover:bg-white/[0.08] transition-all group overflow-hidden">
            <div className="flex justify-between items-start mb-4">
              <div className="space-y-2 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-black uppercase tracking-widest text-white bg-black/60 border border-white/20 px-3 py-1 rounded-lg shadow-sm">
                    ID: {market.marketAppId}
                  </span>
                  <span className="text-[11px] font-black uppercase tracking-widest text-blue-400 bg-blue-400/10 border border-blue-400/20 px-3 py-1 rounded-lg">
                    PRICE: {(Number(market.midpoint || 0) / 10000).toFixed(1)}¢
                  </span>
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">
                    {market.source === 'bootstrap' ? 'Verified' : 'Live'}
                  </span>
                  {market.isReward && (
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap gap-1">
                        <span className="text-[9px] font-black text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded border border-yellow-400/20 flex items-center gap-1 w-fit">
                          <Zap size={10} /> REWARDS {market.rewardsMinContracts ? `(MIN ${(market.rewardsMinContracts / 1_000_000)} SHARES)` : ''}
                        </span>
                        {market.isTrap ? (
                          <span className="text-[9px] font-black text-red-500 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20 w-fit">
                            ⚠️ TIGHT SPREAD (Negative Gap)
                          </span>
                        ) : (market.safetyGap || 0) > 0 ? (
                          <span className="text-[9px] font-black text-green-400 bg-green-400/10 px-2 py-0.5 rounded border border-green-400/20 w-fit">
                            ✅ SAFE SPREAD (+{((market.safetyGap || 0) / 1000).toFixed(1)}¢)
                          </span>
                        ) : (
                          <span className="text-[9px] font-black text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded border border-yellow-500/20 w-fit">
                            ⚠️ EXACT SPREAD (Zero Gap)
                          </span>
                        )}
                        {market.competitionWalletCount !== undefined && (
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded border leading-none ${
                            (market.competitionWalletCount || 0) <= 3 ? 'text-green-400 bg-green-400/10 border-green-400/20' : 
                            (market.competitionWalletCount || 0) <= 7 ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' : 
                            'text-red-400 bg-red-400/10 border-red-400/20'
                          }`}>
                            {market.competitionWalletCount} BOTS IN ZONE
                          </span>
                        )}
                                         <div className="flex flex-col gap-1 mt-1 px-1">
                        <div className="flex gap-3">
                          <span className="text-[10px] font-black text-white bg-blue-600/20 px-2 py-1 rounded border border-blue-500/30 flex items-center gap-1">
                             <ArrowRightLeft size={10} className="text-blue-400" /> 
                             MIN ENTRY COST: ${market.bilateralEntryCost ? market.bilateralEntryCost.toLocaleString() : '0.00'} USDC
                          </span>
                          <span className="text-[10px] font-bold text-gray-400 flex items-center gap-1">
                           Total Rewards per day: <span className="text-white">
                               ${market.dailyPot ? market.dailyPot.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '0'}/day
                             </span>
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 items-center mt-1">
                          <span 
                            title={(market.competitionPercentile || 0) > 80 ? 'Oversaturated: Significant reward dilution expected.' : (market.competitionPercentile || 0) > 40 ? 'Moderate: Active competition.' : 'Low: High share of daily pot expected.'}
                            className={`text-[9px] font-black px-2 py-0.5 rounded border cursor-help ${
                            (market.competitionPercentile || 0) > 80 ? 'text-red-400 bg-red-400/10 border-red-400/20' : 
                            (market.competitionPercentile || 0) > 40 ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' : 
                            'text-green-400 bg-green-400/10 border-green-400/20'
                          }`}>
                            CROWDING: {(market.competitionPercentile || 0) > 80 ? 'OVERSATURATED' : (market.competitionPercentile || 0) > 40 ? 'MODERATE' : 'UNDER-SERVED'} ({market.competitionPercentile?.toFixed(0)}%)
                            <span className="ml-1 opacity-60 uppercase">[{market.competitionTag || 'Normal'}]</span>
                          </span>
                          <span className="text-[10px] font-bold text-white flex items-center gap-1">
                            <TrendingUp size={10} className="text-green-400" />
                            MIN DAILY YIELD: ${market.estDailyYield ? market.estDailyYield.toFixed(2) : "0.00"}
                            <span className="ml-2 text-blue-400 border-l border-white/10 pl-2">
                               YIELD SHARE: {market.projectedShare?.toFixed(1)}%
                            </span>
                          </span>

                        </div>
                      </div>
       </div>
                    </div>
                  )}


                  {targetId === market.marketAppId && (
                    <span className="text-[9px] font-black text-green-400 bg-green-400/10 px-2 py-0.5 rounded border border-green-400/20 flex items-center gap-1 animate-pulse">
                      <Zap size={10} className="fill-green-400" /> YIELDING
                    </span>
                  )}
                </div>

                <h3 className="text-lg font-bold leading-tight group-hover:text-blue-400 transition-colors">
                  {market.title}
                </h3>
              </div>
              <button 
                onClick={() => handleCopy(market.marketAppId)}
                className="p-2 hover:bg-white/10 rounded-lg text-gray-400 transition-colors tooltip"
                title="Copy App ID"
              >
                {copiedId === market.marketAppId ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
              </button>
            </div>

            {market.endTs && (
              <div className="mb-4 flex items-center gap-2 text-[10px] font-bold text-gray-400">
                <Activity size={12} className="text-blue-400" />
                Ends on {new Date(market.endTs * 1000).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 mt-auto">
              <div className="bg-black/20 p-3 rounded-xl border border-white/5">
                <p className="text-[10px] uppercase text-gray-500 font-bold tracking-tighter mb-1">All-Time Volume</p>
                <div className="flex items-center gap-2">
                  <TrendingUp size={14} className="text-blue-400" />
                  <span className="font-mono font-bold">${(market.volume / 1e6).toLocaleString()}</span>
                </div>
              </div>
              <div className="bg-black/20 p-3 rounded-xl border border-white/5">
                <p className="text-[10px] uppercase text-gray-500 font-bold tracking-tighter mb-1">24h Volume</p>
                <div className="flex items-center gap-2">
                  <Activity size={14} className="text-green-400" />
                  <span className="font-mono font-bold">${((market.twentyFourHrVolume || 0) / 1e6).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-white/5">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                    <Clock size={12} />
                    {getTimeRemaining(market.closingTime)}
                  </div>
                  {market.closingTime && (
                    <div className="text-[10px] font-medium text-gray-600">
                       ({new Date(market.closingTime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} Local)
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <a 
                href={`https://explorer.perawallet.app/application/${market.marketAppId}`}
                target="_blank"
                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-[10px] font-black uppercase tracking-widest bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition-colors"
              >
                <ExternalLink size={14} /> Explorer
              </a>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(`TARGET_MARKET_ID=${market.marketAppId}`);
                  setCopiedId(market.marketAppId);
                  setTimeout(() => setCopiedId(null), 2000);
                }}
                className="flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-600/20 transition-all"
              >
                Copy For Bot
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MarketList;
