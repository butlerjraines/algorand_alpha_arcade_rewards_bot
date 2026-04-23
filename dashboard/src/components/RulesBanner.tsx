import { AlertTriangle, Info, ShieldCheck, Zap } from 'lucide-react';

export default function RulesBanner() {
  return (
    <div className="mb-8 grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-top-4 duration-700">
      {/* Rule 1: Anti-Jump */}
      <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-3xl relative overflow-hidden group">
        <div className="absolute -right-2 -top-2 opacity-10 group-hover:scale-110 transition-transform">
          <AlertTriangle size={64} className="text-red-500" />
        </div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 bg-red-500/20 rounded-lg flex items-center justify-center text-red-500">
            <ShieldCheck size={18} />
          </div>
          <h4 className="font-black text-xs uppercase tracking-widest text-red-400">Rule 1: No Jump Risk</h4>
        </div>
        <p className="text-xs text-gray-400 font-medium leading-relaxed">
          Avoid <span className="text-white font-bold">Jump-Risk</span> markets like Invasions or Verdicts. 
          While Sports are "binary" in outcome, they drift slowly. Jumps from 10% to 100% instantly cause the bot to sell winners for pennies.
        </p>
      </div>

      {/* Rule 2: Continuous Actions */}
      <div className="bg-blue-600/10 border border-blue-500/20 p-6 rounded-3xl relative overflow-hidden group">
        <div className="absolute -right-2 -top-2 opacity-10 group-hover:scale-110 transition-transform">
          <Zap size={64} className="text-blue-500" />
        </div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center text-blue-400">
            <Info size={18} />
          </div>
          <h4 className="font-black text-xs uppercase tracking-widest text-blue-400">Rule 2: Continuous Only</h4>
        </div>
        <p className="text-xs text-gray-400 font-medium leading-relaxed">
          Prioritize <span className="text-white font-bold">Crypto price floors, Sports Over/Under, and Polls</span>. 
          These drift slowly, allowing the bot to adjust and harvest yield safely.
        </p>
      </div>

      {/* Rule 3: Strategic Exits */}
      <div className="bg-green-600/10 border border-green-500/20 p-6 rounded-3xl relative overflow-hidden group">
        <div className="absolute -right-2 -top-2 opacity-10 group-hover:scale-110 transition-transform">
          <Zap size={64} className="text-green-500" />
        </div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center text-green-400">
            <Zap size={18} />
          </div>
          <h4 className="font-black text-xs uppercase tracking-widest text-green-400">Rule 3: Exit Timing</h4>
        </div>
        <p className="text-xs text-gray-400 font-medium leading-relaxed">
          For Sports, <span className="text-white font-bold">exit before game start</span> to avoid live-score volatility. 
          Maximize yield by farming high-volume pre-game liquidity.
        </p>
      </div>
    </div>
  );
}
