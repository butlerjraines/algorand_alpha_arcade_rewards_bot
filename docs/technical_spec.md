# REQUIREMENTS: ALPHA ARCADE REWARDS BOT (DELTA-NEUTRAL)

## 1. PROJECT OBJECTIVE
Build an ironclad, high-frequency liquidity-providing bot using the **Alpha Arcade SDK**. The bot maximizes profit by farming liquidity rewards through double-sided limit orders. It maintains **Delta Neutrality** at all times, neutralizing fills via an aggressive **Taker-Hedge** and converting balanced positions back to USDC via the **Merge** function.

---

## 2. CONFIGURATION & ENVIRONMENT (.env)
The bot must support these environmental variables for risk management:
- `USDC_BUFFER_PERCENT`: (Default: `0.015`) Cash reserve (1.5%) to cover Market Buy slippage and Taker fees.
- `MAX_SLIPPAGE_TOLERANCE`: (Default: `0.02`) Max price deviation (2%) allowed for a hedge before pausing for safety.
- `POLL_INTERVAL`: (Default: `500ms`) Fallback heartbeat interval.
- `DUST_THRESHOLD`: (Default: `0.1`) Ignore token balances below this value to prevent rounding loops.
- **Gas Safety**: A minimum balance of **10 ALGO** is required to start the bot. This ensures sufficient gas for continuous order management and heartbeats.

---

## 3. COMMAND LINE INTERFACE (CLI)
The bot must execute via these specific NPM patterns:
- `npm run bot <MARKET_ID>`: Uses the minimum required shares (`rewardsMinContracts`) for order sizing.
- `npm run bot <MARKET_ID> --max`: Uses 100% of available USDC minus the `USDC_BUFFER_PERCENT`.
- `npm run bot <MARKET_ID> --inject <AMOUNT>`: 
    1. `cancelAllOrders()`
    2. `mergeShares()` (liquidate any existing pairs)
    3. Add `<AMOUNT>` to current USDC balance.
    4. Recalculate size and restart placement.

## 4. DASHBOARD FLEET COMMANDS
The bot must listen to the dashboard heartbeat response for real-time fleet commands:
- **Inject (add-budget)**: Increases the `targetShares` and triggers an immediate refresh of market orders to deploy the new capital.
- **Stop Clean (shutdown-clean)**: Cancels all orders, merges existing positions into USDC, and performs a graceful exit.
- **Stop Keep (shutdown-keep)**: Terminates the bot process immediately without modifying the on-chain state (orders/escrows remain active).

### 4.1 MBR Maintenance (Cleanup)
The system provides a mechanism to reclaim ALGO Minimum Balance (MBR) from unused market tokens:
- **Dynamic Protection**: The cleanup logic **MUST** query the Alpha Arcade API for all open orders and scan the active bot fleet heartbeats. Any asset associated with an active order or bot MUST be shielded from cleanup.
- **Dry Run**: The UI MUST perform a "Dry Run" first, fetching the count of eligible assets and the estimated ALGO reclaim amount to present as a confirmation fact to the user before execution.

---

## 4. END-TO-END OPERATIONAL LOGIC

### **Phase 1: Initialization & Metadata Discovery**
- **Action:** Call `getRewardMarkets()` via the Reward SDK.
- **Source of Truth:** 
    - Fetch `rewardsMinContracts`: The absolute minimum shares required per order for reward eligibility.
    - Fetch `rewardsSpreadDistance`: The maximum allowable distance from the midpoint to qualify for rewards.
- **Validation:** If `Wallet_USDC < (MinContracts * 2 * MidPrice)`, exit with `[ERROR] Insufficient USDC for Reward Minimum`.
- **Intelligent Recovery:** On startup, the bot must check for existing YES/NO balances.
    - If **imbalanced**, it must trigger **Phase 3 (Hedge)** and **Phase 4 (Merge)** before starting a new cycle.
    - If **balanced and sufficient**, it should skip **Phase 2 (Split)** and go directly to Ask placement.

### **Phase 2: Maker (Ask Placement)**
- **Target Selection:** MUST strictly use `midpoint` and `rewardsSpreadDistance` from the **Reward SDK Metadata**.
- **Price Calculation:**
    - `YesPrice = RewardMidpoint + Math.round(RewardsSpread * 0.95)`
    - `NoPrice = (1,000,000 - RewardMidpoint) + Math.round(RewardsSpread * 0.95)`
- **Action:** Use `splitShares` to enter, then place dual Asks (Sell Orders) for the full `targetShares`.
- **Goal:** Pin orders to the inner edge (95%) of the reward zone to maximize fill probability while ensuring 100% reward eligibility.

### **Phase 3: The "Ironclad" Hedge (The Trigger)**
- **Monitoring:** **MUST** use **WebSocket** `order_update` events. Polling is unacceptable for hedging speed.
- **Trigger:** Upon any partial or full fill:
    1. **Immediate Killswitch:** Execute `cancelAllOrders()` instantly to prevent the unfilled side from creating further imbalance or "toxic flow."
    2. **Inventory Snapshot:** Call `getBalances()` immediately to calculate the **Delta** (the difference between YES and NO shares).
    3. **Taker Hedge:** Immediately execute a **Market Buy (Taker)** for the delta amount on the missing side. **Do not use limit orders for hedging.**
    4. **Execution Priority:** Prioritize speed and execution over price. Use the `USDC_BUFFER` to cover the spread cost.

### **Phase 4: Settlement & Recycle (The Merge)**
- **Condition:** Once `YES_Balance == NO_Balance` (within Dust Threshold).
- **Action:** Call `mergeShares(marketId, amount)`.
- **Reset:** Once capital is returned to USDC, restart the loop from **Phase 2**.

### **Phase 5: Safety & Lifecycle**
- **Drift Monitoring:** The bot MUST poll Reward SDK metadata every 5 seconds. If the `RewardMidpoint` or `RewardsSpread` shifts such that existing orders are outside the boundary, the bot must:
    1. `cancelAllOrders()`
    2. Restart from **Phase 2** to re-align orders.
- **Market Expiry:** The bot must fetch `endTs` during Phase 1.
- **Graceful Shutdown:** Exactly 60 minutes before `endTs`, the bot must:
    1. `cancelAllOrders()`
    2. `mergeShares()`
    3. Log `[TERMINATE] Market nearing resolution. Shutdown complete.`
    4. Exit process.
- **WebSocket Reconnection:** Implement an auto-reconnect strategy with at least 3 retries.
- **Dust Management:** Any balance `< 0.1` shares must be ignored to prevent rounding loops.
