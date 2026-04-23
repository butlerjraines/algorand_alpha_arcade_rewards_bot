import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient, AlphaWebSocket } from '@alpha-arcade/sdk';

dotenv.config();

/**
 * ALPHA ARCADE REWARDS BOT (IRONCLAD DELTA-NEUTRAL)
 * Strictly follows docs/technical_spec.md
 */

// --- CLI Argument Parsing ---
const marketFlagIdx = process.argv.indexOf('--market');
const marketArg = (marketFlagIdx !== -1) ? process.argv[marketFlagIdx + 1] : (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null);
const useMax = process.argv.includes('--max');
const injectArgIdx = process.argv.indexOf('--inject');
const injectAmount = injectArgIdx !== -1 ? parseFloat(process.argv[injectArgIdx + 1]) : null;

const activeMarketId = marketArg ? parseInt(marketArg) : parseInt(process.env.TARGET_MARKET_ID || '0');

if (!activeMarketId) {
  console.error('❌ Usage: npm run bot <MARKET_ID> [--max] [--inject <AMOUNT>]');
  process.exit(1);
}

// --- Risk Constants ---
const USDC_BUFFER_PERCENT = parseFloat(process.env.USDC_BUFFER_PERCENT || '0.15'); // Reserve 15% USDC
const MAX_SLIPPAGE_TOLERANCE = parseFloat(process.env.MAX_SLIPPAGE_TOLERANCE || '0.02');
const DUST_THRESHOLD = parseFloat(process.env.DUST_THRESHOLD || '0.1') * 1e6;
const REWARD_SAFETY_BUFFER = 5000; // 0.5c from the edge
const REWARD_MONITOR_BUFFER = 2000; // 0.2c from the edge triggers refresh

// --- Global State ---
let botId = `Ironclad-${activeMarketId}`;
let currentPhase = 'INIT';
let targetShares = 0;
let isProcessingFill = false;
let isShuttingDown = false;
let isCycleRunning = false;
let marketEndTs = 0;
let rewardsMidpoint = 500_000;
let rewardsSpread = 0; // Strictly determined by SDK
let marketSlug = "";
let isBtcMarket = false;
let isCryptoMarket = false;
let currentBtcPrice = 0;
let lastBtcPrice = 0;
let tickCount = 0;

let globalClient: AlphaClient;
let globalAlgod: algosdk.Algodv2;
let globalAddress: string;

async function sendHeartbeat(payload: any) {
  tickCount++;
  const mid = (rewardsMidpoint / 10000).toFixed(1);
  const spr = (rewardsSpread / 10000).toFixed(1);
  const strategyInfo = isCryptoMarket ? 'Center (0.5¢)' : 'Edge (0.5¢)';
  const btcInfo = isBtcMarket && currentBtcPrice > 0 ? ` | BTC: $${currentBtcPrice.toLocaleString()}` : '';

  const statusMsg = isProcessingFill ? 'Processing Fill/Hedge' :
    isShuttingDown ? 'Shutting Down' :
    currentPhase === 'MAKER' ? `Monitoring Reward Zone | Mode: ${strategyInfo}` :
    `Running ${currentPhase} Phase`;

  const inv = payload.inventory || { yes: 0, no: 0, neutral: 0 };
  const balanceMsg = `[Y: ${Math.floor(inv.yes / 1e6)} | N: ${Math.floor(inv.no / 1e6)}]`;

  console.log(`⏱️ [TICK ${tickCount}] ${statusMsg}${btcInfo} | ${balanceMsg} | Mid: ${mid}¢ | Zone: ±${spr}¢ | Capital: $${(payload.size || 0).toFixed(2)}`);
  try {
    const resp = await fetch('http://localhost:3001/api/bot/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botId,
        marketId: activeMarketId,
        name: botId,
        status: 'online',
        phase: currentPhase,
        ...payload
      })
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.btcPrice) currentBtcPrice = data.btcPrice;
      return data;
    } else {
      console.log(`⚠️ [HEARTBEAT] Server error: ${resp.status}`);
    }
  } catch (e: any) {
    console.log(`⚠️ [HEARTBEAT] Connection failed: ${e.message}`);
  }

  // Standalone Fallback: If server is down, fetch directly if it's a BTC market
  if (isBtcMarket) {
    try {
      const btcResp = await fetch('https://api.binance.us/api/v3/ticker/price?symbol=BTCUSDT');
      if (btcResp.ok) {
        const btcData = await btcResp.json() as any;
        currentBtcPrice = parseFloat(btcData.price);
      }
    } catch (e) { }
  }
  return null;
}

async function main() {
  if (!process.env.MNEMONIC || !process.env.ALPHA_API_KEY) {
    console.error('❌ Missing MNEMONIC or ALPHA_API_KEY in .env');
    process.exit(1);
  }

  const account = algosdk.mnemonicToSecretKey(process.env.MNEMONIC);
  const address = account.addr.toString();
  const algodClient = new algosdk.Algodv2('', process.env.ALGOD_SERVER || 'https://mainnet-api.algonode.cloud', '443');
  const indexerClient = new algosdk.Indexer('', process.env.INDEXER_SERVER || 'https://mainnet-idx.algonode.cloud', '443');

  const alphaClient = new AlphaClient({
    algodClient,
    indexerClient,
    signer: algosdk.makeBasicAccountTransactionSigner(account),
    activeAddress: address,
    apiKey: process.env.ALPHA_API_KEY,
    matcherAppId: 3078581851,
    usdcAssetId: 31566704,
  });

  globalClient = alphaClient;
  globalAlgod = algodClient;
  globalAddress = address;
  let volatilityCooldown = 0;

  console.log(`\n🦅 [${botId}] Booting Ironclad Strategy...`);

  // --- Safety Check: ALGO for Gas ---
  const accountInfo = await algodClient.accountInformation(address).do();
  const algoBalance = Number(accountInfo.amount) / 1e6;
  if (algoBalance < 10) {
    console.error(`❌ [ERROR] Insufficient ALGO. Current: ${algoBalance.toFixed(2)}. Please have at least 10 ALGO for gas and fees.`);
    process.exit(1);
  }

  // --- Phase 1: Metadata Discovery ---
  currentPhase = 'DISCOVERY';
  const rewardMarkets = await alphaClient.getRewardMarkets() as any[];
  const market = rewardMarkets.find((m: any) => m.marketAppId === activeMarketId);

  if (!market) {
    console.error(`❌ [ERROR] Market ${activeMarketId} not found in reward markets.`);
    process.exit(1);
  }

  const rewardsMinContracts = Number(market.rewardsMinContracts || 100_000_000);
  rewardsSpread = Number(market.rewardsSpreadDistance);
  if (!rewardsSpread || isNaN(rewardsSpread)) {
    console.error(`❌ [ERROR] Rewards Spread Distance not found in SDK metadata for market ${activeMarketId}.`);
    process.exit(1);
  }
  rewardsMidpoint = Number(market.midpoint || 500_000);
  marketEndTs = Number(market.endTs || 0);
  marketSlug = market.slug || "";
  const title = market.title || activeMarketId.toString();
  isBtcMarket = /btc|bitcoin/i.test(title);
  const categories = (market as any).categories || [];
  const isCryptoMarket = categories.includes('Crypto') || categories.includes('crypto_DAILY');

  if (isCryptoMarket) {
    console.log(`💎 [STRATEGY] Crypto Market detected. Applying "Center Farming" (0.5¢ buffer) to minimize fees.`);
  }

  // --- 🛡️ AUTHORITY OVERRIDE BEFORE STARTUP ---
  // Before we place the FIRST orders, fetch the LIVE market state to avoid stale pricing
  try {
    const liveMarket = await alphaClient.getMarket(marketSlug);
    if (liveMarket) {
      const liveMid = Number(liveMarket.lastPrice || liveMarket.price || liveMarket.midpoint || 0);
      if (liveMid > 0 && Math.abs(liveMid - rewardsMidpoint) > 100) {
        console.log(`📡 [BOOT SYNC] Overriding stale metadata (${(rewardsMidpoint / 10000).toFixed(2)}¢) with Live Price: ${(liveMid / 10000).toFixed(2)}¢`);
        rewardsMidpoint = liveMid;
      }
    }
  } catch (e) {
    console.warn(`⚠️ [BOOT SYNC] Failed to fetch live price. Falling back to metadata.`);
  }

  // Normalize seconds to milliseconds if needed
  if (marketEndTs > 0 && marketEndTs < 10000000000) {
    marketEndTs *= 1000;
  }
  console.log(`[DISCOVERY] Market: ${market.title || activeMarketId}`);
  console.log(`[DISCOVERY] Min Size: ${(rewardsMinContracts / 1e6).toFixed(0)} | Max Spread: ${(rewardsSpread / 10000).toFixed(1)}¢`);
  if (marketEndTs > 0) {
    console.log(`[DISCOVERY] Market Ends: ${new Date(marketEndTs).toLocaleString()}`);
  }

  // --- 🛡️ WHALE / OVERCROWDING ALERT ---
  const isYesSafe = rewardsMidpoint <= rewardsSpread;
  const isNoSafe = (1000000 - rewardsMidpoint) <= rewardsSpread;
  // Try both common SDK field names
  const competition = Number(market.lpRewardCompetitionPercentile || market.competitionPercentile || 0);

  if (isYesSafe || isNoSafe) {
    console.log(`\n🚨 [WHALE ALERT] Zero-Risk Farming detected!`);
    console.log(`   Midpoint: ${(rewardsMidpoint / 10000).toFixed(1)}¢ | Spread: ±${(rewardsSpread / 10000).toFixed(1)}¢`);

    if (isYesSafe) {
      console.log(`   WHY: The "Safety Floor" of 0¢ is INSIDE the reward zone (Midpoint - Spread).`);
      console.log(`   This allows whales to farm rewards with ZERO risk of being filled.`);
    } else if (isNoSafe) {
      console.log(`   WHY: The "Safety Ceiling" of 100¢ is INSIDE the reward zone (Midpoint + Spread).`);
      console.log(`   This allows whales to farm rewards with ZERO risk of being filled.`);
    }

    console.log(`   Crowding: ${competition > 0 ? competition + '%' : 'Oversaturated (Detected)'}`);
    console.log(`   RESULT: Your 100-share minimum will likely earn 0% against whale volume.`);
    console.log(`   💡 Advice: Find a market where Midpoint > Spread to avoid the whales.\n`);
  }

  // --- Pre-flight Reward Zone Check ---
  // Crypto markets use a tight 0.5c buffer to survive volatility without re-orders.
  // Non-crypto uses the standard 95% edge strategy.
  const targetSpread = isCryptoMarket ? 5000 : Math.round(rewardsSpread * 0.95);
  const yesAskRaw = rewardsMidpoint + targetSpread;
  const noAskRaw = (1000000 - rewardsMidpoint) + targetSpread;

  // What would the actual orders be? (Clamped)
  const yesAskClamped = Math.min(Math.max(yesAskRaw, 1000), 999000);
  const noAskClamped = Math.min(Math.max(noAskRaw, 1000), 999000);

  // Is the clamped price still within the reward zone?
  // Reward zone is [Mid - Spread, Mid + Spread]
  const isYesValid = Math.abs(yesAskClamped - rewardsMidpoint) <= rewardsSpread;
  const isNoValid = Math.abs(noAskClamped - (1000000 - rewardsMidpoint)) <= rewardsSpread;

  if (!isYesValid || !isNoValid) {
    console.error(`\n❌ [ERROR] Reward zone is unreachable even with price clamping.`);
    console.error(`   Midpoint: ${(rewardsMidpoint / 10000).toFixed(1)}¢ | Spread: ${(rewardsSpread / 10000).toFixed(1)}¢`);
    console.error(`   The required reward zone does not overlap with valid market prices ($0.001 - $0.999).`);
    process.exit(1);
  }

  console.log(`✅ [VALIDATION] Reward zone is reachable. Clamped prices: YES $${(yesAskClamped / 1e6).toFixed(3)}, NO $${(noAskClamped / 1e6).toFixed(3)}`);

  // --- Initial Cleanup & Sizing ---
  await cancelAllOrders(alphaClient, address, activeMarketId);
  const initialPos = await alphaClient.getPositions(address);
  const mPos = initialPos.find(p => p.marketAppId === activeMarketId);
  if (mPos) {
    const matched = Math.min(mPos.yesBalance, mPos.noBalance);
    if (matched > DUST_THRESHOLD) {
      console.log(`[INIT] Merging existing balanced position: ${(matched / 1e6).toFixed(1)} pairs...`);
      await alphaClient.mergeShares({ marketAppId: activeMarketId, amount: matched }).catch(() => { });
    }
  }

  targetShares = await calculateTargetSize(algodClient, address, rewardsMinContracts);
  console.log(`[SYSTEM] Initial Target Size: ${(targetShares / 1e6).toFixed(2)} USDC per side.`);

  // --- WebSocket Activation ---
  const ws = new AlphaWebSocket();

  // 1. Fill Monitor (Existing)
  ws.subscribeWalletOrders(address, async (event: any) => {
    if (isProcessingFill || isShuttingDown) return;
    const fill = event.orders?.find((o: any) =>
      Number(o.marketAppId) === activeMarketId &&
      (o.status === 'PARTIAL' || o.status === 'FILLED') &&
      o.quantityFilled > 0 &&
      !o.isBuying
    );
    if (fill) await rebalanceAndRecycle(fill.quantityFilled, 'Fill detected');
  });

  // 2. Real-Time Midpoint Monitor (New!)
  if (marketSlug) {
    console.log(`📡 [WS] Subscribing to Market Updates: ${marketSlug}`);
    ws.subscribeMarket(marketSlug, async (event: any) => {
      if (isCycleRunning || isProcessingFill || isShuttingDown) return;

      const m = event.market || event;
      const newMid = Number(m.lastPrice || m.price || m.midpoint || 0);

      if (newMid > 0 && Math.abs(newMid - rewardsMidpoint) > 200) { // 0.02c sensitivity
        console.log(`⚡ [WS SHIFT] Price moved: ${(rewardsMidpoint / 10000).toFixed(2)}¢ -> ${(newMid / 10000).toFixed(2)}¢`);
        rewardsMidpoint = newMid;

        // Trigger instant adjustment if we have orders
        const orders = await alphaClient.getWalletOrdersFromApi(address);
        const mOrders = orders.filter(o => Number(o.marketAppId) === activeMarketId);

        let needsInstantRefresh = false;
        for (const order of mOrders) {
          const isYes = String(order.position) === '1';
          const sideMid = isYes ? rewardsMidpoint : (1000000 - rewardsMidpoint);
          if (Math.abs(Number(order.price) - sideMid) > (rewardsSpread * 0.95)) {
            needsInstantRefresh = true;
            break;
          }
        }

        if (needsInstantRefresh) {
          console.log(`🚀 [WS TRIGGER] Instant adjustment required!`);
          await startCycle('WebSocket Midpoint Drift');
        }
      }
    });
  }

  // --- Drift & Expiry Monitor & Heartbeat ---
  const monitor = async () => {
    // Fetch live inventory for telemetry
    const positions = await alphaClient.getPositions(address);
    const mPos = positions.find(p => p.marketAppId === activeMarketId);
    const inv = { yes: mPos?.yesBalance || 0, no: mPos?.noBalance || 0, neutral: 0 };

    // Heartbeat (always send even if busy)
    const hbData = await sendHeartbeat({
      activity: `Phase: ${currentPhase}`,
      size: targetShares / 1e6,
      inventory: inv,
      yesMySize: inv.yes,
      noMySize: inv.no
    });

    // --- 🛡️ PROCESSING WATCHDOG ---
    // If we've been "processing" for > 60s, something hung. Reset.
    if (isProcessingFill && tickCount % 12 === 0) {
      console.warn(`⚠️ [WATCHDOG] Rebalance phase active for > 60s. Forcing reset...`);
      isProcessingFill = false;
    }

    if (isProcessingFill || isShuttingDown) return;

    // --- 🛡️ VOLATILITY COOLDOWN CHECK ---
    if (Date.now() < volatilityCooldown) {
      console.log(`⏱️  [VOLATILITY COOLDOWN] ${((volatilityCooldown - Date.now()) / 1000).toFixed(0)}s remaining...`);
      return;
    }

    if (hbData?.command) {
      const cmd = hbData.command;
      if (cmd === 'STOP_CLEAN') {
        console.log(`📡 [REMOTE] Received STOP_CLEAN signal.`);
        await cleanup(globalClient, globalAddress, true);
        return;
      }
      if (cmd === 'STOP_KEEP') {
        console.log(`📡 [REMOTE] Received STOP_KEEP signal.`);
        await cleanup(globalClient, globalAddress, false);
        return;
      }
      if (cmd === 'inject' || cmd === 'ADDBUDGET' || cmd === 'add-budget') {
        const amt = hbData.amountUsd || 0;
        console.log(`📡 [REMOTE] Injecting $${amt} additional budget.`);
        targetShares += (amt * 1e6);
        // Trigger a refresh if in MAKER phase to deploy new capital
        if (currentPhase === 'MAKER') await startCycle('Budget injection');
      }
    }

    // Check Market Expiry (1 hour before end)
    if (marketEndTs > 0 && Date.now() > (marketEndTs - 3600000)) {
      console.log(`\n🚨 [TERMINATE] Market nearing resolution (within 1hr). Triggering graceful exit...`);
      await cleanup(alphaClient, address, true);
      return;
    }

    try {
      // Refresh Reward Metadata (Even in ERROR phase to allow recovery)
      const rewardMarkets = await alphaClient.getRewardMarkets() as any[];
      const m = rewardMarkets.find((rm: any) => rm.marketAppId === activeMarketId);

      if (m) {
        const newMid = Number(m.midpoint || 500_000);
        const newSpr = Number(m.rewardsSpreadDistance);

        if (!newSpr || isNaN(newSpr)) {
          console.warn(`⚠️ [SDK] Could not refresh spread distance from metadata. Holding last known: ${(rewardsSpread / 10000).toFixed(1)}¢`);
        } else {
          if (newSpr !== rewardsSpread) {
            console.log(`📡 [SPREAD SHIFT] ${(rewardsSpread / 10000).toFixed(1)}¢ -> ${(newSpr / 10000).toFixed(1)}¢`);
            rewardsSpread = newSpr;
          }
        }
        if (rewardsMidpoint > 0 && Math.abs(newMid - rewardsMidpoint) > 30000) {
          console.log(`\n⚠️ [VOLATILITY GATE] Sharp Midpoint Shift Detected: ${((newMid - rewardsMidpoint) / 10000).toFixed(1)}¢`);
          console.log(`🛡️  Pulling orders and entering 30s cooldown for safety...`);
          await cleanup(alphaClient, address, false, false); // Cancel only, don't exit process
          rewardsMidpoint = newMid;
          volatilityCooldown = Date.now() + 30000;
          return;
        }

        if (newMid !== rewardsMidpoint || newSpr !== rewardsSpread) {
          // Update immediately on any move > 0.01c to ensure we stay in the reward zone.
          if (newMid > 0 && (Math.abs(newMid - rewardsMidpoint) > 100 || newSpr !== rewardsSpread)) {
            console.log(`📡 [REWARDS SYNC] Mid: ${(newMid / 10000).toFixed(2)}¢ | Spr: ±${(newSpr / 10000).toFixed(1)}¢`);
            rewardsMidpoint = newMid;
            rewardsSpread = newSpr;
          }
        }

        // --- 🛡️ BTC VOLATILITY GUARD ---
        if (isBtcMarket && lastBtcPrice > 0 && currentBtcPrice > 0) {
          const btcChange = Math.abs(currentBtcPrice - lastBtcPrice) / lastBtcPrice;
          if (btcChange > 0.005) { // 0.5% move
            console.log(`\n⚠️ [BTC VOLATILITY] Sharp BTC Move: ${(btcChange * 100).toFixed(2)}%`);
            console.log(`🛡️  Pulling orders and entering 60s cooldown for safety...`);
            await cancelAllOrders(alphaClient, address, activeMarketId);
            volatilityCooldown = Date.now() + 60000;
            lastBtcPrice = currentBtcPrice;
            return;
          }
        }
        if (isBtcMarket && currentBtcPrice > 0) lastBtcPrice = currentBtcPrice;

        // Send enriched telemetry with SDK midpoint liquidity
        const totalZone = m.currentMidpointLiquidity || 0;
        await sendHeartbeat({
          inventory: inv,
          size: targetShares / 1e6,
          yesMySize: inv.yes,
          noMySize: inv.no,
          yesTotalZone: totalZone,
          noTotalZone: totalZone
        });
      }

      if (currentPhase === 'ERROR') {
        const yesAskRaw = rewardsMidpoint + rewardsSpread;
        const noAskRaw = (1000000 - rewardsMidpoint) + rewardsSpread;
        const yClamped = Math.min(Math.max(yesAskRaw, 1000), 999000);
        const nClamped = Math.min(Math.max(noAskRaw, 1000), 999000);
        const reachY = Math.abs(yClamped - rewardsMidpoint) <= rewardsSpread;
        const reachN = Math.abs(nClamped - (1000000 - rewardsMidpoint)) <= rewardsSpread;

        if (reachY && reachN) {
          console.log(`📡 [RECOVERY] Market conditions returned to valid range. Attempting restart...`);
          await startCycle('Error recovery');
        }
        return;
      }

      // --- 🛡️ AUTHORITY SYNC (EVERY TICK) ---
      // Since getMarket is returning null for some markets, we rely on the 
      // rewards metadata which we've verified contains the live 41.9c price.
      // The background poll handles this, but we'll force a check here if it's stale.
      
      if (currentPhase !== 'MAKER') return;

      const orders = await alphaClient.getWalletOrdersFromApi(address);
      const mOrders = orders.filter(o => Number(o.marketAppId) === Number(activeMarketId));

      console.log(`\n🕒 [TICK ${tickCount++}] Mid: ${(rewardsMidpoint / 10000).toFixed(2)}¢ | Spread: ±${(rewardsSpread / 10000).toFixed(1)}¢`);

      if (orders.length > 0 && mOrders.length === 0) {
        console.log(`⚠️ [ID MISMATCH?] Found ${orders.length} orders in wallet, but NONE match Market ID ${activeMarketId}.`);
        console.log(`   Available IDs in wallet: ${[...new Set(orders.map(o => o.marketAppId))].join(', ')}`);
      }

      // Heartbeat with real order data
      const orderInv = {
        yes: mOrders.find(o => String(o.position) === '1' || String(o.side).toLowerCase() === 'yes') ? 1_000_000 : 0,
        no: mOrders.find(o => String(o.position) === '0' || String(o.side).toLowerCase() === 'no') ? 1_000_000 : 0,
      };
      await sendHeartbeat({
        inventory: orderInv,
        size: targetShares / 1e6,
        yesMySize: orderInv.yes,
        noMySize: orderInv.no
      });

      if (mOrders.length > 0) {
        let needsRefresh = false;

        // 🛡️ DUPLICATE GUARD: If we have > 2 orders, something is wrong
        if (mOrders.length > 2) {
          console.log(`📡 [CLEANUP] Multiple orders detected (${mOrders.length}). Purging and resetting...`);
          needsRefresh = true;
        }

        if (!needsRefresh) {
          // 🛡️ INVERSION GUARD: Check if YES and NO are at the same price (and Mid is not 50)
          const yesO = mOrders.find(o => o.position === 1);
          const noO = mOrders.find(o => o.position === 0);
          if (yesO && noO && Math.abs(Number(yesO.price) - Number(noO.price)) < 100 && Math.abs(rewardsMidpoint - 500000) > 20000) {
            console.log(`📡 [CLEANUP] Inverted spread detected. Refreshing...`);
            needsRefresh = true;
          }
        }

        if (!needsRefresh) {
          for (const order of mOrders) {
            const isYes = String(order.position) === '1' || String(order.side).toLowerCase() === 'yes';
            const sideMid = isYes ? rewardsMidpoint : (1000000 - rewardsMidpoint);
            const price = Number(order.price);

            // The Fundamental Mission: Stay in Reward Zone
            // Simple Fixed Buffer Math: Trigger if we drift within 0.2c of the boundary
            const driftDist = Math.abs(price - sideMid);
            const isEarning = driftDist <= rewardsSpread;
            const needsRefreshThreshold = Math.max(rewardsSpread - REWARD_MONITOR_BUFFER, 0);
            const isDrifting = driftDist > needsRefreshThreshold;

            const statusStr = !isEarning ? 'FAIL' : (isDrifting ? 'DRIFTING' : 'OK');
            const distCents = (driftDist / 10000).toFixed(2);
            const sprCents = (rewardsSpread / 10000).toFixed(1);

            console.log(`  └─ ${isYes ? 'YES' : 'NO'}: ${(price / 10000).toFixed(1)}¢ | Dist: ${distCents}¢ from ${(sideMid / 10000).toFixed(1)}¢ | [${statusStr}]`);

            if (!isEarning || isDrifting) {
              const reason = !isEarning ? 'OUTSIDE ZONE' : 'DRIFTING (near boundary)';
              console.log(`⚠️ [MISSION FAIL] ${isYes ? 'YES' : 'NO'} order is ${reason}.`);
              needsRefresh = true;
              break;
            }
          }
          if (!needsRefresh) {
            console.log(`✅ [MISSION SUCCESS] All orders are within the reward zone.`);
          }
        }

        if (needsRefresh) {
          await startCycle('Drift/Inversion cleanup');
        }
      } else {
        await startCycle('No orders found');
      }
    } catch (e: any) {
      console.error(`⚠️ [MONITOR ERROR] ${e.message}`);
    }
  };

  // Pulse immediately then every 5s
  monitor();
  setInterval(monitor, 5000);

  // --- Initial Entry ---
  await startCycle('Initial Boot');
}


async function calculateTargetSize(algod: algosdk.Algodv2, address: string, minSize: number) {
  const accountInfo = await algod.accountInformation(address).do();
  const usdcAsset = accountInfo.assets?.find((a: any) => Number(a.assetId ?? a['asset-id']) === 31566704);
  const walletUsdc = Number(usdcAsset ? usdcAsset.amount : 0);

  if (useMax) {
    const reserve = walletUsdc * USDC_BUFFER_PERCENT;
    const target = Math.floor(walletUsdc - reserve);
    console.log(`[BUDGET] --max mode: Reserving $${(reserve / 1e6).toFixed(2)} (${(USDC_BUFFER_PERCENT * 100).toFixed(0)}%). Target: $${(target / 1e6).toFixed(2)}`);
    return target;
  } else if (injectAmount) {
    // Current Wallet + Inject
    return Math.floor((walletUsdc + (injectAmount * 1e6)) * (1 - USDC_BUFFER_PERCENT));
  } else {
    if (walletUsdc < minSize) {
      console.warn(`⚠️ [WARNING] Balance ($${(walletUsdc / 1e6).toFixed(2)}) below Reward Minimum ($${(minSize / 1e6).toFixed(2)}). Using full balance.`);
      return Math.floor(walletUsdc * (1 - USDC_BUFFER_PERCENT));
    }
    return minSize;
  }
}

async function getUsdcBalance(algod: algosdk.Algodv2, address: string): Promise<number> {
  const accountInfo = await algod.accountInformation(address).do();
  const usdcAsset = accountInfo.assets?.find((a: any) => Number(a.assetId ?? a['asset-id']) === 31566704);
  return Number(usdcAsset ? usdcAsset.amount : 0);
}

async function startCycle(reason: string = 'unknown') {
  if (isCycleRunning || isProcessingFill || isShuttingDown) return;
  isCycleRunning = true;

  try {
    // Snapshot the reward zone at the VERY START of the cycle
    const snapshotMid = rewardsMidpoint;
    const snapshotSpr = rewardsSpread;
    let snapshotTarget = targetShares;

    console.log(`🔄 [CYCLE START] reason: ${reason} | Mid: ${(snapshotMid / 10000).toFixed(1)}¢...`);

    // Phase 2: Placement
    currentPhase = 'SPLIT';
    console.log(`[SYSTEM] Step 1: Force clearing all existing orders...`);
    await cancelAllOrders(globalClient, globalAddress, activeMarketId, 3);

    // 🛡️ API SYNC WAIT: Essential to prevent "Ghost Orders" from being detected in the next tick
    console.log(`[SYSTEM] Step 2: Waiting for indexer sync (5s)...`);
    await new Promise(r => setTimeout(r, 5000));

    // 🛡️ DOUBLE CHECK: Verify orders are REALLY gone
    const verifyOrders = await globalClient.getWalletOrdersFromApi(globalAddress);
    const remaining = verifyOrders.filter(o => Number(o.marketAppId) === activeMarketId);
    if (remaining.length > 0) {
      console.warn(`⚠️ [WARNING] ${remaining.length} orders still visible on API. Attempting one last purge...`);
      await cancelAllOrders(globalClient, globalAddress, activeMarketId, 1);
      await new Promise(r => setTimeout(r, 2000));
    }

    // 🛡️ RECYCLE: Merge existing balanced position to free up USDC
    const prePos = await globalClient.getPositions(globalAddress);
    const pmPos = prePos.find(p => p.marketAppId === activeMarketId);
    const mergeable = Math.min(pmPos?.yesBalance || 0, pmPos?.noBalance || 0);
    if (mergeable > DUST_THRESHOLD) {
      console.log(`[RECYCLE] Step 3: Merging ${(mergeable / 1e6).toFixed(1)} matched pairs...`);
      await globalClient.mergeShares({ marketAppId: activeMarketId, amount: mergeable }).catch(() => { });
      await new Promise(r => setTimeout(r, 2000));
    }

    // 🛡️ ROBUST BUDGET CHECK
    const currentUsdc = await getUsdcBalance(globalAlgod, globalAddress);
    if (snapshotTarget > currentUsdc) {
      console.warn(`⚠️ [BUDGET] Snapshot target ($${(snapshotTarget / 1e6).toFixed(2)}) > Available ($${(currentUsdc / 1e6).toFixed(2)}). Clamping...`);
      snapshotTarget = Math.floor(currentUsdc * (1 - USDC_BUFFER_PERCENT));
    }

    if (snapshotTarget > DUST_THRESHOLD) {
      // 🛡️ HARD BALANCE GUARD: Physically impossible to underflow
      const finalSplitAmount = Math.min(snapshotTarget, Math.floor(currentUsdc * (1 - USDC_BUFFER_PERCENT)));

      if (finalSplitAmount > DUST_THRESHOLD) {
        console.log(`[SYSTEM] Step 4: Splitting $${(finalSplitAmount / 1e6).toFixed(2)} USDC...`);
        try {
          await globalClient.splitShares({ marketAppId: activeMarketId, amount: finalSplitAmount });
          // Wait for shares to appear in inventory
          await new Promise(r => setTimeout(r, 4000));
        } catch (e: any) {
          console.warn(`⚠️ [SPLIT FAILED] ${e.message}. Proceeding with existing inventory.`);
        }
      } else {
        console.warn(`⚠️ [BUDGET] Insufficient USDC to split ($${(currentUsdc / 1e6).toFixed(2)} available).`);
      }
    }

    currentPhase = 'MAKER';

    // 🧠 PRE-FLIGHT VERIFICATION: Check if we actually have the shares before placing Asks
    const finalCheck = await globalClient.getPositions(globalAddress);
    const fPos = finalCheck.find(p => p.marketAppId === activeMarketId);
    const finalYes = fPos?.yesBalance || 0;
    const finalNo = fPos?.noBalance || 0;

    if (finalYes < DUST_THRESHOLD && finalNo < DUST_THRESHOLD) {
      console.warn(`⚠️ [PRE-FLIGHT] No shares found to sell. Aborting order placement.`);
      return;
    }

    // Calculate prices based on strategy (Center for Crypto, Edge for others)
    const targetOffset = isCryptoMarket ? 5000 : Math.max(snapshotSpr - REWARD_SAFETY_BUFFER, 0);
    const yesPriceRaw = snapshotMid + targetOffset;
    const noPriceRaw = (1000000 - snapshotMid) + targetOffset;

    // 🛡️ PRICE CLAMPING: Ensure we never exceed $1.00 (and stay within $0.001 to $0.999)
    const yesPrice = Math.min(Math.max(yesPriceRaw, 1000), 999000);
    const noPrice = Math.min(Math.max(noPriceRaw, 1000), 999000);

    const strategyName = isCryptoMarket ? 'CENTER FARMING' : 'EDGE FARMING';
    const buffDist = (targetOffset / 10000).toFixed(2);
    console.log(`🌱 [MAKER] Step 5: Placing ASKS | Strategy: ${strategyName} (${buffDist}¢ buffer)`);
    console.log(`   └─ YES: $${(yesPrice / 1e6).toFixed(3)} | NO: $${(noPrice / 1e6).toFixed(3)}`);

    // Only place the side we actually have shares for
    const tasks = [];
    if (finalYes > DUST_THRESHOLD) {
      tasks.push(globalClient.createLimitOrder({ marketAppId: activeMarketId, position: 1, price: yesPrice, quantity: finalYes, isBuying: false }));
    }
    if (finalNo > DUST_THRESHOLD) {
      tasks.push(globalClient.createLimitOrder({ marketAppId: activeMarketId, position: 0, price: noPrice, quantity: finalNo, isBuying: false }));
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
      console.log(`✅ [SYSTEM] Cycle Complete. New orders placed.`);
      // IMPORTANT: Cooldown after placement to allow Indexer to catch up
      await new Promise(r => setTimeout(r, 5000));
    }

  } catch (e: any) {
    console.error(`❌ [CYCLE ERROR] ${e.message}`);
    currentPhase = 'ERROR';
  } finally {
    isCycleRunning = false;
  }
}

async function rebalanceAndRecycle(quantityFilled: number, reason: string = 'unknown') {
  if (isShuttingDown) return;
  isProcessingFill = true;

  try {
    currentPhase = 'HEDGE';
    console.log(`🚨 [REBALANCE] trigger: ${reason} | quantity: ${(quantityFilled / 1e6).toFixed(1)}`);

    // 1. KILLSWITCH (if triggered by fill, we must cancel immediately)
    await cancelAllOrders(globalClient, globalAddress, activeMarketId);

    // 2. DELTA CALCULATION
    const currentPos = await globalClient.getPositions(globalAddress);
    const mPos = currentPos.find(p => p.marketAppId === activeMarketId);
    const yesInv = mPos?.yesBalance || 0;
    const noInv = mPos?.noBalance || 0;
    const delta = Math.abs(yesInv - noInv);

    if (delta > DUST_THRESHOLD) {
      // 3. AGGRESSIVE TAKER HEDGE
      const marketData = await globalClient.getMarket(activeMarketId.toString());
      const midpoint = Number(marketData?.midpoint || 500_000);
      const posToBuy = yesInv > noInv ? 0 : 1;
      // Buy at a price that ensures execution (offset by slippage later)
      const price = posToBuy === 1 ? (midpoint + 50000) : (1000000 - midpoint + 50000);

      console.log(`[HEDGE] Buying ${(delta / 1e6).toFixed(2)} ${posToBuy === 1 ? 'YES' : 'NO'} at market...`);
      await globalClient.createMarketOrder({
        marketAppId: activeMarketId,
        position: posToBuy as any,
        quantity: delta,
        price: price as any,
        isBuying: true,
        slippage: Math.round(1000000 * MAX_SLIPPAGE_TOLERANCE)
      });
    }

    // 4. SETTLE
    currentPhase = 'RECYCLE';
    const finalPos = await globalClient.getPositions(globalAddress);
    const fPos = finalPos.find(p => p.marketAppId === activeMarketId);
    const mergeQty = Math.min(fPos?.yesBalance || 0, fPos?.noBalance || 0);

    if (mergeQty > DUST_THRESHOLD) {
      console.log(`[RECYCLE] Merging ${(mergeQty / 1e6).toFixed(1)} pairs...`);
      await globalClient.mergeShares({ marketAppId: activeMarketId, amount: mergeQty });
    }

    console.log(`[SYSTEM] Rebalance complete. Resuming...`);
    isProcessingFill = false;

    // Refresh target size in case injection or max deployment changed
    const rewardMarkets = await globalClient.getRewardMarkets();
    const market = rewardMarkets.find(m => m.marketAppId === activeMarketId);
    targetShares = await calculateTargetSize(globalAlgod, globalAddress, market?.rewardsMinContracts || 100_000_000);

    await startCycle('Post-rebalance restart');

  } catch (e: any) {
    console.error(`❌ [REBALANCE ERROR] ${e.message}`);
    isProcessingFill = false;
  }
}

async function cancelAllOrders(client: AlphaClient, address: string, marketId: number, retries: number = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      // 🛡️ API SYNC DELAY: Give the indexer a moment to catch recent placements
      if (i > 0) await new Promise(r => setTimeout(r, 3000));

      const orders = await client.getWalletOrdersFromApi(address);
      const mOrders = orders.filter(o => Number(o.marketAppId) === marketId);

      if (mOrders.length > 0) {
        console.log(`[SYSTEM] Cancelling ${mOrders.length} orders (Attempt ${i + 1})...`);
        for (const o of mOrders) {
          try {
            await client.cancelOrder({
              marketAppId: marketId,
              escrowAppId: o.escrowAppId,
              orderOwner: address
            });
            console.log(`✅ [CANCEL] Escrow ${o.escrowAppId.toString().slice(-6)} cleared.`);
          } catch (err: any) {
            if (err.message.includes('assert failed') || err.message.includes('not found')) {
              console.log(`ℹ️ [CANCEL] Escrow ${o.escrowAppId.toString().slice(-6)} already gone or filled.`);
            } else {
              console.log(`⚠️ [CANCEL] Failed for escrow ${o.escrowAppId.toString().slice(-6)}: ${err.message}`);
            }
          }
        }

        // If this was the last retry, and we still have orders, warn the user
        if (i === retries) {
          const finalCheck = await client.getWalletOrdersFromApi(address);
          const stillThere = finalCheck.filter(o => Number(o.marketAppId) === marketId);
          if (stillThere.length > 0) {
            console.warn(`\n⚠️ [CRITICAL] ${stillThere.length} orders REFUSE to clear. Check Alpha Arcade dashboard!`);
          }
        }
      } else {
        if (i > 0) console.log(`[SYSTEM] All orders confirmed cleared.`);
        break;
      }
    } catch (e: any) {
      console.log(`⚠️ [CANCEL] API error: ${e.message}`);
    }
  }
}

async function cleanup(client: AlphaClient, address: string, shouldClean: boolean, shouldExit: boolean = true) {
  if (isShuttingDown && shouldExit) return;
  if (shouldExit) isShuttingDown = true;

  console.log(`\n🛑 [${shouldExit ? 'SHUTDOWN' : 'RESET'}] Cleaning up...`);

  if (shouldClean) {
    // 🛡️ FINALITY WAIT: Give any "just-placed" orders time to hit the indexer
    await new Promise(r => setTimeout(r, 3000));

    await cancelAllOrders(client, address, activeMarketId, 3);

    const pos = await client.getPositions(address);
    const mPos = pos.find(p => p.marketAppId === activeMarketId);
    if (mPos) {
      const matched = Math.min(mPos.yesBalance, mPos.noBalance);
      if (matched > DUST_THRESHOLD) {
        console.log(`[RECOVERY] Final Merge: ${(matched / 1e6).toFixed(1)} pairs...`);
        await client.mergeShares({ marketAppId: activeMarketId, amount: matched }).catch(() => { });
      }
    }
  }

  if (shouldExit) {
    process.exit(0);
  } else {
    isShuttingDown = false;
  }
}

process.on('SIGINT', () => {
  if (globalClient && globalAddress) {
    cleanup(globalClient, globalAddress, true);
  } else {
    process.exit(0);
  }
});

main().catch(console.error);
