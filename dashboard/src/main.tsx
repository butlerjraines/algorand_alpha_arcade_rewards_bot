import { Buffer } from 'buffer'
(window as any).Buffer = Buffer
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WalletProvider, WalletManager, WalletId, NetworkId } from '@txnlab/use-wallet-react'
import { PeraWalletConnect } from '@perawallet/connect'
import LuteConnect from 'lute-connect'
import './index.css'
import App from './App.tsx'

const walletManager = new WalletManager({
  wallets: [
    { id: WalletId.PERA, getConstructor: () => PeraWalletConnect },
    { id: WalletId.LUTE, getConstructor: () => LuteConnect }
  ],
  defaultNetwork: NetworkId.MAINNET
});

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <WalletProvider manager={walletManager}>
        <App />
      </WalletProvider>
    </QueryClientProvider>
  </StrictMode>
)
