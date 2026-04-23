import { AlphaClient } from '@alpha-arcade/sdk';
import algosdk from 'algosdk';
import dotenv from 'dotenv';
dotenv.config();
const algodClient = new algosdk.Algodv2('', 'https://mainnet-api.algonode.cloud', 443);
const indexerClient = new algosdk.Indexer('', 'https://mainnet-idx.algonode.cloud', 443);
const account = algosdk.mnemonicToSecretKey(process.env.MNEMONIC || '');
const signer = algosdk.makeBasicAccountTransactionSigner(account);
const client = new AlphaClient({
  algodClient,
  indexerClient,
  signer,
  activeAddress: account.addr.toString(),
  apiKey: process.env.ALPHA_API_KEY!,
  matcherAppId: 3078581851,
  usdcAssetId: 31566704,
});
client.getRewardMarkets().then(markets => {
  const m = markets.find(m => m.marketAppId === 3511132059);
  console.log(m);
}).catch(console.error);
