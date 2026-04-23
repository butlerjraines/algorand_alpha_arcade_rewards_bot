import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient } from '@alpha-arcade/sdk';

dotenv.config();

async function run() {
  const account = algosdk.mnemonicToSecretKey(process.env.MNEMONIC!);
  const address = account.addr.toString();
  const activeMarketId = 3531084135; // Target market

  const alphaClient = new AlphaClient({
    algodClient: new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', '443'),
    indexerClient: new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', '443'),
    signer: algosdk.makeBasicAccountTransactionSigner(account),
    activeAddress: address,
    apiKey: process.env.ALPHA_API_KEY!,
    matcherAppId: 3078581851,
    usdcAssetId: 31566704,
  });

  console.log(`🧹 [CLEANUP] Starting full emergency cleanup for market ${activeMarketId}...`);

  // 1. Cancel All Orders
  try {
    const orders = await alphaClient.getWalletOrdersFromApi(address);
    const mOrders = orders.filter(o => Number(o.marketAppId) === activeMarketId);
    if (mOrders.length > 0) {
      console.log(`[CLEANUP] Cancelling ${mOrders.length} orders...`);
      await Promise.all(mOrders.map(o => 
        alphaClient.cancelOrder({ 
          marketAppId: activeMarketId, 
          escrowAppId: o.escrowAppId, 
          orderOwner: address 
        }).catch(e => console.error(`Failed to cancel order: ${e.message}`))
      ));
    } else {
      console.log(`[CLEANUP] No active orders found.`);
    }
  } catch (e: any) {
    console.error(`❌ [CANCEL ERROR] ${e.message}`);
  }

  // 2. Merge All Positions
  try {
    const positions = await alphaClient.getPositions(address) as any[];
    const mPos = positions.find((p: any) => p.marketAppId === activeMarketId);
    if (mPos) {
      const matched = Math.min(mPos.yesBalance, mPos.noBalance);
      if (matched > 1000) {
        console.log(`[CLEANUP] Merging ${(matched/1e6).toFixed(1)} shares back to USDC...`);
        await alphaClient.mergeShares({ marketAppId: activeMarketId, amount: matched });
      } else {
        console.log(`[CLEANUP] No balanced position to merge.`);
      }
    } else {
      console.log(`[CLEANUP] No positions found.`);
    }
  } catch (e: any) {
    console.error(`❌ [MERGE ERROR] ${e.message}`);
  }

  console.log(`✅ [CLEANUP] Done.`);
  process.exit(0);
}

run().catch(console.error);
