# Alpha Arcade Yield Bot

Automated delta-neutral liquidity harvesting engine for the Alpha Arcade protocol on Algorand.

## Project Mission
The bot's objective is to capture liquidity rewards by maintaining high-uptime limit orders within the "Reward Zone" of specified markets. It minimizes directional risk by instantly hedging fills and recycling capital through native share merging.

## Core Strategy: Buy-and-Merge
The bot operates in a continuous four-phase cycle designed for delta-neutrality:

1.  **Discovery**: Fetches real-time market metadata, including the rewards midpoint, spread distance, and minimum contract requirements.
2.  **Maker (Placement)**: Calculates optimal prices at the inner edge of the reward zone and places dual-sided limit orders (Asks) using a split-share entry.
3.  **Hedge (Taker)**: Utilizes real-time WebSocket events to detect fills. Upon any partial fill, the bot immediately cancels the opposing side and executes a Market Buy (Taker) for the delta to restore neutrality.
4.  **Recycle (Merge)**: Once a balanced position is achieved (YES = NO), the bot utilizes the native `mergeShares` function to convert the position back into USDC, ready for redeployment.

## Key Features

### 📡 Fleet Management
*   **Heartbeat Telemetry**: Real-time status reporting to a centralized dashboard.
*   **Remote Commands**: Supports "Inject" (budget increase), "Stop Clean" (graceful liquidation), and "Stop Keep" (immediate halt) signals from the UI.
*   **Multi-Instance Support**: Capable of running multiple bots across different markets from a single backend.

### 🛡️ Safety & Stability
*   **Gas Safety Gate**: Mandatory check for 10+ ALGO on startup to prevent transaction failures.
*   **Startup Reconciliation**: Detects pre-existing on-chain positions during boot-up to recover imbalanced inventory or reuse balanced shares.
*   **Drift Monitoring**: Automatically re-aligns orders if the market reward zone shifts.
*   **Market Expiry Logic**: Triggers a graceful liquidation and shutdown 60 minutes before market resolution.

### 🧹 Wallet Maintenance
*   **Dynamic MBR Cleanup**: Identifies and removes unused market tokens (0 balance) to reclaim Algorand Minimum Balance (MBR).
*   **Order Awareness**: Cleanup logic automatically shields any asset with an active order or bot heartbeat, preventing accidental opt-outs of active markets.

## Getting Started

### Installation
```bash
npm install
```

### Configuration
1. Create a `.env` file based on `.env.example`.
2. Required variables: `MNEMONIC`, `ALPHA_API_KEY`, `ALGOD_SERVER`, `INDEXER_SERVER`.

### Running the Bot
```bash
# Standard mode (uses minimum required size)
npm run bot -- --market <MARKET_ID>

# Max mode (deploys available USDC)
npm run bot -- --market <MARKET_ID> --max
```

### Running the Dashboard
```bash
npm run dev
```

---

> [!WARNING]
> **Hot Wallet Safety**: This bot manages private keys in memory. Always use a dedicated hot wallet. Automated trading involves significant risk of financial loss.
