> [!CAUTION]
> **PROOF OF CONCEPT. USE AT OWN RISK.** 
> This software is provided "as is" without any guarantees or claims regarding profitability. Automated trading carries significant risk, and using this bot **may result in financial losses**. It is intended to be a foundation for you to adapt and implement your own strategies.

---

Special thanks to **Vibekit** for the tools and inspiration! 
Check them out on [GitHub](https://github.com/gabrielkuettel/vibekit) and [X (Twitter)](https://x.com/getvibekit).

And the wonderful **Alpha Arcade SDK** for making this possible!
Follow them on [X (Twitter)](https://x.com/alphaarcade).

---

# 🦅 Alpha Yield Bot: Advanced Market Maker & Harvester

The **Alpha Yield Bot** is a high-performance liquidity incentive harvester designed for the Alpha Arcade protocol on Algorand. It operates as a delta-neutral market maker, focusing on capturing the **2.5x Bilateral Bonus** while aggressively managing positions to stay within the "Reward Zone."

---

## 🚀 Quick Start (Terminal)

### 1. Installation
Clone the repository and install dependencies from your terminal:
```bash
npm install
```

### 2. Environment Setup
Copy the example environment file and fill in your credentials:
```bash
cp .env.example .env
```
> [!IMPORTANT]
> You **must** provide a `MNEMONIC` (25-word seed phrase) and an `ALPHA_API_KEY` in your `.env` file to start.

### 3. Run the Bot
Start the bot on a specific market with a target share size:
```bash
# Example: Deploy 100 USDC per side to Market 3078581851
npm run bot -- --market 3078581851 --target 100 --shutdown
```

---

## ⌨️ CLI Commands & Flags

The bot accepts several flags to customize its execution at runtime:

| Flag | Description | Default |
| :--- | :--- | :--- |
| `--market <id>` | Target Market Application ID. | `TARGET_MARKET_ID` from `.env` |
| `--target <usd>` | Target shares per side (USDC). | `ORDER_SIZE_USDC` from `.env` |
| `--max` | Deploys 90% of your total wallet USDC to the market. | `false` |
| `--shutdown` | Automatically cancels all open orders on exit (Ctrl+C). | `false` |
| `--name <string>` | Custom name for the bot instance in the dashboard. | `Alpha-Yield` |
| `--buffer <cents>` | Sensitivity buffer (¢) from the midpoint. | `1.5` |

---

## 🖥️ The Dashboard

Manage your entire fleet from a sleek, real-time web interface.

### Running the Dashboard
```bash
npm run dev
```
This launches the **Backend Server** (Port 3001) and the **Frontend UI** (Vite).

### Key Features:
*   **📡 Fleet Telemetry**: Track multiple bot instances across different markets simultaneously.
*   **📊 Yield Metrics**: Real-time tracking of total rewards earned, efficiency rank, and cost basis.
*   **⚡ Bot Control**: Inject extra capital or shut down bots directly from the UI.
*   **🔍 Opportunity Scanner**: Automatically discovers markets with higher efficiency scores.
*   **🛡️ Inventory Monitor**: Visual breakdown of your YES/NO shares and live limit orders.

---

## 🧠 Strategy Nuances

The bot isn't just a simple buyer; it uses advanced logic to maximize yield and minimize risk:

### 🛡️ Category-Specific Logic
*   **Crypto Volatility Boost**: For "Crypto" category markets, the bot automatically adds a **+1.0¢ buffer** to account for higher volatility, preventing "toxic flow" fills.
*   **Volatility Pause**: If a market's price shifts more than **3%** in a single tick, the bot enters a **2-tick cooldown**, pulling bids until the price stabilizes.

### 🔄 Inventory Management
*   **Inventory Skewing**: If the bot becomes "heavy" on one side (e.g., holding >50% of the target), it automatically lowers its bid price to avoid over-exposure.
*   **Matched Neutrality**: The bot tracks "Matched Pairs" (YES + NO sets). These are price-neutral and effectively "risk-free" while earning rewards.

---

## 🚪 Exit Strategies (Getting Out)

The bot's primary goal is to "flip" inventory back into USDC. It uses a multi-stage liquidation engine:

1.  **Profit Window**: Initially, it places Sell Orders (Asks) at a profit (Midpoint + Buffer).
2.  **Liquidation Stage**: If the position hasn't flipped after the `LIQUIDATION_WINDOW_TICKS`:
    *   **Gentle Exit**: Lowers price to `Midpoint - 0.1¢`.
    *   **Firm Exit**: Lowers price to `Midpoint - 0.3¢`.
    *   **Forced Exit**: Lowers price to `Midpoint - 0.5¢`.
3.  **Volatility Bypass**: If a sharp price drop is detected (>3¢), the bot skips the windows and immediately lowers the Sell price to exit.
4.  **Physical Stop-Loss**: If a position loses more than **5¢** in value, the bot triggers a **Market Order Exit** (if data sanity checks pass) to protect principal.

---

## 🧪 Category-Specific Strategy Samples

The bot is designed to be modular. You can easily extend its logic based on the market category (e.g., Crypto, Politics, Sports).

### Example: Crypto Volatility Buffer
The current implementation includes a sample of how to add sensitivity based on the "Crypto" tag:

```typescript
// Sample logic from alpha_yield_bot.ts
const isCrypto = market.categories?.some((c: string) => c.toLowerCase().includes('crypto'));
const cryptoBoost = isCrypto ? 10000 : 0; // Adds +1.0¢ buffer for crypto

if (isCrypto) { 
  console.log(`🛡️ [CRYPTO] Volatility Buffer Active (+1.0¢)`); 
}

// Pass derived buffer to the tick loop
await tick(..., safetyBuffer + cryptoBoost, ...);
```

### Adapting for Other Categories
You can follow this pattern to implement custom logic:
*   **Sports**: Tighten spreads closer to game time.
*   **Politics**: Lower exposure during high-impact news cycles.
*   **Custom**: Use external APIs to feed real-time volatility data into the `tick` function.

---

> [!WARNING]
> **Hot Wallet Only**: This bot manages private keys in memory. Always use a dedicated "Hot Wallet" with only the funds you intend to trade. Never use your primary storage wallet.
