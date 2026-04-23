import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient } from '@alpha-arcade/sdk';

dotenv.config();

/**
 * WHALE SCANNER: Identifies Zero-Risk Farming Opportunities
 * Look for markets where the 0c or 100c boundary is inside the reward zone.
 */

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

  console.log(`\n🕵️  Scanning Alpha Arcade Reward Markets for Zero-Risk Opportunities...\n`);

  try {
    const rewardMarkets = await alphaClient.getRewardMarkets() as any[];
    
    const safeMarkets = rewardMarkets.filter(m => {
      const mid = Number(m.midpoint || 500_000);
      const spr = Number(m.rewardsSpreadDistance || 0);
      return (mid <= spr) || ((1000000 - mid) <= spr);
    });

    if (safeMarkets.length === 0) {
      console.log(`✅ No zero-risk farming markets found. Everything is "Fair Play" right now.`);
      return;
    }

    // Sort by daily pot size
    safeMarkets.sort((a, b) => Number(b.totalRewards || 0) - Number(a.totalRewards || 0));

    console.log(`FOUND ${safeMarkets.length} ZERO-RISK CANDIDATES:\n`);
    
    console.log(`| ID         | MID   | SPR   | SAFETY   | BOTS | ZONE SIZE | Total Rewards per day: | TITLE`);
    console.log(`|------------|-------|-------|----------|------|-----------|------------------------|--------------------------------------------------`);

    for (const m of safeMarkets) {
      const id = m.marketAppId || m.appId;
      const mid = Number(m.midpoint || 500_000);
      const spr = Number(m.rewardsSpreadDistance || 0);
      const midCents = (mid / 10000).toFixed(1);
      const sprCents = (spr / 10000).toFixed(1);
      const safety = (mid <= spr) ? "FLOOR 0c" : "CEIL 100c";
      const bots = m.lpActiveWallets || 0;
      const zoneSize = (Number(m.currentMidpointLiquidity || 0) / 1e6).toFixed(0);
      const pot = (Number(m.totalRewards || 0) / 1e6).toFixed(2);
      const title = m.title.length > 50 ? m.title.substring(0, 47) + "..." : m.title;

      console.log(`| ${String(id).padEnd(10)} | ${midCents.padEnd(5)} | ${sprCents.padEnd(5)} | ${safety.padEnd(8)} | ${String(bots).padEnd(4)} | ${String('$' + zoneSize).padEnd(9)} | $${String(pot).padEnd(21)} | ${title}`);
    }

    console.log(`\n💡 Advice:
- High Crowding (>80%): Whales are already there. You need massive capital to earn.
- Low Crowding (<30%): Unseen gems! You can farm these with zero risk before the whales arrive.
- Midpoint > Spread: These are "Fair Play" markets where you actually have to risk being filled.`);

  } catch (e: any) {
    console.error(`❌ Scan failed: ${e.message}`);
  }
}

main().catch(console.error);
