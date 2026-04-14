```bash
npm install
```

### 3. Launch UI Dashboard (Recommended)
This starts both the backend market discovery service and the interactive frontend.
```bash
npm run dev
```
- **Dashboard**: http://localhost:5173
- **Backend API**: http://localhost:3001

### 4. Start the Background Bot
This starts the automated liquidity incentive harvester in your terminal.
```bash
npm run bot
```

---

## 🤖 How the Bot Works

The `alpha_yield_bot.ts` script is designed to capture **USDC Liquidity Incentives** while strictly maintaining a neutral price exposure (market-making).

### 1. The Strategy: "Delta Neutral Rewards"
- **Reward Zone Filtering**: The bot uses the SDK to find markets currently offering rewards. It identifies the "Midpoint" and "Maximum Spread" required to qualify for incentives.
- **Order Placement**: It places two limit orders (one YES, one NO) slightly inside the

## 🤖 Bot CLI Commands

The yield bot supports the following flags via `npm run bot -- <flags>`:

*   `--market <id>`: Overrides the default market ID.
*   `--size <shares>`: Sets the target order quantity in **shares** (contracts).
*   `--name <label>`: Assigns a name for dashboard tracking (e.g., `--name "Bot-A"`).
*   `--shutdown`: Enables cleanup mode. When you stop the bot (Ctrl+C), it will automatically cancel its live orders.

**Example: Running a Fleet**
```bash
# Start bot for US Election
npm run bot -- --market 2785648646 --name "Election-MM" --shutdown

# Start bot for Crypto Market
npm run bot -- --market 3518916269 --name "Crypto-MM" --shutdown
```

- **Continuous Re-centering**: Every 30 seconds, it cancels and replaces orders if the market midpoint shifts outside the active reward zone.

### 2. The Hedge Mechanism
- **Automated Exit**: If one of the bot's limit orders is filled, it immediately detects the new balance.
- **Market Hedge**: It instantly executes a **Market Order** to sell that position back into the market.
- **Goal**: The bot doesn't care about the price outcome; it stays in the book simply to "collect rent" (liquidity incentives) in USDC.

---

## 📊 Dashboard Features

- **Market Explorer**: Real-time view of all live Alpha markets with volume tracking.
- **Rewards Tab**: A dedicated view of only the markets currently offering liquidity incentives.
- **Bot Overview**: Monitor your "Hot Wallet" ALGO and USDC balances directly from the UI.
- **Copy for Bot**: Use the "Copy ID" button on any market to quickly update your `TARGET_MARKET_ID` in `.env`.

## ⚠️ Security Note
Your `MNEMONIC` is stored locally in `.env`. Ensure this file is never committed to GitHub or shared. This bot is intended for use with a "Hot Wallet" containing only the funds you intend to use for yield harvesting.
