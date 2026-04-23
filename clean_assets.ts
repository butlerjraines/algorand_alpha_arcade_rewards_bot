import dotenv from 'dotenv';
import algosdk, { 
  mnemonicToSecretKey, 
  Algodv2, 
  Indexer,
  makeAssetTransferTxnWithSuggestedParamsFromObject,
  makeBasicAccountTransactionSigner
} from 'algosdk';
import { AlphaClient } from '@alpha-arcade/sdk';

dotenv.config({ override: true });

async function run() {
  if (!process.env.MNEMONIC) {
    console.error('❌ Missing MNEMONIC');
    process.exit(1);
  }

  const rawMnemonic = process.env.MNEMONIC.trim().replace(/^["']|["']$/g, '');
  const account = mnemonicToSecretKey(rawMnemonic);
  const address = account.addr.toString();
  
  const algodClient = new Algodv2('', process.env.ALGOD_SERVER || 'https://mainnet-api.algonode.cloud', '443');
  const indexerClient = new Indexer('', process.env.INDEXER_SERVER || 'https://mainnet-idx.algonode.cloud', '443');

  const alphaClient = new AlphaClient({
    algodClient,
    indexerClient,
    signer: makeBasicAccountTransactionSigner(account),
    activeAddress: address,
    apiKey: process.env.ALPHA_API_KEY || '',
    matcherAppId: 3078581851, // Mainnet Matcher
    usdcAssetId: 31566704,    // Mainnet USDC
  });

  console.log(`🧹 [MBR CLEANUP] Scanning for unused ASAs for ${address}...`);

  const accountInfo = await algodClient.accountInformation(address).do();
  const assets = accountInfo.assets || [];

  // --- DYNAMIC PROTECTION SHIELD ---
  const protectedAssets = new Set([31566704]); // Always protect USDC

  try {
    console.log(`📡 Fetching active orders for protection...`);
    const orders = await alphaClient.getWalletOrdersFromApi(address);
    const activeMarketIds = new Set<number>();
    
    orders.forEach((o: any) => {
      if (o.marketAppId) activeMarketIds.add(Number(o.marketAppId));
    });

    for (const mId of activeMarketIds) {
      try {
        const m = await alphaClient.getMarket(mId.toString());
        if (m) {
          if (m.yesAssetId) protectedAssets.add(Number(m.yesAssetId));
          if (m.noAssetId) protectedAssets.add(Number(m.noAssetId));
          console.log(`🛡️  Protected Market ${mId}: ${m.title}`);
        }
      } catch (e) {}
    }
  } catch (e) {
    console.error("❌ Failed to fetch open orders. Aborting for safety.");
    process.exit(1);
  }

  const assetsToClear = assets.filter((a: any) => {
    const assetId = Number((a as any).assetId ?? (a as any)['asset-id']);
    const amount = Number(a.amount);
    return amount === 0 && !protectedAssets.has(assetId);
  });

  if (assetsToClear.length === 0) {
    console.log(`✨ No unused ASAs found (Shielded: ${protectedAssets.size} assets).`);
    return;
  }

  console.log(`📦 Found ${assetsToClear.length} ASAs to clear. (Shielded: ${protectedAssets.size} assets)`);
  const suggestedParams = await algodClient.getTransactionParams().do();

  for (const a of assetsToClear) {
    const assetId = Number((a as any).assetId ?? (a as any)['asset-id']);
    console.log(`   - Opting out of ${assetId}...`);
    
    const txn = makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: address,
      receiver: address,
      closeRemainderTo: "5P5Y6HTWUNG2E3VXBQDZN3ENZD3JPAIR5PKT3LOYJAPAUKOLFD6KANYTRY",
      assetIndex: assetId,
      amount: 0,
      suggestedParams
    });

    const signed = txn.signTxn(account.sk);
    await algodClient.sendRawTransaction(signed).do();
  }

  console.log(`✅ [CLEANUP] Successfully cleared ${assetsToClear.length} ASAs.`);
  process.exit(0);
}

run().catch(console.error);
