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
let lastRefreshTs = Date.now();
let botFleet: Record<string, any> = {};
let pendingCommands: Record<string, { command: string, amountUsd?: number }> = {};
let stopSignals = new Map<number, { clean: boolean }>();
const historyMidpoints = new Map<number, number>();

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

    // Fetch ONLY reward markets to minimize API load as requested
    const rewardMarkets = await alphaClient.getRewardMarkets().catch((e: any) => {
      console.error('Failed to fetch reward markets:', e.message);
      return [];
    });

    // Calculate Efficiency Scores for Reward Markets using the info already returned
    // by getRewardMarkets without hammering the API for 156 separate queries!
    const rewardInfoMap = new Map();
    rewardMarkets.forEach(rm => {
      if (!rm) return;
      const appId = Number(rm.marketAppId || rm.appId || rm.id);
      
      const remainingPot = (rm.totalRewards || 0) - (rm.rewardsPaidOut || 0);
      const vol = Number(rm.volume24h || rm.volume || 1); // 1 to prevent /0
      
       // --- CORE METRICS ---
       const midpointPrice = Number(rm.midpoint || 500000); 
       const configBuffer = process.env.SAFETY_BUFFER_CENTS ? parseFloat(process.env.SAFETY_BUFFER_CENTS) : 1.5;
       const baseDistance = configBuffer * 10000;
       const relativeDistanceRatio = baseDistance / midpointPrice;
       const distanceFactor = Math.max(0, Math.pow(1 - (relativeDistanceRatio * 2), 2));

       // --- NEW: ACTUAL ENTRY COST (Based on Bot Settings) ---
       const userBufferCents = process.env.SAFETY_BUFFER_CENTS ? parseFloat(process.env.SAFETY_BUFFER_CENTS) : 1.5;
       const userBufferPts = userBufferCents * 10000;
       const minPrice = 1000; // 0.1c protocol floor
       
       const priceYesActual = Math.max(minPrice, midpointPrice - userBufferPts);
       const priceNoActual = Math.max(minPrice, (1000000 - midpointPrice) - userBufferPts);
       const unitPriceActual = (priceYesActual + priceNoActual) / 1000000;
       
       const minContracts = rm.rewardsMinContracts || 100000000;
       const bilateralEntryCost = unitPriceActual * (minContracts / 1e6);

       // --- NEW: EARNINGS AT MINIMUM ENTRY ---
       // For ROI/Earnings, we use the protocol's distanceFactor (score decay)
       const minScore = minContracts * distanceFactor * 2.5; 
       const totalPoolScore = Number(rm.currentMidpointLiquidity || (minContracts * 5));
       const minProjectedShare = (minScore / (totalPoolScore + minScore)) * 100;
       
       const poolDailyUsdc = ((rm.lastRewardAmount || 0) / 1e6) * 24;
       const minDailyYield = poolDailyUsdc * (minProjectedShare / 100);

       // efficiencyScore is now ROI% (Daily Yield / Actual Entry Cost)
       const yieldDensity = bilateralEntryCost > 0 ? (minDailyYield / bilateralEntryCost) : 0;

       // Legacy pointers
       const estDailyYield = minDailyYield;
       const projectedShare = minProjectedShare;

      // --- COMPETITION PENALTY & KILL-SWITCH ---
      const competitionRatio = Number(rm.lpRewardCompetitionPercentile || 0) / 100;
      
      // Hard lockout for oversaturated markets (>85% crowded)
      let crowdingMultiplier = 1 - competitionRatio;
      if (competitionRatio > 0.85) {
        crowdingMultiplier = 0.01; // Effectively remove from recommendations
      }

      // --- VOLATILITY PENALTY ---
      const lastMid = historyMidpoints.get(appId) || midpointPrice;
      const jitter = Math.abs(midpointPrice - lastMid);
      historyMidpoints.set(appId, midpointPrice);
      const volatilityWeight = jitter > 10000 ? 0.5 : (jitter > 5000 ? 0.8 : 1.0);

      // --- FINAL SCORE: ROI * Crowding * Volatility ---
      // Scaled for UI visibility (0-100+ range)
      const score = yieldDensity * 1000 * crowdingMultiplier * volatilityWeight;

      rewardInfoMap.set(appId, {
        ...rm,
        efficiencyScore: score,
        projectedShare: minProjectedShare,
        estDailyYield: minDailyYield,
        bilateralEntryCost: bilateralEntryCost,
        safetyGap: (rm.rewardsSpreadDistance || 30000) - 5000,
        isTrap: (rm.rewardsSpreadDistance || 30000) < 10000
      });
    });

    if (rewardMarkets && rewardMarkets.length > 0) {
      marketCache = rewardMarkets
        .filter((m: any) => (m.marketAppId || m.appId || m.id) && Number(m.marketAppId || m.appId || m.id) > 0)
        .map((m: any) => {
          const appId = Number(m.marketAppId || m.appId || m.id);
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
            competitionTag: rewardInfo ? rewardInfo.lpRewardCompetitionTag : 'Normal',
            competitionPercentile: rewardInfo ? rewardInfo.lpRewardCompetitionPercentile : 0,
            competitionWalletCount: rewardInfo && typeof rewardInfo.lpRewardCompetitionWalletCount === 'number' ? rewardInfo.lpRewardCompetitionWalletCount : 0,
            endTs: m.endTs || (rewardInfo ? rewardInfo.endTs : 0),
            categories: m.categories || [],
            currentMidpointLiquidity: rewardInfo ? Number(rewardInfo.currentMidpointLiquidity || 0) : 0,
            midpoint: rewardInfo ? Number(rewardInfo.midpoint || 0) : 0,
            // Injected Ranking Stats
            efficiencyScore: rewardInfo ? rewardInfo.efficiencyScore : 0,
            estDailyYield: rewardInfo ? rewardInfo.estDailyYield : 0,
            projectedShare: rewardInfo ? rewardInfo.projectedShare : 0,
            bilateralEntryCost: rewardInfo ? rewardInfo.bilateralEntryCost : 0,
            safetyGap: rewardInfo ? rewardInfo.safetyGap : 0,
            isTrap: rewardInfo ? rewardInfo.isTrap : false
          };
        });
      lastRefreshTs = Date.now();
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
setInterval(refreshMarkets, 2 * 60 * 1000); // Increased frequency: 2m

// --- API Endpoints ---

app.get('/api/bot/config', (req, res) => {
  res.json({
    address: getBotAddress(),
    network: 'mainnet',
    usdcAssetId: 31566704,
    targetMarketId: process.env.TARGET_MARKET_ID || '0'
  });
});

app.post('/api/bot/heartbeat', async (req, res) => {
  const { marketId, status, name, size, yesTotalZone, noTotalZone, yesMySize, noMySize, yesTotalScore, noTotalScore, yesMyScore, noMyScore, cashStatus, nav, activity, botId: incomingBotId } = req.body;
  
  // 1. UNIQUE IDENTIFICATION: Priority to the bot's self-generated unique ID
  const botId = incomingBotId || `${marketId}-${name}`;
  
  // 2. REMOTE SHUTDOWN CHECK: Does this specific bot have a pending command?
  const pulse = pendingCommands[botId] || { command: null };
  const signal = stopSignals.get(Number(marketId)); // Legacy fallback for single-market stop

  const isShutdownCommand = pulse && (pulse.command === 'STOP' || pulse.command === 'SHUTDOWN' || pulse.command === 'shutdown-keep' || pulse.command === 'shutdown-clean');

  if (signal || isShutdownCommand) {
    const shouldClean = (pulse.command === 'shutdown-clean') || (pulse.command === 'STOP_CLEAN') || (signal?.clean === true);
    const cmdToBot = shouldClean ? 'STOP_CLEAN' : 'STOP_KEEP';
    
    console.log(`📡 Relaying shutdown signal [${cmdToBot}] to bot [${botId}] for market ${marketId}`);
    
    stopSignals.delete(Number(marketId)); // Consume legacy signal
    if (pulse.command) delete pendingCommands[botId]; // Consume new signal
    
    return res.json({ 
      success: true, 
      shutdown: true, 
      clean: shouldClean,
      command: cmdToBot 
    });
  }

  // Calculate pool share percentage if data exists
  let poolPercentage = 0;
  let yesShare = 0;
  let noShare = 0;

  // UNIT SYNC: Everything is now standard in micro-units (1e6 basis)
  const m = marketCache.find(x => x.marketAppId === Number(marketId));
  
  // Official total zone liquidity from API (in micro-units)
  const apiTotalPoolMicro = m?.currentMidpointLiquidity ? Number(m.currentMidpointLiquidity) : 0;
  
  // REALITY-FIRST: Use on-chain detected size as truth
  const detectedSizeMicro = Math.max(Number(yesMySize || 0), Number(noMySize || 0));
  const targetSizeMicro = Number(size || 0) * 1e6;
  const activeSizeMicro = (detectedSizeMicro > 0) ? detectedSizeMicro : targetSizeMicro;

  // ACCURATE PERCENT: (Our Score / (Total Score + Our Score)) * 100
  // Favoring scores (distance-weighted) to match the 34.1% precision seen in official UI
  const totalZoneScore = Number(yesTotalScore || 0) + Number(noTotalScore || 0);
  const myTotalScore = Number(yesMyScore || 0) + Number(noMyScore || 0);
  const effectivePoolMicro = apiTotalPoolMicro > 0 ? apiTotalPoolMicro : Number(yesTotalZone || 0);

  if (myTotalScore > 0 && totalZoneScore > 0) {
    poolPercentage = (myTotalScore / totalZoneScore) * 100;
  } else if (effectivePoolMicro > 0) {
    // Fallback to simple size share if scores are missing
    poolPercentage = (activeSizeMicro / (effectivePoolMicro + activeSizeMicro)) * 100;
  }

  // Secondary Diagnostic Stats: Raw side-based shares
  if (yesTotalZone > 0) {
    yesShare = (Number(yesMySize || 0) / Number(yesTotalZone)) * 100;
  }
  if (noTotalZone > 0) {
    noShare = (Number(noMySize || 0) / Number(noTotalZone)) * 100;
  }

  // Update Market Cache with bot's live YES/NO volume (for discovery)
  if (yesTotalZone > 0 && noTotalZone > 0 && m) {
    const cacheIndex = marketCache.findIndex(x => x.marketAppId === Number(marketId));
    if (cacheIndex !== -1) {
      marketCache[cacheIndex].totalZoneLiquidity = (Number(yesTotalZone) + Number(noTotalZone)) / 2;
      marketCache[cacheIndex].lastScanFromBot = Date.now();
    }
  }

  // Safety Clamp: Cannot own more than 100% of the reward zone
  if (poolPercentage > 100) poolPercentage = 100;
  if (yesShare > 100) yesShare = 100;
  if (noShare > 100) noShare = 100;

  if (poolPercentage > 0) {
    console.log(`[DEBUG] Heartbeat ${name}: YES=${yesShare.toFixed(1)}%, NO=${noShare.toFixed(1)}%, FINAL=${poolPercentage.toFixed(1)}%`);
  }

  botFleet[botId] = {
    botId,
    name,
    marketId,
    lastHeartbeat: Date.now(),
    status: status || 'online',
    cashStatus: cashStatus || 'ok',
    activity: activity || 'Waiting for tick...',
    nav: nav || 0,
    size: size || 0,
    poolPercentage,
    yesShare,
    noShare,
    yesTotalZone,
    noTotalZone,
    competitionPercentile: m?.competitionPercentile || 0,
    competitionWalletCount: m?.competitionWalletCount || 0
  };

  // Final Check for command persistency
  // Stop commands are persistent until the bot confirms it is offline
  // Other commands (like add-budget) are cleared as soon as they are delivered
  if (pulse.command) {
    if (pulse.command.startsWith('STOP') || pulse.command === 'STOP_CLEAN' || pulse.command === 'STOP_KEEP') {
       if (status === 'offline') delete pendingCommands[botId];
    } else {
       delete pendingCommands[botId];
    }
  }
  
  res.json({ 
    ...pulse, 
    poolPercentage,
    yesShare,
    noShare
  });
});

app.post('/api/bot/control', (req, res) => {
  const { botId, command, amountUsd } = req.body;
  if (!botId || !command) return res.status(400).json({ error: 'Missing botId or command' });
  
  let normalizedCommand = command;
  if (command === 'stop-clean' || command === 'stop' || command === 'shutdown-clean') normalizedCommand = 'STOP_CLEAN';
  if (command === 'stop-keep' || command === 'shutdown-keep') normalizedCommand = 'STOP_KEEP';

  // Ensure amount is a number if provided
  const parsedAmount = amountUsd ? Number(amountUsd) : undefined;

  pendingCommands[botId] = { command: normalizedCommand, amountUsd: parsedAmount };
  console.log(`📡 Issued command [${normalizedCommand}]${parsedAmount ? ` with $${parsedAmount}` : ''} to bot [${botId}]`);
  res.json({ success: true });
});

app.get('/api/bot/status', async (req, res) => {
  const address = getBotAddress();
  if (!address) return res.status(500).json({ error: 'No bot address configured' });
  
  const now = Date.now();
  // Filter for only active bots based on the environment's TICK_INTERVAL (with a generous 2x buffer + 10s)
  const tickInt = process.env.TICK_INTERVAL ? parseInt(process.env.TICK_INTERVAL) : 30;
  const timeoutMs = (tickInt * 2 + 10) * 1000;
  const activeBots = Object.values(botFleet).filter((bot: any) => (now - bot.lastHeartbeat) < timeoutMs);
  
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
    // Increasing limit to 1000 for accurate historical aggregation
    const txns = await indexerClient.searchForTransactions()
      .address(address)
      .addressRole('receiver')
      .assetID(usdcAssetId)
      .limit(1000)
      .do();

    // Filter for transactions that are not from the bot itself (self-transfers)
    const incoming = txns.transactions.filter((t: any) => t.sender !== address);
    
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    const WEEK = 7 * DAY;

    const history = incoming.map((t: any) => ({
      txId: t.id,
      sender: t.sender,
      amount: Number(t.assetTransferTransaction?.amount || 0),
      timestamp: Number(t.roundTime || 0) * 1000,
      round: Number(t.confirmedRound || 0)
    }));

    const earnings = {
      last1h: history.filter(h => (now - h.timestamp) < HOUR).reduce((a, b) => a + b.amount, 0),
      last24h: history.filter(h => (now - h.timestamp) < DAY).reduce((a, b) => a + b.amount, 0),
      last7d: history.filter(h => (now - h.timestamp) < WEEK).reduce((a, b) => a + b.amount, 0),
      allTime: history.reduce((sum: number, r: any) => sum + r.amount, 0)
    };

    res.json({
      totalEarned: earnings.allTime,
      earnings,
      history: history.slice(0, 50) // Return recent history for UI table
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch reward history', details: error.message });
  }
});

app.get('/api/bot/cost-basis', async (req, res) => {
  const address = getBotAddress();
  const userAddress = req.query.userAddress as string;
  if (!address) return res.status(500).json({ error: 'No bot address configured' });

  try {
    const usdcAssetId = 31566704;
    
    // 1. Fetch all USDC (axfer) to bot
    const usdcTxns = await indexerClient.searchForTransactions()
      .address(address)
      .addressRole('receiver')
      .assetID(usdcAssetId)
      .do();

    // 2. Fetch all ALGO (pay) to bot
    const algoTxns = await indexerClient.searchForTransactions()
      .address(address)
      .addressRole('receiver')
      .txType('pay')
      .do();

    // If userAddress is provided, filter specifically for them.
    // Otherwise, sum ALL incoming from anyone NOT the bot itself.
    const userUsdcIn = usdcTxns.transactions
      .filter((t: any) => userAddress ? t.sender === userAddress : t.sender !== address)
      .reduce((sum: number, t: any) => sum + Number(t.assetTransferTransaction?.amount || 0), 0);

    const userAlgoIn = algoTxns.transactions
      .filter((t: any) => userAddress ? t.sender === userAddress : t.sender !== address)
      .reduce((sum: number, t: any) => sum + Number(t.paymentTransaction?.amount || 0), 0);

    res.json({
      totalUsdc: userUsdcIn,
      totalAlgo: userAlgoIn,
      formattedUsdc: userUsdcIn / 1e6,
      formattedAlgo: userAlgoIn / 1e6,
      isGlobal: !userAddress
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch cost basis', details: error.message });
  }
});

app.get('/api/bot/positions', async (req, res) => {
  const address = getBotAddress();
  if (!address) return res.status(500).json({ error: 'No bot address configured' });

  try {
    let rateLimitWarning = null;

    const [orders, positions] = await Promise.all([
      alphaClient.getWalletOrdersFromApi(address).catch(e => {
        console.warn(`[WARNING] Active Orders blocked by API limit:`, e.message);
        rateLimitWarning = "Alpha API Rate Limit (429) active. Live positions temporarily unavailable.";
        return [];
      }),
      alphaClient.getPositions(address).catch(e => {
        console.warn(`[WARNING] Positions blocked by API limit:`, e.message);
        rateLimitWarning = "Alpha API Rate Limit (429) active. Live positions temporarily unavailable.";
        return [];
      })
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
      positions: activePositions,
      warning: rateLimitWarning
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

app.get('/api/markets', async (req, res) => {
  const isStale = (Date.now() - lastRefreshTs) > (3 * 60 * 1000);
  if ((req.query.force === 'true' || isStale) && !isRefreshing) {
    console.log(`🔄 ${isStale ? 'Auto-refreshing stale' : 'Forced'} market data...`);
    refreshMarkets(); // Trigger in background
  }
  res.json({ 
    markets: marketCache, 
    lastRefresh: lastRefreshTs,
    isRefreshing
  });
});

app.post('/api/bot/stop', (req, res) => {
  const { marketId, clean } = req.body;
  if (!marketId) return res.status(400).json({ error: 'No market ID provided' });
  
  console.log(`🛑 Received shutdown signal for market ${marketId} (Clean: ${clean})`);
  stopSignals.set(Number(marketId), { clean: !!clean });
  res.json({ success: true, message: 'Shutdown signal queued' });
});

app.listen(port, () => {
  console.log(`📡 Backend running at http://localhost:${port}`);
});
