import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import algosdk from 'algosdk';
import path from 'path';
import { fileURLToPath } from 'url';
import { AlphaClient } from '@alpha-arcade/sdk';
// Using built-in fetch (available in Node.js 18+)

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// --- Configuration ---
const DEFAULT_API_BASE_URL = 'https://platform.alphaarcade.com/api';
const DEFAULT_MARKET_CREATOR_ADDRESS = '5P5Y6HTWUNG2E3VXBQDZN3ENZD3JPAIR5PKT3LOYJAPAUKOLFD6KANYTRY';

// --- Discovery Bootstrap (Active Markets) ---
let marketCache: any[] = [
  { marketAppId: 2785648646, title: "USA vs Canada - NHL 4 Nations", volume: 15600, resolutionValue: "Sports", source: 'bootstrap' },
  { marketAppId: 2785681702, title: "Will ALGO exceed $0.35 by end of week?", volume: 24200, resolutionValue: "Crypto", source: 'bootstrap' },
  { marketAppId: 2787387138, title: "Premier League: Arsenal vs Man City", volume: 45000, resolutionValue: "Sports", source: 'bootstrap' }
];

let isRefreshing = false;
let botFleet: Record<string, any> = {};

// --- Setup Algorand Client ---
const algodClient = new algosdk.Algodv2(
  process.env.ALGOD_TOKEN || '',
  process.env.ALGOD_SERVER || 'https://mainnet-api.algonode.cloud',
  process.env.ALGOD_PORT || '443'
);

const indexerClient = new algosdk.Indexer(
  process.env.INDEXER_TOKEN || '',
  process.env.INDEXER_SERVER || 'https://mainnet-idx.algonode.cloud',
  process.env.INDEXER_PORT || '443'
);

// --- Initialize Alpha Client ---
let alphaClient: AlphaClient;
try {
  const mnemonic = process.env.MNEMONIC;
  if (mnemonic) {
    const account = algosdk.mnemonicToSecretKey(mnemonic);
    alphaClient = new AlphaClient({
      algodClient,
      indexerClient,
      signer: algosdk.makeBasicAccountTransactionSigner(account),
      activeAddress: account.addr.toString(),
      apiKey: process.env.ALPHA_API_KEY || '',
      matcherAppId: 3078581851, // Correct Mainnet Matcher
      usdcAssetId: 31566704,    // Mainnet USDC
    });
  } else {
    // Fallback signer for read-only (if SDK allows empty/dummy, but here we use MNEMONIC)
    console.warn('⚠️ No MNEMONIC found; AlphaClient might fail on write ops.');
    alphaClient = new AlphaClient({
      algodClient,
      indexerClient,
      apiKey: process.env.ALPHA_API_KEY || '',
      matcherAppId: 3078581851,
      usdcAssetId: 31566704,
    } as any);
  }
} catch (e) {
  console.error('❌ Failed to initialize AlphaClient:', e);
}

// --- Helpers ---
function getBotAddress() {
  if (!process.env.MNEMONIC) return null;
  try {
    const account = algosdk.mnemonicToSecretKey(process.env.MNEMONIC);
    return account.addr.toString();
  } catch (e) {
    return null;
  }
}

function decodeGlobalState(rawState: any[]): Record<string, any> {
  const state: Record<string, any> = {};
  for (const item of rawState) {
    const key = Buffer.from(item.key, 'base64').toString();
    const val = item.value;
    if (val.type === 1) { // Bytes
      if (['owner', 'oracle_address', 'fee_address', 'market_friend_addr'].includes(key)) {
        try {
          const bytes = Buffer.from(val.bytes, 'base64');
          if (bytes.length === 32) state[key] = algosdk.encodeAddress(new Uint8Array(bytes));
          else state[key] = val.bytes;
        } catch { state[key] = val.bytes; }
      } else {
        try { state[key] = Buffer.from(val.bytes, 'base64').toString(); }
        catch { state[key] = val.bytes; }
      }
    } else { state[key] = Number(val.uint); }
  }
  return state;
}

/**
 * Optimized Background Market Refresher
 */
async function refreshMarkets() {
  if (isRefreshing) return;
  isRefreshing = true;
  console.log('🔄 Syncing with Alpha Protocol via SDK (including Rewards)...');

  try {
    if (!alphaClient) {
      console.error('❌ AlphaClient not initialized; skipping refresh.');
      return;
    }

    // Fetch both live markets and reward markets in parallel for speed
    const [allMarkets, rewardMarkets] = await Promise.all([
      alphaClient.getLiveMarkets(),
      alphaClient.getRewardMarkets().catch(() => []) // Fallback to empty if fails
    ]);

    const rewardInfoMap = new Map(rewardMarkets.map(m => [Number(m.marketAppId), m]));
    
    if (allMarkets && allMarkets.length > 0) {
      marketCache = allMarkets
        .filter((m: any) => m.marketAppId && Number(m.marketAppId) > 0)
        .map((m: any) => {
          const appId = Number(m.marketAppId);
          const rewardInfo = rewardInfoMap.get(appId);
          
          return {
            marketAppId: appId,
            title: m.title,
            volume: Math.floor(Number(m.volume || 0) * 1e6),
            resolutionValue: "Mainnet",
            source: m.source || 'sdk',
            isReward: !!rewardInfo,
            rewardsMinContracts: rewardInfo ? rewardInfo.rewardsMinContracts : 0,
            lastRewardAmount: rewardInfo ? rewardInfo.lastRewardAmount : 0,
            lastRewardTs: rewardInfo ? rewardInfo.lastRewardTs : 0,
            totalRewards: rewardInfo ? rewardInfo.totalRewards : 0,
            rewardsPaidOut: rewardInfo ? rewardInfo.rewardsPaidOut : 0,
            competitionTag: rewardInfo ? rewardInfo.lpRewardCompetitionTag : 'unknown',
            endTs: m.endTs || (rewardInfo ? rewardInfo.endTs : 0)
          };
        });
      console.log(`✅ Cached ${marketCache.length} valid markets (${rewardInfoMap.size} rewards) via SDK`);
    } else {
      console.log('⚠️ SDK returned no markets; maintaining current cache.');
    }
  } catch (error: any) {
    console.error('❌ Market Refresh Error:', error.message);
  } finally {
    isRefreshing = false;
  }
}

// Initial refresh in background
refreshMarkets();
setInterval(refreshMarkets, 10 * 60 * 1000);

// --- API Endpoints ---

app.get('/api/bot/config', (req, res) => {
  res.json({
    address: getBotAddress(),
    network: 'mainnet',
    usdcAssetId: 31566704,
    targetMarketId: process.env.TARGET_MARKET_ID || '0'
  });
});

app.post('/api/bot/heartbeat', (req, res) => {
  const { marketId, status, name } = req.body;
  const botId = name ? `${name}-${marketId}` : `bot-${marketId}`;
  
  botFleet[botId] = {
    botId,
    name: name || `Market ${marketId}`,
    marketId,
    lastHeartbeat: Date.now(),
    status: status || 'online'
  };
  res.json({ success: true });
});

app.get('/api/bot/status', async (req, res) => {
  const address = getBotAddress();
  if (!address) return res.status(500).json({ error: 'No bot address configured' });
  
  const now = Date.now();
  // Filter for bots that have pinged in the last 65 seconds
  const activeBots = Object.values(botFleet).filter((bot: any) => (now - bot.lastHeartbeat) < 65000);
  
  try {
    const accountInfo: any = await algodClient.accountInformation(address).do();
    const usdcAssetId = 31566704;
    const usdcAsset = accountInfo.assets?.find((a: any) => Number(a.assetId ?? a['asset-id']) === usdcAssetId);
    const usdcAmount = Number(usdcAsset ? usdcAsset.amount : 0);
    
    res.json({
      algo: Number(accountInfo.amount || 0),
      usdc: usdcAmount,
      minBalance: Number(accountInfo['min-balance-requirement'] || 100000),
      warning: usdcAmount < 10000000 ? 'Low USDC Balance' : null,
      fleet: activeBots
    });
  } catch (errorBit: any) {
    res.status(500).json({ error: 'Failed to fetch bot status', details: errorBit.message });
  }
});

app.get('/api/bot/rewards', async (req, res) => {
  const address = getBotAddress();
  if (!address) return res.status(500).json({ error: 'No bot address configured' });
  
  try {
    const usdcAssetId = 31566704;
    // Scan for incoming USDC (axfer) where the receiver is the bot
    const txns = await indexerClient.searchForTransactions()
      .address(address)
      .addressRole('receiver')
      .assetID(usdcAssetId)
      .limit(50)
      .do();

    // Filter for transactions that are not from the bot itself (self-transfers)
    const incoming = txns.transactions.filter((t: any) => t.sender !== address);
    
    const history = incoming.map((t: any) => ({
      txId: t.id,
      sender: t.sender,
      amount: Number(t.assetTransferTransaction?.amount || 0),
      timestamp: Number(t.roundTime || 0) * 1000,
      round: Number(t.confirmedRound || 0)
    }));

    const totalEarned = history.reduce((sum: number, r: any) => sum + r.amount, 0);

    res.json({
      totalEarned,
      history
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch reward history', details: error.message });
  }
});

app.get('/api/bot/positions', async (req, res) => {
  const address = getBotAddress();
  if (!address) return res.status(500).json({ error: 'No bot address configured' });

  try {
    const [orders, positions] = await Promise.all([
      alphaClient.getWalletOrdersFromApi(address),
      alphaClient.getPositions(address)
    ]);

    // Format active positions (only those with non-zero balances)
    const activePositions = positions
      .filter(p => p.yesBalance > 0 || p.noBalance > 0)
      .map(p => ({
        marketAppId: p.marketAppId,
        yes: p.yesBalance,
        no: p.noBalance
      }));

    res.json({
      orders: orders.map(o => ({
        id: o.escrowAppId,
        marketAppId: o.marketAppId,
        side: o.side === 1 ? 'BUY' : 'SELL',
        position: o.position === 1 ? 'YES' : 'NO',
        price: o.price / 1e6,
        quantity: o.quantity
      })),
      positions: activePositions
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch positions', details: error.message });
  }
});

app.get('/api/bot/activity', async (req, res) => {
  const address = getBotAddress();
  if (!address) return res.status(500).json({ error: 'No bot address configured' });
  
  try {
    const usdcAssetId = 31566704;
    // Fetch recent transaction history (App calls + Assets)
    const txns = await indexerClient.searchForTransactions()
      .address(address)
      .limit(100)
      .do();

    const activity = txns.transactions.map((t: any) => {
      const type = t.txType;
      const timestamp = t.roundTime * 1000;
      let action = 'Unknown Action';
      let value = 0;
      let detail = '';

      if (type === 'appl') {
        const appId = t.applicationTransaction?.applicationId;
        action = `Order Update (App ${appId})`;
        detail = 'Limit Order / Cancellation';
      } else if (type === 'axfer' && Number(t.assetTransferTransaction?.assetId) === usdcAssetId) {
        value = Number(t.assetTransferTransaction?.amount || 0);
        if (t.sender === address) {
          action = 'Filled Order / Buy';
          value = -value; // Outgoing
        } else {
          action = 'Reward / Fill Sale';
        }
      }

      return {
        id: t.id,
        type,
        action,
        value: value / 1e6,
        timestamp: Number(timestamp || 0),
        round: Number(t.confirmedRound || 0)
      };
    });

    res.json(activity);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch activity', details: error.message });
  }
});

app.get('/api/markets', (req, res) => {
  res.json(marketCache);
});

app.listen(port, () => {
  console.log(`📡 Backend running at http://localhost:${port}`);
});
