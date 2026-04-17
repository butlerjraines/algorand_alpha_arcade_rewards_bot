import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient } from '@alpha-arcade/sdk';

dotenv.config();

/**
 * ALPHA YIELD BOT - AGGRESSIVE HARVESTER WITH FLEET TELEMETRY
 */

// --- CLI Argument Parsing ---
const marketArgIdx = process.argv.indexOf('--market');
const cliMarketId = marketArgIdx !== -1 ? parseInt(process.argv[marketArgIdx + 1]) : null;
const isShutdownMode = process.argv.includes('--shutdown');
const targetArgIdx = process.argv.indexOf('--target');
const cliTargetShares = targetArgIdx !== -1 ? parseFloat(process.argv[targetArgIdx + 1]) : null;
const useMax = process.argv.includes('--max');
const nameArgIdx = process.argv.indexOf('--name');
const cliBotName = nameArgIdx !== -1 ? process.argv[nameArgIdx + 1] : null;
const bufferArgIdx = process.argv.indexOf('--buffer');
const cliBufferCents = bufferArgIdx !== -1 
  ? parseFloat(process.argv[bufferArgIdx + 1]) 
  : (process.env.SAFETY_BUFFER_CENTS ? parseFloat(process.env.SAFETY_BUFFER_CENTS) : 1.5);

const botName = cliBotName || 'Alpha-Yield';
let botId = ''; // Finalized in main()

async function sendHeartbeat(botId: string, marketId: number, statusParam: string | any = 'online', activityParam: string = 'Ticking...') {
  try {
    let payload: any = { botId, marketId, status: 'online', name: botId, activity: 'Ticking...' };
    
    if (typeof statusParam === 'object') {
       payload = { ...payload, ...statusParam };
    } else {
       payload.status = statusParam;
       payload.activity = activityParam;
    }

    const resp = await fetch('http://localhost:3001/api/bot/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (resp.ok) return await resp.json();
  } catch (e) { }
  return null;
}

async function main() {
  if (!process.env.MNEMONIC || !process.env.ALPHA_API_KEY) {
    console.error('❌ Missing MNEMONIC or ALPHA_API_KEY in .env');
    process.exit(1);
  }

  const account = algosdk.mnemonicToSecretKey(process.env.MNEMONIC);
  const algodClient = new algosdk.Algodv2('', process.env.ALGOD_SERVER || 'https://mainnet-api.algonode.cloud', '443');
  const indexerClient = new algosdk.Indexer('', process.env.INDEXER_SERVER || 'https://mainnet-idx.algonode.cloud', '443');

  const alphaClient = new AlphaClient({
    algodClient,
    indexerClient,
    signer: algosdk.makeBasicAccountTransactionSigner(account),
    activeAddress: account.addr.toString(),
    apiKey: process.env.ALPHA_API_KEY,
    matcherAppId: 3078581851,
    usdcAssetId: 31566704,
  });

  const marketId = cliMarketId || parseInt(process.env.TARGET_MARKET_ID || '0');
  let targetShares = cliTargetShares || (process.env.ORDER_SIZE_USDC ? parseFloat(process.env.ORDER_SIZE_USDC) : 0);
  botId = process.env.BOT_ID ? `${process.env.BOT_ID}-${marketId}` : `${botName}-${marketId}`;
  
  await sendHeartbeat(botId, marketId, 'online', 'Bot Initializing...');
  const safetyBuffer = Math.round(cliBufferCents * 10000);
  const tickInterval = parseInt(process.env.TICK_INTERVAL || '30') * 1000;
  const liquidationWindow = parseInt(process.env.LIQUIDATION_WINDOW_TICKS || '2');
  const inventoryTicks = { YES: 0, NO: 0 };
  const entryMidpoints = { YES: 0, NO: 0 };
  const zeroInvTicks = { YES: 0, NO: 0 }; // Stability latch for indexer lag
  let lastMidpoint = 0;
  let cooldownTicks = 0;

  console.log(`\n🚀 [${botId}] active for Market ${marketId}`);

  let isShuttingDown = false;
  const cleanup = async (shouldClean: boolean) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    if (shouldClean) {
      console.log(`\n[SHUTDOWN] Clearing all orders for Market ${marketId}...`);
      try {
        const allOrders = await alphaClient.getWalletOrdersFromApi(account.addr.toString());
        const toCancel = allOrders.filter(o => Number(o.marketAppId) === Number(marketId));
        for (const order of toCancel) {
          await alphaClient.cancelOrder({ marketAppId: order.marketAppId, escrowAppId: order.escrowAppId, orderOwner: account.addr.toString() }).catch(() => {});
        }
      } catch (err) { }
    }
    await sendHeartbeat(botId, marketId, 'offline', shouldClean ? 'Shut down (Cleaned)' : 'Shut down (Saved)');
    console.log(`[SHUTDOWN] Done. Goodbye!`);
    process.exit(0);
  };

  process.on('SIGINT', () => cleanup(false));

  async function runLoop() {
    if (isShuttingDown) return;
    try {
      // 1. Fetch State
      const [rewardMarkets, accountInfo] = await Promise.all([
        alphaClient.getRewardMarkets(),
        algodClient.accountInformation(account.addr.toString()).do()
      ]);
      const market = rewardMarkets.find((m: any) => m.marketAppId === marketId);
      const usdcAsset = accountInfo.assets?.find((a: any) => Number(a.assetId ?? a['asset-id']) === 31566704);
      const walletUsdc = Number(usdcAsset ? usdcAsset.amount : 0) / 1e6;

      // Log Mode if --max is active
      if (useMax) {
        console.log(`📈 [MODE] Max Deployment Pattern Active (Targeting 90% Liquidity)`);
      }

      // 2. Calculate Effective Target (higher of Injection, CLI, or Protocol Min)
      const minRequiredShares = Number(market?.rewardsMinContracts || 100_000_000) / 1e6;
      let effectiveTarget = targetShares;
      if (useMax) {
        effectiveTarget = (walletUsdc * 0.9);
      } else if (!cliTargetShares && effectiveTarget < minRequiredShares) {
        effectiveTarget = minRequiredShares;
      }

      // 3. Telemetry and Commands
      const stats = await getTickStats(alphaClient, algodClient, account.addr.toString(), marketId, effectiveTarget, rewardMarkets);
      const signal: any = await sendHeartbeat(botId, marketId, stats);
      
      if (signal && signal.command) {
        if (signal.command === 'STOP_CLEAN' || signal.command === 'STOP') { await cleanup(true); return; }
        if (signal.command === 'STOP_KEEP') { await cleanup(false); return; }
        if (signal.command === 'add-budget') {
          const amount = Number(signal.amountUsd);
          if (!isNaN(amount) && amount > 0) {
            targetShares += amount;
            console.log(`\n💰 [INJECTION] Added $${amount} to budget. New target: ${targetShares}`);
          }
        }
      }
      
      console.log(`[${new Date().toLocaleTimeString()}] Ticking for ${botId}...`);
      const tickResult = await tick(alphaClient, algodClient, account.addr.toString(), marketId, effectiveTarget, safetyBuffer, inventoryTicks, zeroInvTicks, liquidationWindow, entryMidpoints, lastMidpoint, cooldownTicks, rewardMarkets);
      if (tickResult) {
        lastMidpoint = tickResult.midpoint;
        cooldownTicks = tickResult.cooldownTicks;
      }
    } catch (e: any) {
      console.error('❌ Tick Error:', e.message || e);
    }
    setTimeout(runLoop, tickInterval);
  }

  runLoop();
}

async function tick(
  client: AlphaClient, 
  algodClient: algosdk.Algodv2, 
  address: string, 
  marketId: number, 
  targetShares: number, 
  buffer: number,
  inventoryTicks: { YES: number, NO: number },
  zeroInvTicks: { YES: number, NO: number },
  liquidationWindow: number,
  entryMidpoints: { YES: number, NO: number },
  lastMidpoint: number,
  cooldownTicks: number,
  rewardMarkets: any[]
) {
  if (marketId === 0) return { midpoint: lastMidpoint, cooldownTicks };

  const [positions, accountInfo] = await Promise.all([
    client.getPositions(address),
    algodClient.accountInformation(address).do()
  ]);

  const market = rewardMarkets.find((m: any) => m.marketAppId === marketId);
  if (!market) return;

  const usdcAssetId = 31566704;
  const usdcAsset = accountInfo.assets?.find((a: any) => Number(a.assetId ?? a['asset-id']) === usdcAssetId);
  const walletUsdc = Number(usdcAsset ? usdcAsset.amount : 0) / 1e6;

  const midpoint = Number(market.midpoint || 500_000);
  const maxSpread = Number(market.rewardsMaxSpread || 100_000);

  // Volatility Pause: If midpoint shifts > 3% (30k) in one tick
  let currentCooldown = cooldownTicks;
  if (lastMidpoint > 0 && Math.abs(midpoint - lastMidpoint) > 30000) {
    console.log(`⚠️ [VOLATILITY] Market move > 3%. Entering 2-tick cooldown to avoid toxic flow.`);
    currentCooldown = 2;
  }
  if (currentCooldown > 0) {
    console.log(`⏳ [COOLDOWN] Pausing Bids... (${currentCooldown} ticks remaining)`);
    currentCooldown--;
  }

  // Dynamic Spread Protection: Ensure user buffer is within the platform max reward spread
  const effectiveBuffer = Math.min(buffer, Math.round(maxSpread * 0.9)); 
  if (effectiveBuffer < buffer) {
    console.log(`📡 [SENSITIVITY] Reward Zone narrowed to ±${(maxSpread/10000).toFixed(1)}¢. Clamping buffer to ${(effectiveBuffer/10000).toFixed(1)}¢.`);
  }
  const openOrders = await client.getWalletOrdersFromApi(address);
  const marketOrders = openOrders.filter(o => Number(o.marketAppId) === Number(marketId));
  const mPos = positions.find(p => p.marketAppId === marketId);
  const yesInv = (mPos?.yesBalance || 0);
  const noInv = (mPos?.noBalance || 0);

  const marketName = market.title || market.name || market.marketName || `Market ${marketId}`;
  console.log(`[STATUS] ${marketName} (${marketId}) | Target: $${targetShares.toFixed(0)} | Mid: ${(midpoint/1e6).toFixed(3)} | Budget: $${walletUsdc.toFixed(2)} | Inv: Y:${(yesInv/1e6).toFixed(1)}/N:${(noInv/1e6).toFixed(1)}`);

  // --- 1. Budget Management ---
  const currentBidOrders = marketOrders.filter(o => o.side === 1);
  const existingBidUsdc = currentBidOrders.reduce((sum, o) => sum + (o.quantity * o.price) / 1e12, 0);
  const totalSpendableUsdc = walletUsdc + existingBidUsdc;
  const budgetTracker = { remaining: totalSpendableUsdc };

  // --- 2. Dynamic Target Logic ---
  const targetQty = Math.round(targetShares * 1e6);

  async function maintainBid(side: 'YES' | 'NO', price: number, currentInv: number) {
    const posId = side === 'YES' ? 1 : 0;
    const existing = marketOrders.find(o => o.position === posId && o.side === 1);
    const priceUsdc = price / 1e6;
    const idealNeeded = Math.max(0, targetQty - currentInv);
    
    if (idealNeeded < 100000) {
      console.log(`[SKIP] ${side} Bid: Target reached (Existing: ${(currentInv/1e6).toFixed(1)})`);
      // Entry midpoint is managed by maintainAsk — only reset when inventory is truly zero
      if (existing) await client.cancelOrder({ marketAppId: marketId, escrowAppId: existing.escrowAppId, orderOwner: address }).catch(() => {});
      return;
    }

    if (currentCooldown > 0) return; // Skip Bidding during volatility cooldown

    // Inventory Skewing: If already heavy, lower the bid to avoid catching the falling knife
    let effectivePrice = price;
    if (currentInv > (targetQty * 0.5)) {
        const skew = Math.round(maxSpread * 0.2); // Low-ball by 20% of max spread
        effectivePrice -= skew;
        console.log(`🛡️ [SKEW] ${side} Inventory at ${(currentInv/targetQty*100).toFixed(0)}%. Lowering bid price by ${(skew/10000).toFixed(1)}¢.`);
    }

    const MARGIN_FACTOR = 1.04; // Reserved for matcher commission/escrow
    const costOfIdeal = ((idealNeeded * priceUsdc) / 1e6) * MARGIN_FACTOR;
    let needed = idealNeeded;
    let isPartial = false;
    if (costOfIdeal > budgetTracker.remaining) {
        needed = Math.floor((budgetTracker.remaining * 1e12) / (effectivePrice * MARGIN_FACTOR));
        isPartial = true;
    }

    if (needed < 100000) {
      if (existing) await client.cancelOrder({ marketAppId: marketId, escrowAppId: existing.escrowAppId, orderOwner: address }).catch(() => {});
      return;
    }
    
    if (existing && Math.abs(existing.price - effectivePrice) <= 2000) {
      const qtyDiff = Math.abs(existing.quantity - needed);
      if (qtyDiff < (needed * 0.05)) { 
        // Official Quadratic Score: ((maxSpread - distance) / maxSpread)^2
        const sideMidpoint = side === 'YES' ? midpoint : (1000000 - midpoint);
        const distance = Math.abs(price - sideMidpoint);
        const score = maxSpread > 0 ? Math.pow(Math.max(0, (maxSpread - distance) / maxSpread), 2) : 0;
        console.log(`✅ [${side}] Yield order active at ${(price/1e6).toFixed(3)} | 📈 Score: ${score.toFixed(2)}`);
        budgetTracker.remaining -= (existing.quantity * existing.price) / 1e12; 
        return; 
      }
    }
    
    if (existing) {
      console.log(`[PURGE] Replacing stale BID for ${side} at ${(existing.price/1e6).toFixed(3)}...`);
      await client.cancelOrder({ marketAppId: marketId, escrowAppId: existing.escrowAppId, orderOwner: address }).catch(() => {});
    }
    
    console.log(`[REWARDS] Placing BUY ${side} at ${(effectivePrice/1e6).toFixed(3)} (Qty: ${(needed/1e6).toFixed(1)})${isPartial ? ' (PARTIAL)' : ''}`);
    budgetTracker.remaining -= ((needed * effectivePrice) / 1e12) * MARGIN_FACTOR;
    await client.createLimitOrder({ marketAppId: marketId, position: posId, price: Math.round(effectivePrice), quantity: Math.round(needed), isBuying: true }).catch(e => console.error(`❌ BID Error (${side}): ${e.message}`));
  }

  async function maintainAsk(side: 'YES' | 'NO', currentInv: number, unmatchedInv: number) {
    const posId = side === 'YES' ? 1 : 0;
    const existing = marketOrders.find(o => o.position === posId && o.side === 0);
    
    if (currentInv < 100000) {
      // Indexer Latch: Only reset if inventory is 0 for 2 consecutive ticks
      zeroInvTicks[side]++;
      if (zeroInvTicks[side] < 2) {
        console.log(`[STABILITY] ${side} reported as zero. Waiting for confirmation...`);
        return;
      }

      if (existing) {
        console.log(`[PURGE] Clearing residual ASK for ${side}`);
        await client.cancelOrder({ marketAppId: marketId, escrowAppId: existing.escrowAppId, orderOwner: address }).catch(() => {});
      }
      inventoryTicks[side] = 0;
      entryMidpoints[side] = 0;
      return;
    }

    zeroInvTicks[side] = 0; // Reset latch if we have inventory
    inventoryTicks[side]++;
    if (inventoryTicks[side] === 1) {
        entryMidpoints[side] = midpoint;
    }

    const sideMidpoint = side === 'YES' ? midpoint : (1000000 - midpoint);
    const entrySideMidpoint = side === 'YES' ? entryMidpoints[side] : (1000000 - entryMidpoints[side]);
    
    // 2% Circuit Breaker (Stop Loss) — only fires on unmatched inventory
    // Matched pairs (YES+NO) are price-neutral, so crashing on one side is offset by the other
    if (unmatchedInv > 100000) {
      const loss = entrySideMidpoint - sideMidpoint;
      if (loss > 20000) {
          console.log(`🚨 [CRASH] ${side} price moved down ${(loss/10000).toFixed(1)}¢ from entry. Triggering Emergency Hedge...`);
          if (existing) await client.cancelOrder({ marketAppId: marketId, escrowAppId: existing.escrowAppId, orderOwner: address }).catch(() => {});
          await client.createMarketOrder({
              marketAppId: marketId,
              position: posId,
              quantity: currentInv,
              isBuying: false,
              price: sideMidpoint,
              slippage: 100000
          }).catch(e => console.error(`❌ HEDGE Error (${side}): ${e.message}`));
          return;
      }
    }

    // B: Check if this side is winning or losing vs entry
    const isWinning = sideMidpoint >= entrySideMidpoint;

    const ticks = inventoryTicks[side];
    let targetAskPrice = sideMidpoint + effectiveBuffer; // Phase 1: Profit Window Target
    let modeText = `Profit Window ${ticks}/${liquidationWindow}`;
    
    // A+B+C: Graduated pressure, only on LOSING + UNMATCHED positions
    if (ticks > liquidationWindow) {
      if (!isWinning && unmatchedInv > 100000) {
        // Phase 3: Aggressive Exit (Losing side with real exposure)
        const overTicks = ticks - liquidationWindow;
        if (overTicks <= 5) {
          targetAskPrice = sideMidpoint - 1000; // -0.1¢
          modeText = `Gentle Exit (${overTicks}t over)`;
        } else if (overTicks <= 10) {
          targetAskPrice = sideMidpoint - 3000; // -0.3¢
          modeText = `Firm Exit (${overTicks}t over)`;
        } else {
          targetAskPrice = sideMidpoint - 5000; // -0.5¢
          modeText = `Forced Exit (${overTicks}t over)`;
        }
      } else {
        // Phase 2: Breakeven Exit (Winning side OR fully matched)
        targetAskPrice = sideMidpoint;
        modeText = isWinning ? `Profit Hold (${ticks}t)` : `Matched Hold (${ticks}t)`;
      }
    }

    if (existing && Math.abs(existing.price - targetAskPrice) <= 2000) {
      console.log(`✅ [${side}] Sale order active at ${(targetAskPrice/1e6).toFixed(3)} (${modeText})`);
      return;
    }
    if (existing) {
        console.log(`[PURGE] Replacing stale ASK for ${side} at ${(existing.price/1e6).toFixed(3)}...`);
        await client.cancelOrder({ marketAppId: marketId, escrowAppId: existing.escrowAppId, orderOwner: address }).catch(() => {});
    }
    console.log(`[HEDGE] Placing SELL ${side} at ${(targetAskPrice/1e6).toFixed(3)} (${modeText})`);
    await client.createLimitOrder({ marketAppId: marketId, position: posId, price: Math.round(targetAskPrice), quantity: Math.round(currentInv), isBuying: false }).catch(e => console.error(`❌ ASK Error (${side}): ${e.message}`));
  }

  // C: Calculate matched inventory (YES+NO pairs are price-neutral)
  const matchedInv = Math.min(yesInv, noInv);
  if (matchedInv > 100000) {
    console.log(`🔄 [MATCH] ${(matchedInv/1e6).toFixed(1)} matched YES+NO sets — hedged against price risk.`);
  }

  await maintainBid('YES', midpoint - effectiveBuffer, yesInv);
  await maintainAsk('YES', yesInv, yesInv - matchedInv);
  await maintainBid('NO', (1e6-midpoint) - effectiveBuffer, noInv);
  await maintainAsk('NO', noInv, noInv - matchedInv);

  return { midpoint, cooldownTicks: currentCooldown };
}

async function getTickStats(client: AlphaClient, algodClient: algosdk.Algodv2, address: string, marketId: number, targetShares: number, rewardMarkets: any[]) {
    try {
        const [positions, accountInfo] = await Promise.all([
          client.getPositions(address),
          algodClient.accountInformation(address).do()
        ]);
        const market = rewardMarkets.find((m: any) => m.marketAppId === marketId);
        const mPos = positions.find(p => p.marketAppId === marketId);
        const usdcAsset = accountInfo.assets?.find((a: any) => Number(a.assetId ?? a['asset-id']) === 31566704);
        
        return {
            size: targetShares,
            yesMySize: (mPos?.yesBalance || 0) / 1e6,
            noMySize: (mPos?.noBalance || 0) / 1e6,
            walletUsdc: Number(usdcAsset ? usdcAsset.amount : 0) / 1e6,
            status: 'online',
            activity: 'Ticking...'
        };
    } catch (e) { return {}; }
}

main().catch(console.error);
