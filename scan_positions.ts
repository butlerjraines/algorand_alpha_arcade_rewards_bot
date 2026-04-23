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

  console.log(`🔎 [SCAN] Checking all positions for ${address}...`);
  const positions = await alphaClient.getPositions(address) as any[];
  console.log(JSON.stringify(positions, null, 2));
}

run().catch(console.error);
