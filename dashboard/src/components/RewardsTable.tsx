import { Gift, ExternalLink, ArrowUpRight } from 'lucide-react';

interface Reward {
  txId: string;
  sender: string;
  amount: number;
  timestamp: number;
  round: number;
}

interface RewardsTableProps {
  history: Reward[];
}

export default function RewardsTable({ history }: RewardsTableProps) {
  if (history.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-3xl p-12 text-center">
        <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <Gift size={32} className="text-gray-600" />
        </div>
        <h3 className="text-xl font-bold mb-2">No rewards detected yet</h3>
        <p className="text-gray-500 max-w-sm mx-auto">
          The bot is currently maintaining orders. Rewards are typically distributed 
          periodically by the Alpha Arcade protocol once snapshots are processed.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
      <table className="w-full text-left border-collapse">
        <thead className="bg-white/5 border-b border-white/10">
          <tr>
            <th className="px-6 py-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Date & Time</th>
            <th className="px-6 py-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest text-right">Amount</th>
            <th className="px-6 py-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Transaction</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {history.map((reward) => (
            <tr key={reward.txId} className="hover:bg-white/5 transition-colors group">
              <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-green-500/10 rounded-lg flex items-center justify-center text-green-500">
                    <ArrowUpRight size={16} />
                  </div>
                  <div>
                    <div className="text-sm font-bold flex items-center gap-2">
                       {new Date(reward.timestamp).toLocaleDateString()}
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono">
                      {new Date(reward.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 text-right">
                <div className="text-sm font-black text-green-400">
                  +{(reward.amount / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                </div>
                <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">USDC</div>
              </td>
              <td className="px-6 py-4">
                <a 
                  href={`https://peraexplorer.app/tx/${reward.txId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg text-[10px] font-bold text-gray-400 hover:text-white transition-all"
                >
                  {reward.txId.slice(0, 8)}...
                  <ExternalLink size={10} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
