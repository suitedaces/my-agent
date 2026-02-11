# Polymarket Documentation

## Docs

- [Create deposit addresses](https://docs.polymarket.com/api-reference/bridge/create-deposit-addresses.md): Generate unique deposit addresses for depositing assets to your Polymarket wallet.

**How it works:**
1. Submit your Polymarket wallet address
2. Receive deposit addresses for each blockchain type (EVM, Solana, Bitcoin)
3. Send assets from any supported chain to the appropriate deposit address
4. Assets are automatically bridged and swapped to USDC.e on Polygon
5. USDC.e is credited to your Polymarket wallet for trading

**Supported Assets:**
Use `/supported-assets` to see all available chains and tokens you can deposit from.

- [Create withdrawal addresses](https://docs.polymarket.com/api-reference/bridge/create-withdrawal-addresses.md): Generate unique deposit addresses for withdrawing USDC.e from your Polymarket wallet to any supported chain and token.

<Card>
**⚠️ Important:** Do not pre-generate withdrawal addresses. Only generate them when you are ready to execute the withdrawal. Each address is configured for a specific destination.
</Card>

**How it works:**
1. Specify your Polymarket wallet address, destination chain, token, and recipient address
2. Receive deposit addresses for each blockchain type (EVM, Solana, Bitcoin)
3. Send USDC.e from your Polymarket wallet to the appropriate deposit address
4. Funds are automatically bridged and swapped to your desired token
5. Funds arrive at your destination wallet

**Supported Destinations:**
Use `/supported-assets` to see all available chains and tokens you can withdraw to.

- [Get a quote](https://docs.polymarket.com/api-reference/bridge/get-a-quote.md): Get an estimated quote for a deposit or withdrawal, including output amounts, checkout time, and a detailed fee breakdown.

**Use Cases:**
- Preview fees and estimated output before executing a deposit or withdrawal
- Compare costs across different token/chain combinations
- Get the `quoteId` to reference this specific quote

**Notes:**
- Quotes are estimates and actual amounts may vary slightly due to market conditions
- See `/supported-assets` for a list of all supported chains and tokens

- [Get supported assets](https://docs.polymarket.com/api-reference/bridge/get-supported-assets.md): Retrieve all supported chains and tokens for deposits and withdrawals.

**USDC.e on Polygon:**
Polymarket uses USDC.e (Bridged USDC from Ethereum) on Polygon as the native collateral for all markets. When you deposit assets from other chains, they are automatically bridged and swapped to USDC.e on Polygon. When you withdraw, your USDC.e is bridged and swapped to your desired token on the destination chain.

**Minimum Amounts:**
Each asset has a `minCheckoutUsd` field indicating the minimum amount required in USD. Make sure your deposit or withdrawal meets this minimum to avoid transaction failures.

- [Get transaction status](https://docs.polymarket.com/api-reference/bridge/get-transaction-status.md): Get the transaction status for all deposits and withdrawals associated with a given address.

**Usage:**
- Use the deposit address returned from the `/deposit` or `/withdraw` endpoint (EVM, SVM, or BTC address)
- Poll this endpoint to track the progress of your deposits and withdrawals

**Status Values:**
- `DEPOSIT_DETECTED`: Funds detected but not yet processing
- `PROCESSING`: Transaction is being routed and swapped
- `ORIGIN_TX_CONFIRMED`: Origin transaction has been confirmed on source chain
- `SUBMITTED`: Transaction has been submitted to destination chain
- `COMPLETED`: Transaction completed successfully
- `FAILED`: Transaction encountered an error and did not complete

**Notes:**
- Transactions typically complete within a few minutes, but may take longer depending on network conditions
- An empty transactions array means no transactions have been made to this address yet

- [Get aggregated builder leaderboard](https://docs.polymarket.com/api-reference/builders/get-aggregated-builder-leaderboard.md): Returns aggregated builder rankings with one entry per builder showing total for the specified time period. Supports pagination.
- [Get daily builder volume time-series](https://docs.polymarket.com/api-reference/builders/get-daily-builder-volume-time-series.md): Returns daily time-series volume data with multiple entries per builder (one per day), each including a `dt` timestamp. No pagination.
- [Get comments by comment id](https://docs.polymarket.com/api-reference/comments/get-comments-by-comment-id.md)
- [Get comments by user address](https://docs.polymarket.com/api-reference/comments/get-comments-by-user-address.md)
- [List comments](https://docs.polymarket.com/api-reference/comments/list-comments.md)
- [Get closed positions for a user](https://docs.polymarket.com/api-reference/core/get-closed-positions-for-a-user.md): Fetches closed positions for a user(address)
- [Get current positions for a user](https://docs.polymarket.com/api-reference/core/get-current-positions-for-a-user.md): Returns positions filtered by user and optional filters.
- [Get top holders for markets](https://docs.polymarket.com/api-reference/core/get-top-holders-for-markets.md)
- [Get total value of a user's positions](https://docs.polymarket.com/api-reference/core/get-total-value-of-a-users-positions.md)
- [Get trader leaderboard rankings](https://docs.polymarket.com/api-reference/core/get-trader-leaderboard-rankings.md): Returns trader leaderboard rankings filtered by category, time period, and ordering.
- [Get trades for a user or markets](https://docs.polymarket.com/api-reference/core/get-trades-for-a-user-or-markets.md)
- [Get user activity](https://docs.polymarket.com/api-reference/core/get-user-activity.md): Returns on-chain activity for a user.
- [Data API Health check](https://docs.polymarket.com/api-reference/data-api-status/data-api-health-check.md)
- [Get event by id](https://docs.polymarket.com/api-reference/events/get-event-by-id.md)
- [Get event by slug](https://docs.polymarket.com/api-reference/events/get-event-by-slug.md)
- [Get event tags](https://docs.polymarket.com/api-reference/events/get-event-tags.md)
- [List events](https://docs.polymarket.com/api-reference/events/list-events.md)
- [Gamma API Health check](https://docs.polymarket.com/api-reference/gamma-status/gamma-api-health-check.md)
- [Get market by id](https://docs.polymarket.com/api-reference/markets/get-market-by-id.md)
- [Get market by slug](https://docs.polymarket.com/api-reference/markets/get-market-by-slug.md)
- [Get market tags by id](https://docs.polymarket.com/api-reference/markets/get-market-tags-by-id.md)
- [List markets](https://docs.polymarket.com/api-reference/markets/list-markets.md)
- [Download an accounting snapshot (ZIP of CSVs)](https://docs.polymarket.com/api-reference/misc/download-an-accounting-snapshot-zip-of-csvs.md): Public endpoint (no auth) that returns an `application/zip` containing two CSV files generated from the same snapshot time.

**ZIP contents**

1) `positions.csv` (0+ rows)
- Columns (in order):
  - `conditionId` (string): market condition id
  - `asset` (string): outcome token id (uniquely identifies the position within a market)
  - `size` (number): tokens, 6 decimals
  - `curPrice` (number): per-token price/value in USDC, 6 decimals
  - `valuationTime` (string): RFC3339 UTC timestamp

2) `equity.csv` (0 or 1 row)
- Columns (in order):
  - `cashBalance` (number): onchain USDC `balanceOf(user)` using Polygon USDC `0x2791bca1f2de4661ed88a30c99a7a9449aa84174`, 6 decimals
  - `positionsValue` (number): \(\sum(\text{size} \times \text{curPrice})\) across `positions.csv`, 6 decimals
  - `equity` (number): `cashBalance + positionsValue`, 6 decimals
  - `valuationTime` (string): RFC3339 UTC timestamp (same snapshot time as `positions.csv`)

**Example `positions.csv`**

```csv
conditionId,asset,size,curPrice,valuationTime
0xd007d71fd17b0913b9d7ff198f617caa96a9e4aab1bed7d6f9abd76bb17dd507,65396714035221124737265515219989336303267439172398528294132309725835127126381,90548.087076,0.064500,2026-01-21T18:30:00Z
0x96f6fb6567b5938fc3c2e75f9829d7287340b9581a9c4817b8bc0aff82e1c45f,10057237541929696185971116542487795282113077727880089878027691009747516185940,45666.487374,0.495000,2026-01-21T18:30:00Z
```

**Example `equity.csv`**

```csv
cashBalance,positionsValue,equity,valuationTime
125000.000000,28481009.037705,28606009.037705,2026-01-21T18:30:00Z
```

- [Get live volume for an event](https://docs.polymarket.com/api-reference/misc/get-live-volume-for-an-event.md)
- [Get open interest](https://docs.polymarket.com/api-reference/misc/get-open-interest.md)
- [Get total markets a user has traded](https://docs.polymarket.com/api-reference/misc/get-total-markets-a-user-has-traded.md)
- [Get multiple order books summaries by request](https://docs.polymarket.com/api-reference/orderbook/get-multiple-order-books-summaries-by-request.md): Retrieves order book summaries for specified tokens via POST request
- [Get order book summary](https://docs.polymarket.com/api-reference/orderbook/get-order-book-summary.md): Retrieves the order book summary for a specific token
- [Get market price](https://docs.polymarket.com/api-reference/pricing/get-market-price.md): Retrieves the market price for a specific token and side
- [Get midpoint price](https://docs.polymarket.com/api-reference/pricing/get-midpoint-price.md): Retrieves the midpoint price for a specific token
- [Get multiple market prices](https://docs.polymarket.com/api-reference/pricing/get-multiple-market-prices.md): Retrieves market prices for multiple tokens and sides
- [Get multiple market prices by request](https://docs.polymarket.com/api-reference/pricing/get-multiple-market-prices-by-request.md): Retrieves market prices for specified tokens and sides via POST request
- [Get price history for a traded token](https://docs.polymarket.com/api-reference/pricing/get-price-history-for-a-traded-token.md): Fetches historical price data for a specified market token
- [Get public profile by wallet address](https://docs.polymarket.com/api-reference/profiles/get-public-profile-by-wallet-address.md)
- [Search markets, events, and profiles](https://docs.polymarket.com/api-reference/search/search-markets-events-and-profiles.md)
- [Get series by id](https://docs.polymarket.com/api-reference/series/get-series-by-id.md)
- [List series](https://docs.polymarket.com/api-reference/series/list-series.md)
- [Get sports metadata information](https://docs.polymarket.com/api-reference/sports/get-sports-metadata-information.md): Retrieves metadata for various sports including images, resolution sources, ordering preferences, tags, and series information. This endpoint provides comprehensive sport configuration data used throughout the platform.
- [Get valid sports market types](https://docs.polymarket.com/api-reference/sports/get-valid-sports-market-types.md): Get a list of all valid sports market types available on the platform. Use these values when filtering markets by the sportsMarketTypes parameter.
- [List teams](https://docs.polymarket.com/api-reference/sports/list-teams.md)
- [Get bid-ask spreads](https://docs.polymarket.com/api-reference/spreads/get-bid-ask-spreads.md): Retrieves bid-ask spreads for multiple tokens
- [Get related tags (relationships) by tag id](https://docs.polymarket.com/api-reference/tags/get-related-tags-relationships-by-tag-id.md)
- [Get related tags (relationships) by tag slug](https://docs.polymarket.com/api-reference/tags/get-related-tags-relationships-by-tag-slug.md)
- [Get tag by id](https://docs.polymarket.com/api-reference/tags/get-tag-by-id.md)
- [Get tag by slug](https://docs.polymarket.com/api-reference/tags/get-tag-by-slug.md)
- [Get tags related to a tag id](https://docs.polymarket.com/api-reference/tags/get-tags-related-to-a-tag-id.md)
- [Get tags related to a tag slug](https://docs.polymarket.com/api-reference/tags/get-tags-related-to-a-tag-slug.md)
- [List tags](https://docs.polymarket.com/api-reference/tags/list-tags.md)
- [Polymarket Changelog](https://docs.polymarket.com/changelog/changelog.md): Welcome to the Polymarket Changelog. Here you will find any important changes to Polymarket, including but not limited to CLOB, API, UI and Mobile Applications.
- [Authentication](https://docs.polymarket.com/developers/CLOB/authentication.md): Understanding authentication using Polymarket's CLOB
- [Builder Methods](https://docs.polymarket.com/developers/CLOB/clients/methods-builder.md): These methods require builder API credentials and are only relevant for Builders Program order attribution.
- [L1 Methods](https://docs.polymarket.com/developers/CLOB/clients/methods-l1.md): These methods require a wallet signer (private key) but do not require user API credentials. Use these for initial setup.
- [L2 Methods](https://docs.polymarket.com/developers/CLOB/clients/methods-l2.md): These methods require user API credentials (L2 headers). Use these for placing trades and managing user's positions.
- [Methods Overview](https://docs.polymarket.com/developers/CLOB/clients/methods-overview.md): CLOB client methods require different levels of authentication. This reference is organized by what credentials you need to call each method. 
- [Public Methods](https://docs.polymarket.com/developers/CLOB/clients/methods-public.md): These methods can be called without a signer or user credentials. Use these for reading market data, prices, and order books.
- [Geographic Restrictions](https://docs.polymarket.com/developers/CLOB/geoblock.md): Check geographic restrictions before placing orders on Polymarket's CLOB
- [CLOB Introduction](https://docs.polymarket.com/developers/CLOB/introduction.md)
- [Cancel Orders(s)](https://docs.polymarket.com/developers/CLOB/orders/cancel-orders.md): Multiple endpoints to cancel a single order, multiple orders, all orders or all orders from a single market.
- [Check Order Reward Scoring](https://docs.polymarket.com/developers/CLOB/orders/check-scoring.md): Check if an order is eligble or scoring for Rewards purposes
- [Place Single Order](https://docs.polymarket.com/developers/CLOB/orders/create-order.md): Detailed instructions for creating, placing, and managing orders using Polymarket's CLOB API.
- [Place Multiple Orders (Batching)](https://docs.polymarket.com/developers/CLOB/orders/create-order-batch.md): Instructions for placing multiple orders(Batch)
- [Get Active Orders](https://docs.polymarket.com/developers/CLOB/orders/get-active-order.md)
- [Get Order](https://docs.polymarket.com/developers/CLOB/orders/get-order.md): Get information about an existing order
- [Onchain Order Info](https://docs.polymarket.com/developers/CLOB/orders/onchain-order-info.md)
- [Orders Overview](https://docs.polymarket.com/developers/CLOB/orders/orders.md): Detailed instructions for creating, placing, and managing orders using Polymarket's CLOB API.
- [Quickstart](https://docs.polymarket.com/developers/CLOB/quickstart.md): Initialize the CLOB and place your first order.
- [null](https://docs.polymarket.com/developers/CLOB/status.md)
- [Historical Timeseries Data](https://docs.polymarket.com/developers/CLOB/timeseries.md): Fetches historical price data for a specified market token.

- [Get Trades](https://docs.polymarket.com/developers/CLOB/trades/trades.md)
- [Trades Overview](https://docs.polymarket.com/developers/CLOB/trades/trades-overview.md)
- [Market Channel](https://docs.polymarket.com/developers/CLOB/websocket/market-channel.md)
- [User Channel](https://docs.polymarket.com/developers/CLOB/websocket/user-channel.md)
- [WSS Authentication](https://docs.polymarket.com/developers/CLOB/websocket/wss-auth.md)
- [WSS Overview](https://docs.polymarket.com/developers/CLOB/websocket/wss-overview.md): Overview and general information about the Polymarket Websocket
- [Deployment and Additional Information](https://docs.polymarket.com/developers/CTF/deployment-resources.md)
- [Merging Tokens](https://docs.polymarket.com/developers/CTF/merge.md)
- [Overview](https://docs.polymarket.com/developers/CTF/overview.md)
- [Reedeeming Tokens](https://docs.polymarket.com/developers/CTF/redeem.md)
- [Splitting USDC](https://docs.polymarket.com/developers/CTF/split.md)
- [RTDS Comments](https://docs.polymarket.com/developers/RTDS/RTDS-comments.md)
- [RTDS Crypto Prices](https://docs.polymarket.com/developers/RTDS/RTDS-crypto-prices.md)
- [Real Time Data Socket](https://docs.polymarket.com/developers/RTDS/RTDS-overview.md)
- [Blockchain Data Resources](https://docs.polymarket.com/developers/builders/blockchain-data-resources.md): Access Polymarket on-chain activity for data & analytics
- [Builder Program Introduction](https://docs.polymarket.com/developers/builders/builder-intro.md): Learn about Polymarket's Builder Program and how to integrate
- [Builder Profile & Keys](https://docs.polymarket.com/developers/builders/builder-profile.md): Learn how to access your builder profile and obtain API credentials
- [Builder Tiers](https://docs.polymarket.com/developers/builders/builder-tiers.md): Permissionless integration with tiered rate limits, rewards, and revenue generating opportunities as you scale
- [Examples](https://docs.polymarket.com/developers/builders/examples.md): Complete Next.js applications demonstrating Polymarket builder integration
- [Order Attribution](https://docs.polymarket.com/developers/builders/order-attribution.md): Learn how to attribute orders to your builder account
- [Relayer Client](https://docs.polymarket.com/developers/builders/relayer-client.md): Use Polymarket's Polygon relayer to execute gasless transactions for your users
- [How to Fetch Markets](https://docs.polymarket.com/developers/gamma-markets-api/fetch-markets-guide.md)
- [Gamma Structure](https://docs.polymarket.com/developers/gamma-markets-api/gamma-structure.md)
- [null](https://docs.polymarket.com/developers/gamma-markets-api/overview.md)
- [Data Feeds](https://docs.polymarket.com/developers/market-makers/data-feeds.md): Real-time and historical data sources for market makers
- [Market Maker Introduction](https://docs.polymarket.com/developers/market-makers/introduction.md): Overview of market making on Polymarket and available tools for liquidity providers
- [Inventory Management](https://docs.polymarket.com/developers/market-makers/inventory.md): Split, merge, and redeem outcome tokens for market making
- [Liquidity Rewards](https://docs.polymarket.com/developers/market-makers/liquidity-rewards.md): Polymarket provides incentives aimed at catalyzing the supply and demand side of the marketplace. Specifically there is a public liquidity rewards program as well as one-off public pnl/volume competitions.
- [Maker Rebates Program](https://docs.polymarket.com/developers/market-makers/maker-rebates-program.md): Technical guide for handling taker fees and earning maker rebates on Polymarket
- [Setup](https://docs.polymarket.com/developers/market-makers/setup.md): One-time setup for market making on Polymarket: deposits, approvals, wallets, and API keys
- [Trading](https://docs.polymarket.com/developers/market-makers/trading.md): CLOB order entry and management for market makers
- [Overview](https://docs.polymarket.com/developers/misc-endpoints/bridge-overview.md): Bridge and swap assets to Polymarket
- [Overview](https://docs.polymarket.com/developers/neg-risk/overview.md)
- [null](https://docs.polymarket.com/developers/proxy-wallet.md)
- [Resolution](https://docs.polymarket.com/developers/resolution/UMA.md)
- [Message Format](https://docs.polymarket.com/developers/sports-websocket/message-format.md): Structure of sports result update messages
- [Overview](https://docs.polymarket.com/developers/sports-websocket/overview.md): Real-time sports results via WebSocket
- [Quickstart](https://docs.polymarket.com/developers/sports-websocket/quickstart.md): Connect to the Sports WebSocket and receive live updates
- [null](https://docs.polymarket.com/developers/subgraph/overview.md)
- [Does Polymarket have an API?](https://docs.polymarket.com/polymarket-learn/FAQ/does-polymarket-have-an-api.md): Getting data from Polymarket
- [How To Use Embeds](https://docs.polymarket.com/polymarket-learn/FAQ/embeds.md): Adding market embeds to your Substack or website.
- [Geographic Restrictions](https://docs.polymarket.com/polymarket-learn/FAQ/geoblocking.md): Countries and regions where Polymarket is restricted
- [How Do I Export My Key?](https://docs.polymarket.com/polymarket-learn/FAQ/how-to-export-private-key.md): Exporting your private key on Magic.Link
- [Is My Money Safe?](https://docs.polymarket.com/polymarket-learn/FAQ/is-my-money-safe.md): Yes. Polymarket is non-custodial, so you're in control of your funds.
- [Is Polymarket The House?](https://docs.polymarket.com/polymarket-learn/FAQ/is-polymarket-the-house.md): No, Polymarket is not the house. All trades happen peer-to-peer (p2p).
- [Polymarket vs. Polling](https://docs.polymarket.com/polymarket-learn/FAQ/polling.md): How is Polymarket better than traditional / legacy polling?
- [Recover Missing Deposit](https://docs.polymarket.com/polymarket-learn/FAQ/recover-missing-deposit.md): If you deposited the wrong cryptocurrency on Ethereum or Polygon, use these tools to recover those funds.
- [Can I Sell Early?](https://docs.polymarket.com/polymarket-learn/FAQ/sell-early.md)
- [How Do I Contact Support?](https://docs.polymarket.com/polymarket-learn/FAQ/support.md): Polymarket offers technical support through our website chat feature, and through Discord.
- [Does Polymarket Have a Token?](https://docs.polymarket.com/polymarket-learn/FAQ/wen-token.md)
- [What is a Prediction Market?](https://docs.polymarket.com/polymarket-learn/FAQ/what-are-prediction-markets.md): How people collectively forecast the future.
- [Why Crypto?](https://docs.polymarket.com/polymarket-learn/FAQ/why-do-i-need-crypto.md): Why Polymarket uses crypto and blockchain technology to create the world’s largest Prediction market.
- [Deposit with Coinbase](https://docs.polymarket.com/polymarket-learn/deposits/coinbase.md): How to buy and deposit USDC to your Polymarket account using Coinbase.
- [How to Withdraw](https://docs.polymarket.com/polymarket-learn/deposits/how-to-withdraw.md): How to withdraw your cash balance from Polymarket.
- [Large Cross Chain Deposits](https://docs.polymarket.com/polymarket-learn/deposits/large-cross-chain-deposits.md)
- [Deposit Using Your Card](https://docs.polymarket.com/polymarket-learn/deposits/moonpay.md): Use MoonPay to deposit cash using your Visa, Mastercard, or bank account.
- [Deposit by Transfering Crypto](https://docs.polymarket.com/polymarket-learn/deposits/supported-tokens.md): Learn what Tokens and Chains are supported for deposit.
- [Deposit USDC on Ethereum](https://docs.polymarket.com/polymarket-learn/deposits/usdc-on-eth.md): How to deposit USDC on the Ethereum Network to your Polymarket account.
- [How to Deposit](https://docs.polymarket.com/polymarket-learn/get-started/how-to-deposit.md): How to add cash to your balance on Polymarket.
- [How to Sign-Up](https://docs.polymarket.com/polymarket-learn/get-started/how-to-signup.md): How to create a Polymarket account.
- [Making Your First Trade](https://docs.polymarket.com/polymarket-learn/get-started/making-your-first-trade.md): How to buy shares.
- [What is Polymarket?](https://docs.polymarket.com/polymarket-learn/get-started/what-is-polymarket.md)
- [How Are Markets Disputed?](https://docs.polymarket.com/polymarket-learn/markets/dispute.md)
- [How Are Markets Clarified?](https://docs.polymarket.com/polymarket-learn/markets/how-are-markets-clarified.md): How are markets on Polymarket clarified?
- [How Are Markets Created?](https://docs.polymarket.com/polymarket-learn/markets/how-are-markets-created.md): Markets are created by the markets team with input from users and the community.
- [How Are Prediction Markets Resolved?](https://docs.polymarket.com/polymarket-learn/markets/how-are-markets-resolved.md): Markets are resolved by the UMA Optimistic Oracle, a smart-contract based optimistic oracle.
- [Trading Fees](https://docs.polymarket.com/polymarket-learn/trading/fees.md)
- [Holding Rewards](https://docs.polymarket.com/polymarket-learn/trading/holding-rewards.md)
- [How Are Prices Calculated?](https://docs.polymarket.com/polymarket-learn/trading/how-are-prices-calculated.md): The prices probabilities displayed on Polymarket are the midpoint of the bid-ask spread in the orderbook.
- [Limit Orders](https://docs.polymarket.com/polymarket-learn/trading/limit-orders.md): What are limit orders and how to make them.
- [Liquidity Rewards](https://docs.polymarket.com/polymarket-learn/trading/liquidity-rewards.md): Learn how to earn rewards merely by placing trades on Polymarket
- [Maker Rebates Program](https://docs.polymarket.com/polymarket-learn/trading/maker-rebates-program.md)
- [Market Orders](https://docs.polymarket.com/polymarket-learn/trading/market-orders.md): How to buy shares.
- [Does Polymarket Have Trading Limits?](https://docs.polymarket.com/polymarket-learn/trading/no-limits.md)
- [Using the Order Book](https://docs.polymarket.com/polymarket-learn/trading/using-the-orderbook.md): Understanding the Order Book will help you become an advanced trader.
- [Fetching Market Data](https://docs.polymarket.com/quickstart/fetching-data.md): Fetch Polymarket data in minutes with no authentication required
- [Placing Your First Order](https://docs.polymarket.com/quickstart/first-order.md): Set up authentication and submit your first trade
- [API Rate Limits](https://docs.polymarket.com/quickstart/introduction/rate-limits.md)
- [Developer Quickstart](https://docs.polymarket.com/quickstart/overview.md): Get started building with Polymarket APIs
- [Endpoints](https://docs.polymarket.com/quickstart/reference/endpoints.md): All Polymarket API URLs and base endpoints
- [Glossary](https://docs.polymarket.com/quickstart/reference/glossary.md): Key terms and concepts for Polymarket developers
- [WSS Quickstart](https://docs.polymarket.com/quickstart/websocket/WSS-Quickstart.md)


## Optional

- [Polymarket](https://polymarket.com)
- [Discord Community](https://discord.gg/polymarket)
- [Twitter](https://x.com/polymarket)