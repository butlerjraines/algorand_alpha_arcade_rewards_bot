import dotenv from 'dotenv';
import algosdk from 'algosdk';
import { AlphaClient } from '@alpha-arcade/sdk';

dotenv.config();

/**
 * Lists all live markets on Alpha.
 */
async function listMarkets() {
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
    apiKey: process.env.ALPHA_API_KEY || '',
    matcherAppId: 3078581851,
    usdcAssetId: 31566704,
    activeAddress: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ', // Placeholder
    signer: async (txnGroup) => txnGroup.map(() => new Uint8Array(64)) // Dummy signer for read-only
  });

  console.log('Fetching live markets...');
  try {
    const markets = await client.getLiveMarkets();
    console.log(`Found ${markets.length} live markets:\n`);

    markets.forEach((market, index) => {
      console.log(`${index + 1}. [${market.marketAppId}] ${market.title}`);
      console.log(`   Resolution: ${market.resolutionValue}`);
      console.log(`   Volume: $${((market.volume || 0) / 1e6).toLocaleString()}`);
      console.log('---');
    });
  } catch (error) {
    console.error('Error fetching markets:', error);
    console.log('\nMake sure your ALPHA_API_KEY is set in .env');
  }
}

listMarkets().catch(console.error);
