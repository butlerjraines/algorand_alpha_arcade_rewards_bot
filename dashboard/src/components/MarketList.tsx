import { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Search, 
  Copy, 
  Check, 
  ExternalLink,
  TrendingUp,
  Award,
  Zap,
  Activity
} from 'lucide-react';

const BACKEND_URL = 'http://localhost:3001';

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
  endTs?: number;
}


interface MarketListProps {
  rewardsOnly?: boolean;
  targetId?: number;
}


const MarketList = ({ rewardsOnly = false, targetId }: MarketListProps) => {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<'volume' | 'cost' | 'profit'>(rewardsOnly ? 'profit' : 'volume');

  const getEstimatedDailyReward = (market: Market) => {
    if (!market.isReward || !market.lastRewardAmount) return 0;
    // Rewards are calculated hourly (lpRewardCompetitionHourTs)
    const dailyPool = (market.lastRewardAmount / 1e6) * 24;
    
    // Proxy competition divider
    let divider = 1;
    switch (market.competitionTag?.toLowerCase()) {
      case 'low': divider = 3; break;   // ~2 competitors + you
      case 'medium': divider = 7; break; // ~6 competitors + you
      case 'high': divider = 16; break; // ~15 competitors + you
      default: divider = 5;
    }
    
    return dailyPool / divider;
  };


  useEffect(() => {
    const fetchMarkets = async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/api/markets`);
        setMarkets(res.data);
      } catch (err) {
        console.error('Failed to fetch markets:', err);
      } finally {
        setLoading(false);
      }
    };
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
      // Rewards filter
      if (rewardsOnly) return matchesSearch && m.isReward && (!m.endTs || m.endTs * 1000 > Date.now());
      // Default: Only live markets
      return matchesSearch && (!m.endTs || m.endTs * 1000 > Date.now());
    })
    .sort((a, b) => {
      if (sortBy === 'profit') {
        const profitA = getEstimatedDailyReward(a);
        const profitB = getEstimatedDailyReward(b);
        if (a.isReward && !b.isReward) return -1;
        if (!a.isReward && b.isReward) return 1;
        return profitB - profitA;
      }
      if (sortBy === 'cost') {
        const costA = (a.rewardsMinContracts || 0);
        const costB = (b.rewardsMinContracts || 0);
        if (a.isReward && !b.isReward) return -1;
        if (!a.isReward && b.isReward) return 1;
        return costA - costB;
      }
      return b.volume - a.volume;
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
        
        <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 self-stretch md:self-center">
          <button 
            onClick={() => setSortBy('volume')}
            className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${sortBy === 'volume' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
          >
            HIGHEST VOLUME
          </button>
          <button 
            onClick={() => setSortBy('profit')}
            className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${sortBy === 'profit' ? 'bg-green-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
          >
            MOST PROFITABLE
          </button>
          <button 
            onClick={() => setSortBy('cost')}
            className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${sortBy === 'cost' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
          >
            CHEAPEST ENTRY
          </button>
        </div>
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
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">
                    {market.source === 'bootstrap' ? 'Verified' : 'Live'}
                  </span>
                  {market.isReward && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] font-black text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded border border-yellow-400/20 flex items-center gap-1 w-fit">
                        <Zap size={10} /> REWARDS {market.rewardsMinContracts ? `(MIN ${(market.rewardsMinContracts / 1_000_000)} SHARES)` : ''}
                      </span>
                      <div className="flex gap-3 mt-1 px-1">
                        <span className="text-[10px] font-bold text-gray-400">
                          Est. Entry: <span className="text-white">${((market.rewardsMinContracts || 0) / 1_000_000).toFixed(2)}</span>
                        </span>
                        <span className="text-[10px] font-bold text-green-400 flex items-center gap-1">
                           <TrendingUp size={10} /> ${getEstimatedDailyReward(market).toFixed(2)} / DAY
                        </span>
                        <span className={`text-[9px] font-black uppercase px-2 rounded-full border ${
                          market.competitionTag === 'low' ? 'text-green-400 border-green-400/30' : 
                          market.competitionTag === 'medium' ? 'text-yellow-400 border-yellow-400/30' : 
                          'text-red-400 border-red-400/30'
                        }`}>
                          {market.competitionTag} COMP
                        </span>
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
                <p className="text-[10px] uppercase text-gray-500 font-bold tracking-tighter mb-1">Live Volume</p>
                <div className="flex items-center gap-2">
                  <TrendingUp size={14} className="text-green-400" />
                  <span className="font-mono font-bold">${(market.volume / 1e6).toLocaleString()}</span>
                </div>
              </div>
              <div className="bg-black/20 p-3 rounded-xl border border-white/5">
                <p className="text-[10px] uppercase text-gray-500 font-bold tracking-tighter mb-1">Category</p>
                <div className="flex items-center gap-2">
                  <Award size={14} className="text-purple-400" />
                  <span className="text-xs font-semibold truncate">{market.resolutionValue}</span>
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
