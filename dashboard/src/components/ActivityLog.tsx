import { Activity, ExternalLink, ArrowDownRight, Zap, Ban } from 'lucide-react';

interface ActivityItem {
  id: string;
  type: string;
  action: string;
  value: number;
  timestamp: number;
  round: number;
}

interface ActivityLogProps {
  activity: ActivityItem[];
}

export default function ActivityLog({ activity }: ActivityLogProps) {
  if (activity.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-3xl p-12 text-center">
        <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <Activity size={32} className="text-gray-600" />
        </div>
        <h3 className="text-xl font-bold mb-2">No activity detected</h3>
        <p className="text-gray-500 max-w-sm mx-auto">
          The bot's transaction history will appear here once it starts placing orders 
          and processing fills.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
      <table className="w-full text-left border-collapse">
        <thead className="bg-white/5 border-b border-white/10">
          <tr>
            <th className="px-6 py-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Time & Action</th>
            <th className="px-6 py-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest text-right">Value (USDC)</th>
            <th className="px-6 py-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Transaction</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {activity.map((item) => (
            <tr key={item.id} className="hover:bg-white/5 transition-colors group">
              <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    item.action.includes('Buy') || item.action.includes('Order') ? 'bg-blue-500/10 text-blue-500' :
                    item.action.includes('Reward') || item.action.includes('Sale') ? 'bg-green-500/10 text-green-500' :
                    'bg-gray-500/10 text-gray-500'
                  }`}>
                    {item.action.includes('Buy') ? <ArrowDownRight size={16} /> : 
                     item.action.includes('Reward') ? <Zap size={16} /> : 
                     item.action.includes('Update') ? <Activity size={16} /> :
                     <Ban size={16} />}
                  </div>
                  <div>
                    <div className="text-sm font-bold flex items-center gap-2">
                       {item.action}
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono">
                      {new Date(item.timestamp).toLocaleTimeString()} · {new Date(item.timestamp).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 text-right">
                <div className={`text-sm font-black ${item.value > 0 ? 'text-green-400' : item.value < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                  {item.value > 0 ? '+' : ''}{item.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">USDC Impact</div>
              </td>
              <td className="px-6 py-4">
                <a 
                  href={`https://peraexplorer.app/tx/${item.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg text-[10px] font-bold text-gray-400 hover:text-white transition-all"
                >
                  {item.id.slice(0, 8)}...
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
