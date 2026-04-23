import { AlphaClient } from '@alpha-arcade/sdk';
import algosdk from 'algosdk';
import dotenv from 'dotenv';
import chalk from 'chalk';

dotenv.config();

const marketId = process.argv[2];
if (!marketId) {
  console.error('Usage: npx tsx monitor_midpoint.ts <marketId>');
  process.exit(1);
}

async function monitor() {
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
  const client = new AlphaClient({ 
    apiKey: process.env.ALPHA_API_KEY, 
    algodClient,
    indexerClient,
    signer: async (t) => t,
    activeAddress: 'G6X7Y...',
    matcherAppId: 1,
    usdcAssetId: 1
  } as any);

  console.log(chalk.blue(`\n📡 [MONITOR] Starting Midpoint Watcher for Market ${marketId}...`));
  console.log(chalk.dim(`(Polling Alpha Rewards API every 5 seconds)\n`));

  let lastMid = 0;

  setInterval(async () => {
    try {
      const markets = await client.getRewardMarkets();
      const m = markets.find(x => String(x.marketAppId) === marketId);
      
      if (m && m.midpoint) {
        const mid = Number(m.midpoint);
        const midCents = (mid / 10000).toFixed(2);
        const timestamp = new Date().toLocaleTimeString();

        const direction = mid > lastMid ? chalk.green('▲') : (mid < lastMid ? chalk.red('▼') : chalk.dim('•'));
        console.log(`[${timestamp}] 🎯 Midpoint: ${chalk.bold(midCents + '¢')} ${lastMid > 0 ? direction : ''}`);
        lastMid = mid;
      } else {
        console.warn(chalk.yellow(`\n⚠️  Market ${marketId} not found in rewards list.`));
      }
    } catch (e: any) {
      console.error(chalk.red(`\n❌ Error: ${e.message}`));
    }
  }, 5000);
}

monitor();
