import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient } from '@alpha-arcade/sdk';

dotenv.config();

/**
 * ALPHA YIELD BOT
 * 
 * Automatically maintains limit orders within the reward zone
 * and hedges any filled positions using market orders.
 */

// --- Setup Clients ---
let account: algosdk.Account;
let algodClient: algosdk.Algodv2;
let indexerClient: algosdk.Indexer;
let alphaClient: AlphaClient;
let tickTimer: NodeJS.Timeout;
let isShuttingDown = false;

// --- CLI Argument Parsing ---
const isShutdownMode = process.argv.includes('--shutdown');
const marketArgIdx = process.argv.indexOf('--market');
const cliMarketId = marketArgIdx !== -1 ? parseInt(process.argv[marketArgIdx + 1]) : null;
const sizeArgIdx = process.argv.indexOf('--size');
const cliSizeShares = sizeArgIdx !== -1 ? parseFloat(process.argv[sizeArgIdx + 1]) : null;
const nameArgIdx = process.argv.indexOf('--name');
const cliBotName = nameArgIdx !== -1 ? process.argv[nameArgIdx + 1] : null;

async function sendHeartbeat(marketId: number) {
  try {
    await fetch('http://localhost:3001/api/bot/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        marketId,
        name: cliBotName,
        status: isShuttingDown ? 'offline' : 'online'
      })
    });
  } catch (e) {
    // Silent fail if server is down
  }
}

async function main() {
  // --- Validation ---
  if (!process.env.MNEMONIC || !process.env.ALPHA_API_KEY) {
    console.error('❌ Missing MNEMONIC or ALPHA_API_KEY in .env');
    process.exit(1);
  }

  // CLI overrides .env
  const marketId = cliMarketId || parseInt(process.env.TARGET_MARKET_ID || '0');
  if (marketId === 0) {
    console.warn('⚠️ TARGET_MARKET_ID is not set in .env. Run list_markets.ts to find one.');
  }

  account = algosdk.mnemonicToSecretKey(process.env.MNEMONIC);
  algodClient = new algosdk.Algodv2(
    process.env.ALGOD_TOKEN || '',
    process.env.ALGOD_SERVER || 'https://mainnet-api.algonode.cloud',
    process.env.ALGOD_PORT || '443'
  );
  indexerClient = new algosdk.Indexer(
    process.env.INDEXER_TOKEN || '',
    process.env.INDEXER_SERVER || 'https://mainnet-idx.algonode.cloud',
    process.env.INDEXER_PORT || '443'
  );

  alphaClient = new AlphaClient({
    algodClient,
    indexerClient,
    signer: algosdk.makeBasicAccountTransactionSigner(account),
    activeAddress: account.addr.toString(),
    apiKey: process.env.ALPHA_API_KEY,
    matcherAppId: 3078581851,
    usdcAssetId: 31566704,
  });

  // CLI overrides .env (cliSizeShares is in number of shares)
  const targetShares = cliSizeShares || (process.env.ORDER_SIZE_USDC ? parseFloat(process.env.ORDER_SIZE_USDC) : null);
  const safetyBuffer = parseFloat(process.env.SAFETY_BUFFER_CENTS || '0.5') * 10_000; // Convert to microUSDC
  const tickInterval = parseInt(process.env.TICK_INTERVAL || '30') * 1000;

  console.log(`\n🚀 Bot started: ${cliBotName || 'AlphaBot'}`);
  console.log(`Market: ${marketId || '[GLOBAL MODE]'}`);
  console.log(`Target: ${targetShares ? `${targetShares} Shares` : 'Automatic [Reward Optimized]'} | Buffer: ${process.env.SAFETY_BUFFER_CENTS}¢`);
  console.log(`Account: ${account.addr.toString()}\n`);

  if (isShutdownMode) {
    console.log(`🛑 SHUTDOWN MODE: Bot will cancel ${marketId ? `Market ${marketId}` : 'ALL'} orders on exit.\n`);
  }

  // --- Shutdown Logic ---
  const cleanup = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[SHUTDOWN] Starting cleanup...`);

    if (tickTimer) clearInterval(tickTimer);

    if (isShutdownMode) {
      try {
        console.log(`[SHUTDOWN] Fetching open orders...`);
        const allOrders = await alphaClient.getWalletOrdersFromApi(account.addr.toString());

        // Filter by market if one is active, otherwise global
        const ordersToCancel = marketId > 0
          ? allOrders.filter(o => o.marketAppId === marketId)
          : allOrders;

        if (ordersToCancel.length === 0) {
          console.log(`[SHUTDOWN] No orders found to cancel.`);
        } else {
          console.log(`[SHUTDOWN] Cancelling ${ordersToCancel.length} orders...`);
          for (const order of ordersToCancel) {
            process.stdout.write(`  -> Cancelling ${order.escrowAppId}... `);
            await alphaClient.cancelOrder({
              marketAppId: order.marketAppId,
              escrowAppId: order.escrowAppId,
              orderOwner: account.addr.toString()
            });
            console.log('✅');
          }
        }
      } catch (e: any) {
        console.error(`[SHUTDOWN] Cleanup failed: ${e.message}`);
      }
    } else {
      console.log(`[SHUTDOWN] Standard exit. Orders left open.`);
    }

    await sendHeartbeat(marketId); // final ping as offline
    console.log(`[SHUTDOWN] Done. Goodbye!`);
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);


  // --- Main Tick Loop ---
  tickTimer = setInterval(async () => {
    try {
      console.log(`[${new Date().toLocaleTimeString()}] Ticking...`);
      await sendHeartbeat(marketId);
      await tick(alphaClient, account.addr.toString(), marketId, targetShares, safetyBuffer);
    } catch (error) {
      console.error('❌ Tick Error:', error);
    }
  }, tickInterval);

  // Initial tick with 5s delay
  console.log('⏳ Waiting 5s for API synchronization...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  await sendHeartbeat(marketId);
  await tick(alphaClient, account.addr.toString(), marketId, targetShares, safetyBuffer);
}

/**
 * Performs a single bot logic cycle
 */
async function tick(client: AlphaClient, clientAddress: string, marketId: number, targetShares: number | null, buffer: number) {
  if (marketId === 0) return;

  // 1. Fetch Market Context & Rewards Data
  const rewardMarkets = await client.getRewardMarkets();
  const market = rewardMarkets.find(m => m.marketAppId === marketId);

  if (!market) {
    console.error(`Market ${marketId} not found in reward list.`);
    return;
  }

  const midline = Number(market.midpoint || 0);
  const maxSpread = Number(market.rewardsSpreadDistance || 0);
  const minContracts = (market.rewardsMinContracts || 0);

  if (midline === 0 || maxSpread === 0) {
    console.warn(`[WARN] Market reward data missing. Rewards may not be earned.`);
  }

  const midpoint = midline;
  console.log(`🎯 Platform Midline: ${(midpoint / 1e6).toFixed(3)} | Max Spread: ±${(maxSpread / 1e4).toFixed(1)}¢`);

  // 2. Determine Target Quantity (targetShares is in number of shares, e.g. 500)
  let targetQuantity = targetShares ? Math.round(targetShares * 1e6) : minContracts;
  if (minContracts > 0 && targetQuantity < minContracts) {
    targetQuantity = minContracts;
  }
  if (targetQuantity === 0) targetQuantity = 100_000_000; // Default 100 shares

  // 3. Check Inventory & Emergency Hedge
  const positions = await client.getPositions(clientAddress);
  const marketPosition = positions.find(p => p.marketAppId === marketId);
  if ((marketPosition?.yesBalance || 0) > 0 || (marketPosition?.noBalance || 0) > 0) {
    await hedgePosition(client, marketId, marketPosition, midpoint);
  }

  // 4. Calculate Ideal Bids
  const yesBidPrice = midpoint - buffer;
  const noBidPrice = (1_000_000 - midpoint) - buffer;

  // 5. Fetch Open Orders & Purge Invalid
  const openOrders = await client.getWalletOrdersFromApi(clientAddress);
  const marketOrders = openOrders.filter(o => o.marketAppId === marketId);

  /**
   * Universal Order Manager for a single side (BUY ONLY)
   */
  async function maintainSide(side: 'YES' | 'NO', targetPrice: number) {
    const positionId = side === 'YES' ? 1 : 0;
    const existing = marketOrders.find(o => o.position === positionId && o.side === 1 && Math.abs(o.price - targetPrice) <= 1000);

    const distance = Math.abs(midpoint - (side === 'YES' ? targetPrice : 1_000_000 - targetPrice));
    const score = maxSpread > 0 ? Math.max(0, ((maxSpread - distance) / maxSpread) ** 2) : 0;

    if (existing) {
      console.log(`✅ [${side}] Yield order active at ${(targetPrice / 1e6).toFixed(3)} | 📈 Score: ${score.toFixed(2)}`);
      return;
    }

    console.log(`[REWARDS] Placing BUY ${side} at ${(targetPrice / 1e6).toFixed(3)} (Quantity: ${targetQuantity / 1e6})...`);
    try {
      await client.createLimitOrder({
        marketAppId: marketId,
        position: positionId,
        price: targetPrice,
        quantity: targetQuantity,
        isBuying: true
      });
    } catch (e: any) {
      console.error(`❌ [${side}] Buy Failed: ${e.message.split('\n')[0]}`);
    }
  }

  // Clear extra/side orders
  const validIds = new Set();
  const yesOrder = marketOrders.find(o => o.position === 1 && o.side === 1 && Math.abs(o.price - yesBidPrice) <= 1000);
  const noOrder = marketOrders.find(o => o.position === 0 && o.side === 1 && Math.abs(o.price - noBidPrice) <= 1000);
  if (yesOrder) validIds.add(yesOrder.escrowAppId);
  if (noOrder) validIds.add(noOrder.escrowAppId);

  for (const o of marketOrders) {
    if (!validIds.has(o.escrowAppId)) {
      console.log(`[PURGE] Clearing residual order at ${(o.price / 1e6).toFixed(3)}...`);
      await client.cancelOrder({ marketAppId: marketId, escrowAppId: o.escrowAppId, orderOwner: clientAddress });
    }
  }

  // 6. Maintain Bids
  await maintainSide('YES', yesBidPrice);
  await maintainSide('NO', noBidPrice);
}

/**
 * Sells off any position to return to neutral
 */
async function hedgePosition(client: AlphaClient, marketId: number, position: any, referencePrice: number) {
  if (position?.yesBalance > 0) {
    console.log(`[HEDGE] Selling ${position.yesBalance / 1e6} YES shares via Market Order at ref ${(referencePrice / 1e6).toFixed(3)}...`);
    await client.createMarketOrder({
      marketAppId: marketId,
      position: 1,
      quantity: position.yesBalance,
      isBuying: false,
      price: referencePrice,
      slippage: 100_000
    });
  }

  if (position?.noBalance > 0) {
    const noRefPrice = 1_000_000 - referencePrice;
    console.log(`[HEDGE] Selling ${position.noBalance / 1e6} NO shares via Market Order at ref ${(noRefPrice / 1e6).toFixed(3)}...`);
    await client.createMarketOrder({
      marketAppId: marketId,
      position: 0,
      quantity: position.noBalance,
      isBuying: false,
      price: noRefPrice,
      slippage: 100_000
    });
  }
  console.log('✅ Hedging complete. Neutralized exposure.');
}

main().catch(console.error);
