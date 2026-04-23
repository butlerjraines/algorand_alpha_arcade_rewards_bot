import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient } from '@alpha-arcade/sdk';

dotenv.config();

async function run() {
  const account = algosdk.mnemonicToSecretKey(process.env.MNEMONIC!);
  const address = account.addr.toString();

  const alphaClient = new AlphaClient({
    algodClient: new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', '443'),
    indexerClient: new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', '443'),
    signer: algosdk.makeBasicAccountTransactionSigner(account),
    activeAddress: address,
    apiKey: process.env.ALPHA_API_KEY!,
    matcherAppId: 3078581851,
    usdcAssetId: 31566704,
  });

  console.log(`🔎 [DEEP SCAN] Fetching all possible orders for ${address}...`);

  try {
    // Try catching ALL orders across ALL markets
    const orders = await alphaClient.getWalletOrdersFromApi(address);
    console.log(`[SCAN] API returned ${orders.length} orders total.`);
    
    if (orders.length > 0) {
      for (const o of orders) {
        console.log(`[CLEANUP] Cancelling order on Market ${o.marketAppId} (Escrow: ${o.escrowAppId})...`);
        await alphaClient.cancelOrder({ 
          marketAppId: Number(o.marketAppId), 
          escrowAppId: Number(o.escrowAppId), 
          orderOwner: address 
        }).catch(e => console.error(`   FAILED: ${e.message}`));
      }
    }

    // Also check for positions that might need merging on other markets
    const rewardMarkets = await alphaClient.getRewardMarkets() as any[];
    const positions = await alphaClient.getPositions(address) as any[];
    
    for (const p of positions) {
      const matched = Math.min(p.yesBalance, p.noBalance);
      if (matched > 1000) {
        console.log(`[CLEANUP] Found balanced position on Market ${p.marketAppId}. Merging...`);
        await alphaClient.mergeShares({ marketAppId: Number(p.marketAppId), amount: matched }).catch(() => {});
      }
    }

  } catch (e: any) {
    console.error(`❌ [DEEP SCAN ERROR] ${e.message}`);
  }

  console.log(`✅ [DEEP SCAN] Finished.`);
  process.exit(0);
}

run().catch(console.error);
