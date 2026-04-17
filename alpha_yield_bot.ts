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

      // 2. Calculate Effective Target (higher of Injection, CLI, or Protocol Min)
      const minRequiredShares = Number(market?.rewardsMinContracts || 100_000_000) / 1e6;
      let effectiveTarget = targetShares;
      if (useMax) {
        effectiveTarget = (walletUsdc * 0.9);
      } else if (!cliTargetShares && effectiveTarget < minRequiredShares) {
        effectiveTarget = minRequiredShares;
      }

      // 3. Telemetry and Commands
      const stats = await getTickStats(alphaClient, algodClient, account.addr.toString(), marketId, effectiveTarget);
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
      await tick(alphaClient, algodClient, account.addr.toString(), marketId, effectiveTarget, safetyBuffer, inventoryTicks, liquidationWindow);
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
  liquidationWindow: number
) {
  if (marketId === 0) return;

  const [rewardMarkets, positions, accountInfo] = await Promise.all([
    client.getRewardMarkets(),
    client.getPositions(address),
    algodClient.accountInformation(address).do()
  ]);

  const market = rewardMarkets.find((m: any) => m.marketAppId === marketId);
  if (!market) return;

  const usdcAssetId = 31566704;
  const usdcAsset = accountInfo.assets?.find((a: any) => Number(a.assetId ?? a['asset-id']) === usdcAssetId);
  const walletUsdc = Number(usdcAsset ? usdcAsset.amount : 0) / 1e6;

  const midpoint = Number(market.midpoint || 500_000);
  const openOrders = await client.getWalletOrdersFromApi(address);
  const marketOrders = openOrders.filter(o => Number(o.marketAppId) === Number(marketId));
  const mPos = positions.find(p => p.marketAppId === marketId);
  const yesInv = (mPos?.yesBalance || 0);
  const noInv = (mPos?.noBalance || 0);

  const marketName = market.title || market.name || market.marketName || `Market ${marketId}`;
  console.log(`[STATUS] ${marketName} (${marketId}) | Budget: $${walletUsdc.toFixed(2)} | Inventory: YES: ${(yesInv/1e6).toFixed(1)} / NO: ${(noInv/1e6).toFixed(1)}`);

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
      if (existing) await client.cancelOrder({ marketAppId: marketId, escrowAppId: existing.escrowAppId, orderOwner: address }).catch(() => {});
      return;
    }

    const costOfIdeal = (idealNeeded * priceUsdc) / 1e6;
    let needed = idealNeeded;
    let isPartial = false;
    if (costOfIdeal > budgetTracker.remaining) {
        needed = Math.floor((budgetTracker.remaining * 1e12) / price);
        isPartial = true;
    }

    if (needed < 100000) {
      if (existing) await client.cancelOrder({ marketAppId: marketId, escrowAppId: existing.escrowAppId, orderOwner: address }).catch(() => {});
      return;
    }
    
    if (existing && Math.abs(existing.price - price) <= 2000) {
      const qtyDiff = Math.abs(existing.quantity - needed);
      if (qtyDiff < (needed * 0.05)) { budgetTracker.remaining -= (existing.quantity * existing.price) / 1e12; return; }
    }
    
    if (existing) await client.cancelOrder({ marketAppId: marketId, escrowAppId: existing.escrowAppId, orderOwner: address }).catch(() => {});
    console.log(`[BID] ${side} at ${(price/1e6).toFixed(3)} | Qty: ${(needed/1e6).toFixed(1)}${isPartial ? ' (PARTIAL)' : ''}`);
    budgetTracker.remaining -= (needed * price) / 1e12;
    await client.createLimitOrder({ marketAppId: marketId, position: posId, price: Math.round(price), quantity: Math.round(needed), isBuying: true }).catch(e => console.error(`❌ BID Error (${side}): ${e.message}`));
  }

  async function maintainAsk(side: 'YES' | 'NO', currentInv: number) {
    const posId = side === 'YES' ? 1 : 0;
    const existing = marketOrders.find(o => o.position === posId && o.side === 0);
    if (currentInv < 100000) {
      if (existing) await client.cancelOrder({ marketAppId: marketId, escrowAppId: existing.escrowAppId, orderOwner: address }).catch(() => {});
      inventoryTicks[side] = 0;
      return;
    }
    inventoryTicks[side]++;
    const ticks = inventoryTicks[side];
    const sideMidpoint = side === 'YES' ? midpoint : (1000000 - midpoint);
    let targetAskPrice = sideMidpoint;
    let modeText = `Profit Window ${ticks}/${liquidationWindow}`;
    if (ticks > liquidationWindow) {
      targetAskPrice = sideMidpoint - 20000;
      modeText = `Market Sell (Forced)`;
    }
    if (existing && Math.abs(existing.price - targetAskPrice) <= 2000) return;
    if (existing) await client.cancelOrder({ marketAppId: marketId, escrowAppId: existing.escrowAppId, orderOwner: address }).catch(() => {});
    console.log(`[ASK] ${side} at ${(targetAskPrice/1e6).toFixed(3)} (${modeText})`);
    await client.createLimitOrder({ marketAppId: marketId, position: posId, price: Math.round(targetAskPrice), quantity: Math.round(currentInv), isBuying: false }).catch(e => console.error(`❌ ASK Error (${side}): ${e.message}`));
  }

  await maintainBid('YES', midpoint - buffer, yesInv);
  await maintainAsk('YES', yesInv);
  await maintainBid('NO', (1e6-midpoint) - buffer, noInv);
  await maintainAsk('NO', noInv);
}

async function getTickStats(client: AlphaClient, algodClient: algosdk.Algodv2, address: string, marketId: number, targetShares: number) {
    try {
        const [rewardMarkets, positions, accountInfo] = await Promise.all([
          client.getRewardMarkets(),
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
