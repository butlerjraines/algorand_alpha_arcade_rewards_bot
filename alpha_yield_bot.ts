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
const USDC_BUFFER_PERCENT = parseFloat(process.env.USDC_BUFFER_PERCENT || '0.015');
const MAX_SLIPPAGE_TOLERANCE = parseFloat(process.env.MAX_SLIPPAGE_TOLERANCE || '0.02');
const DUST_THRESHOLD = parseFloat(process.env.DUST_THRESHOLD || '0.1') * 1e6;

// --- Global State ---
let botId = `Ironclad-${activeMarketId}`;
let currentPhase = 'INIT';
let targetShares = 0;
let isProcessingFill = false;
let isShuttingDown = false;
let marketEndTs = 0;
let rewardsMidpoint = 500_000;
let rewardsSpread = 100_000;
let isBtcMarket = false;
let currentBtcPrice = 0;
let tickCount = 0;

let globalClient: AlphaClient;
let globalAlgod: algosdk.Algodv2;
let globalAddress: string;

async function sendHeartbeat(payload: any) {
  tickCount++;
  const mid = (rewardsMidpoint / 10000).toFixed(1);
  const spr = (rewardsSpread / 10000).toFixed(1);
  const btcInfo = isBtcMarket && currentBtcPrice > 0 ? ` | BTC: $${currentBtcPrice.toLocaleString()}` : '';
  
  const statusMsg = isProcessingFill ? 'Processing Fill/Hedge' : 
                   isShuttingDown ? 'Shutting Down' : 
                   currentPhase === 'MAKER' ? 'Monitoring Reward Zone' : 
                   `Running ${currentPhase} Phase`;

  console.log(`⏱️ [TICK ${tickCount}] ${statusMsg}${btcInfo} | Mid: ${mid}¢ | Zone: ±${spr}¢ | Capital: $${(payload.size || 0).toFixed(2)}`);
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
  rewardsSpread = Number(market.rewardsSpreadDistance || 100_000);
  rewardsMidpoint = Number(market.midpoint || 500_000);
  marketEndTs = Number(market.endTs || 0);
  const title = market.title || activeMarketId.toString();
  isBtcMarket = /btc|bitcoin/i.test(title);
  
  // Normalize seconds to milliseconds if needed
  if (marketEndTs > 0 && marketEndTs < 10000000000) {
    marketEndTs *= 1000;
  }
  console.log(`[DISCOVERY] Market: ${market.title || activeMarketId}`);
  console.log(`[DISCOVERY] Min Size: ${(rewardsMinContracts / 1e6).toFixed(0)} | Max Spread: ${(rewardsSpread / 10000).toFixed(1)}¢`);
  if (marketEndTs > 0) {
    console.log(`[DISCOVERY] Market Ends: ${new Date(marketEndTs).toLocaleString()}`);
  }

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
  ws.subscribeWalletOrders(address, async (event: any) => {
    if (isProcessingFill || isShuttingDown) return;

    // Filter for fills on our SELL orders
    const fill = event.orders?.find((o: any) =>
      Number(o.marketAppId) === activeMarketId &&
      (o.status === 'PARTIAL' || o.status === 'FILLED') &&
      o.quantityFilled > 0 &&
      !o.isBuying
    );

    if (fill) {
      await handleFill(fill.quantityFilled);
    }
  });

  // --- Drift & Expiry Monitor & Heartbeat ---
  const monitor = async () => {
    if (isProcessingFill || isShuttingDown) return;

    // Heartbeat (always send even if not in MAKER phase)
    const hbData = await sendHeartbeat({
      activity: `Phase: ${currentPhase}`,
      size: targetShares / 1e6
    });

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
        if (currentPhase === 'MAKER') await startCycle();
      }
    }

    // Check Market Expiry (1 hour before end)
    if (marketEndTs > 0 && Date.now() > (marketEndTs - 3600000)) {
      console.log(`\n🚨 [TERMINATE] Market nearing resolution (within 1hr). Triggering graceful exit...`);
      await cleanup(alphaClient, address, true);
      return;
    }

    if (currentPhase !== 'MAKER') return;

    try {
      // Refresh Reward Metadata
      const rewardMarkets = await alphaClient.getRewardMarkets() as any[];
      const m = rewardMarkets.find((rm: any) => rm.marketAppId === activeMarketId);
      if (m) {
        const newMid = Number(m.midpoint || 500_000);
        const newSpr = Number(m.rewardsSpreadDistance || 100_000);
        if (newMid !== rewardsMidpoint || newSpr !== rewardsSpread) {
          console.log(`📡 [METADATA SHIFT] Mid: ${(newMid / 10000).toFixed(1)}¢ | Spr: ±${(newSpr / 10000).toFixed(1)}¢`);
          rewardsMidpoint = newMid;
          rewardsSpread = newSpr;
        }
      }

      const currentMarket = await alphaClient.getMarket(activeMarketId.toString());
      if (!currentMarket) return;

      const orders = await alphaClient.getWalletOrdersFromApi(address);
      const mOrders = orders.filter(o => Number(o.marketAppId) === activeMarketId);

      if (mOrders.length > 0) {
        let needsRefresh = false;
        for (const order of mOrders) {
          const sideMid = order.position === 1 ? rewardsMidpoint : (1000000 - rewardsMidpoint);
          if (Math.abs(Number(order.price) - sideMid) > rewardsSpread) {
            console.log(`📡 [DRIFT] Order out of reward zone. Refreshing...`);
            needsRefresh = true;
            break;
          }
        }

        if (needsRefresh) {
          await startCycle();
        }
      } else {
        await startCycle();
      }
    } catch (e) { }
  };

  // Pulse immediately then every 5s
  monitor();
  setInterval(monitor, 5000);

  // --- Initial Entry ---
  await startCycle();
}


async function calculateTargetSize(algod: algosdk.Algodv2, address: string, minSize: number) {
  const accountInfo = await algod.accountInformation(address).do();
  const usdcAsset = accountInfo.assets?.find((a: any) => Number(a.assetId ?? a['asset-id']) === 31566704);
  const walletUsdc = Number(usdcAsset ? usdcAsset.amount : 0);

  if (useMax) {
    return Math.floor(walletUsdc * (1 - USDC_BUFFER_PERCENT));
  } else if (injectAmount) {
    // Current Wallet + Inject
    return Math.floor((walletUsdc + (injectAmount * 1e6)) * (1 - USDC_BUFFER_PERCENT));
  } else {
    if (walletUsdc < minSize) {
      console.error(`❌ [ERROR] Insufficient USDC ($${(walletUsdc / 1e6).toFixed(2)}) for Reward Minimum ($${(minSize / 1e6).toFixed(2)})`);
      process.exit(1);
    }
    return minSize;
  }
}

async function startCycle() {
  if (isProcessingFill || isShuttingDown) return;
  
  try {
    // Phase 2: Placement
    currentPhase = 'SPLIT';
    await cancelAllOrders(globalClient, globalAddress, activeMarketId);

    // If we have existing unbalanced inventory, try to fix it before splitting more
    const positions = await globalClient.getPositions(globalAddress);
    const mPos = positions.find(p => p.marketAppId === activeMarketId);
    const yesInv = mPos?.yesBalance || 0;
    const noInv = mPos?.noBalance || 0;
    
    const delta = Math.abs(yesInv - noInv);
    if (delta > DUST_THRESHOLD) {
      console.log(`[RECOVERY] Fixing imbalance of ${(delta/1e6).toFixed(1)} before cycle start...`);
      await handleFill(0); // Trigger hedge logic without a new fill
      return;
    }

    // If we are already balanced and hold tokens, we can skip the SPLIT phase
    // and go straight to MAKER with the existing tokens.
    if (yesInv > DUST_THRESHOLD && targetShares < DUST_THRESHOLD) {
      console.log(`[SYSTEM] Existing balanced position detected (${(yesInv/1e6).toFixed(1)} pairs). Skipping Split.`);
    } else if (targetShares > DUST_THRESHOLD) {
      console.log(`[SYSTEM] Splitting $${(targetShares / 1e6).toFixed(2)} USDC...`);
      await globalClient.splitShares({ marketAppId: activeMarketId, amount: targetShares });
    } else {
      console.error(`❌ [ERROR] No available USDC and no existing position to market-make.`);
      process.exit(1);
    }

    currentPhase = 'MAKER';
    
    // Calculate prices based on REWARD metadata, not live CLOB midpoint
    // We place orders just inside the reward boundary (95% of the way to the edge)
    const yesPrice = rewardsMidpoint + Math.round(rewardsSpread * 0.95);
    const noPrice = (1000000 - rewardsMidpoint) + Math.round(rewardsSpread * 0.95);

    console.log(`🌱 [MAKER] Placing ASKS | YES: $${(yesPrice / 1e6).toFixed(3)} | NO: $${(noPrice / 1e6).toFixed(3)}`);
    await Promise.all([
      globalClient.createLimitOrder({ marketAppId: activeMarketId, position: 1, price: yesPrice, quantity: targetShares, isBuying: false }),
      globalClient.createLimitOrder({ marketAppId: activeMarketId, position: 0, price: noPrice, quantity: targetShares, isBuying: false })
    ]);

  } catch (e: any) {
    console.error(`❌ [CYCLE ERROR] ${e.message}`);
    currentPhase = 'ERROR';
  }
}

async function handleFill(quantityFilled: number) {
  if (isShuttingDown) return;
  isProcessingFill = true;

  try {
    currentPhase = 'HEDGE';
    if (quantityFilled > 0) {
      console.log(`🚨 [TRIGGER] Fill detected! quantity: ${(quantityFilled / 1e6).toFixed(1)}`);
    }

    // 1. KILLSWITCH
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
      const price = posToBuy === 1 ? midpoint : (1000000 - midpoint);

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

    console.log(`[SYSTEM] Cycle complete. Restarting...`);
    isProcessingFill = false;
    
    // Refresh target size in case injection or max deployment changed
    const market = await globalClient.getRewardMarkets().then(ms => ms.find(m => m.marketAppId === activeMarketId));
    targetShares = await calculateTargetSize(globalAlgod, globalAddress, market?.rewardsMinContracts || 100_000_000);
    
    await startCycle();

  } catch (e: any) {
    console.error(`❌ [HEDGE ERROR] ${e.message}`);
    isProcessingFill = false;
  }
}

async function cancelAllOrders(client: AlphaClient, address: string, marketId: number) {
  try {
    const orders = await client.getWalletOrdersFromApi(address);
    const mOrders = orders.filter(o => Number(o.marketAppId) === marketId);
    if (mOrders.length > 0) {
      console.log(`[SYSTEM] Cancelling ${mOrders.length} orders...`);
      await Promise.all(mOrders.map(o =>
        client.cancelOrder({
          marketAppId: marketId,
          escrowAppId: o.escrowAppId,
          orderOwner: address
        }).catch(() => { })
      ));
    }
  } catch (e) { }
}

async function cleanup(client: AlphaClient, address: string, shouldClean: boolean) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 [SHUTDOWN] Cleaning up...`);

  if (shouldClean) {
    await cancelAllOrders(client, address, activeMarketId);
    const pos = await client.getPositions(address);
    const mPos = pos.find(p => p.marketAppId === activeMarketId);
    if (mPos) {
      const matched = Math.min(mPos.yesBalance, mPos.noBalance);
      if (matched > DUST_THRESHOLD) {
        console.log(`[SHUTDOWN] Final Merge: ${(matched / 1e6).toFixed(1)} pairs...`);
        await client.mergeShares({ marketAppId: activeMarketId, amount: matched }).catch(() => { });
      }
    }
  }

  process.exit(0);
}

process.on('SIGINT', () => {
  if (globalClient && globalAddress) {
    cleanup(globalClient, globalAddress, true);
  } else {
    process.exit(0);
  }
});

main().catch(console.error);
