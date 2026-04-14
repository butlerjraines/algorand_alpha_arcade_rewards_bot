import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient } from '@alpha-arcade/sdk';

dotenv.config();

/**
 * Places a limit order on a specific market.
 */
async function placeOrder() {
  if (!process.env.MNEMONIC) {
    throw new Error('MNEMONIC not set in .env');
  }

  const account = algosdk.mnemonicToSecretKey(process.env.MNEMONIC);
  
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
    algodClient,
    indexerClient,
    signer: algosdk.makeBasicAccountTransactionSigner(account),
    activeAddress: account.addr.toString(),
    apiKey: process.env.ALPHA_API_KEY || '',
    matcherAppId: 3078581851,
    usdcAssetId: 31566704,
  });

  // --- CONFIGURATION ---
  const marketAppId = 123456789; // Replace with a real Market App ID from list_markets.ts
  const isYes = true;            // Position: true for YES, false for NO
  const priceDollars = 0.50;     // Price per share (e.g., $0.50)
  const quantityShares = 10;     // Number of shares to buy/sell
  const isBuying = true;         // Side: true for BUY, false for SELL
  // ---------------------

  console.log(`Setting up order for Market ${marketAppId}...`);
  console.log(`Side: ${isBuying ? 'BUY' : 'SELL'} | Position: ${isYes ? 'YES' : 'NO'}`);
  console.log(`Price: $${priceDollars} | Quantity: ${quantityShares} shares`);

  // Convert to SDK units (6 decimals)
  const priceInMicroUSDC = Math.round(priceDollars * 1e6);
  const quantityInBaseUnits = Math.round(quantityShares * 1e6);

  try {
    const result = await client.createLimitOrder({
      marketAppId,
      position: isYes ? 1 : 0,
      price: priceInMicroUSDC,
      quantity: quantityInBaseUnits,
      isBuying,
    });

    console.log('\n✅ Order Created Successfully!');
    console.log(`Escrow App ID: ${result.escrowAppId}`);
    console.log(`Transaction IDs: ${result.txIds.join(', ')}`);
  } catch (error) {
    console.error('\n❌ Failed to place order:', error);
    console.log('\nCommon issues:');
    console.log('1. Insufficient USDC balance');
    console.log('2. Insufficient ALGO balance for opt-ins and fees');
    console.log('3. Incorrect Market App ID');
  }
}

placeOrder().catch(console.error);
