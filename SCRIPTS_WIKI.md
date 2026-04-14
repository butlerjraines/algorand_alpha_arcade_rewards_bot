# Alpha Arcade: Scripts Wiki

This document explains the three core components of the Alpha Arcade system and how to manage them.

## 1. Market Server
The backend hub that discovers markets, tracks bot heartbeats, and provides the API for the Dashboard.
*   **Directory**: `/server`
*   **Start Command**: `npm run server`
*   **Purpose**: Manages the local market cache and monitors hot wallet health.

## 2. Alpha Yield Bot
The automated market maker that earns USDC rewards by maintaining dual-sided liquidity.
*   **Start Command**: `npm run bot`
*   **Basic Usage**: Targets the market ID specified in your `.env`.

## 🤖 Bot CLI Commands

The yield bot supports the following flags via `npm run bot -- <flags>`:

*   `--market <id>`: Overrides the default market ID.
*   `--size <shares>`: Sets the target order quantity in **shares** (contracts).
*   `--name <label>`: Sets a custom name for the bot in the fleet dashboard.

## Dashboard Analytics

### Yield Profitability Score
The "Incentivized Markets" view now includes a real-time profitability ranker. This calculates your estimated daily earnings based on:
1. **Last Reward Amount**: The most recent payout rate from the Alpha API.
2. **Competition Proxy**: A weights system applied to the "Low/Med/High" competition tags to estimate your share of the reward pool.
3. **Daily Projection**: Calculates estimated profit for a "1x Min" entry (exactly enough to qualify for rewards).

### Fleet Monitoring
The sidebar displays all active bot instances sending heartbeats to the server.
- **Status**: Updated every 30 seconds.
- **Auto-Cleanup**: Bots that fail to send a heartbeat for > 65 seconds are automatically hidden.

*   `--market <id>`: Overrides the default market ID.
*   `--size <shares>`: Sets the target order quantity in **shares** (contracts).
*   `--name <label>`: Assigns a name to the bot (e.g., `--name "Aggressive"`). Useful for tracking multiple bots on the dashboard.
*   `--shutdown`: Enables cleanup mode. When you stop the bot (Ctrl+C), it will automatically cancel its live orders.

**Example: Running a Fleet**
```bash
# Terminal 1
npm run bot -- --market 2785648646 --name "Bot A" --shutdown

# Terminal 2
npm run bot -- --market 3518916269 --name "Bot B" --shutdown
```

### Shutdown Modes
*   **Market-Specific**: Run `npm run bot -- --market 123 --shutdown`. Pressing Ctrl+C will only cancel orders for Market 123.
*   **Global**: Run `npm run bot -- --shutdown` (with no market in .env). Pressing Ctrl+C will clear **EVERY** open order for your wallet.

## 3. Dashboard
The visual control center for monitoring your bot's performance.
*   **Directory**: `/dashboard`
*   **Start Command**: `npm run dashboard`
*   **Key Features**:
    *   **Bot Status**: Real-time Online/Offline indicator via heartbeats.
    *   **Active Inventory**: Lists exactly which markets you have orders in.
    *   **Refill**: One-click funding for your hot wallet.

---

## Developer Operations
### Fleet Heartbeat System
Every bot you launch sends a "ping" to the server every tick (30s). The server maintains a "Bot Fleet" list.
*   **Unique Identity**: Bots are identified by their Name and Market ID.
*   **Automatic Cleanup**: If a bot stops pinging for 65 seconds, the server automatically removes it from the "Active Fleet" on the dashboard.

### Quick Start (Full System)
Run all components at once from the root directory:
```bash
npm run dev
```
Then launch your fleet in separate windows:
```bash
npm run bot -- --market 123 --name "Bot A" --shutdown
npm run bot -- --market 456 --name "Bot B" --shutdown
```
