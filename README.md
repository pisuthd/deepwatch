# DeepWatch — The Intelligence Layer for DeepBook

> DeepWatch uses live SVI oracle data, Polymarket & Kalshi odds via Tatum API — distilled into AI insights and published to Walrus for trading on all DeepBook markets (Spot, Margin, Predict).

<img width="830" height="379" alt="Screenshot 2026-06-05 131223" src="https://github.com/user-attachments/assets/a53e86cc-b1c0-4f4b-bb4e-691dc7a6e517" />

## What is DeepWatch

**DeepWatch** is a unified trading terminal for all DeepBook markets — Spot, Margin, and Predict. We use AI to convert complex on-chain SVI data, enriched with Polymarket and Kalshi odds via Tatum API, into actionable insights for confident trading. All insights are shared on Walrus for the community to verify and reference.

[DeepBook Predict](https://docs.sui.io/onchain-finance/deepbook-predict/) is Sui's institutional-grade prediction market with:

- **Block Scholes oracle** for institutional pricing
- **Sub-400ms settlement** — fast enough to feel like a game
- **Internal market maker** provides liquidity from day one
- **All positions composable** with deep shared liquidity

The data is powerful but hard to understand. **DeepWatch** bridges that gap by turning those SVI signals into plain-language insights as well as enriches with real-time odds from other prediction markets that you can act on.

---

## Highlight Features

- **Unified DeepBook trading terminal** — spot swaps, margin manager, and predict markets from the battle-tested DeepBook V3 stack, with a live candlestick chart, all under one terminal.
- **DeepBook Predict, the easy way in** — Sui's new institutional-grade prediction markets (Block Scholes oracle pricing) ship dense data. DeepWatch turns it into plain-language analysis  so you can be early with clear, actionable insights instead of raw data.
- **AI insights, published on Walrus** — combine SVI data, prediction market odds, and external signals into structured insights on Walrus via Tatum Storage API.
- **Tatum-powered data layer** — Polymarket & Kalshi odds, Walrus upload/list, and Sui gRPC endpoints flow through a single API layer for faster integration and fewer moving parts.

## Tech stack

| Layer | What's used |
| --- | --- |
| Frontend | Next.js 16.2.6 · React 19.2.4 · TypeScript 5 · Tailwind v4 · `@mysten/dapp-kit-react` · `@mysten/deepbook-v3` · `@mysten/sui` (`SuiGrpcClient`) · framer-motion · lucide-react · lightweight-charts · react-markdown |
| DeepBook | DeepBook V3 — Spot, Margin, and Predict markets on Sui |
| Network | Sui mainnet (Spot) · Sui testnet (Spot, Predict) |
| AI | Anthropic Claude 4.6 · MiniMax M3 (Anthropic-compatible) |
| Tatum API | Sui gRPC endpoints · Storage API for Walrus · Prediction API · Price and Exchange Rate API |

---

## Quick start

<img width="747" height="328" alt="Screenshot 2026-06-05 125554" src="https://github.com/user-attachments/assets/0961d34c-0bad-45ad-b154-a7eb332db62a" />

1. **Open the terminal** — pick **Spot** or **Predict** from the sidebar. Both run in the same interface.

<img width="758" height="328" alt="Screenshot 2026-06-05 130331" src="https://github.com/user-attachments/assets/4896e3f8-f577-43bd-bdbe-1f97727b6b49" />

2. **Pick a market view** — every surface has a simple mode for fast trades and an advanced mode with a live candlestick chart and a real-time price feed from the Block Scholes oracle.

<img width="768" height="371" alt="Screenshot 2026-06-05 105351" src="https://github.com/user-attachments/assets/83d83a16-317b-4d6b-aa8c-dcd759601c81" />

3. **Read the latest insights** — tap the **Insights** button on any market to see the most recent AI analysis tied to that asset and window. Insights come from the community feed published to Walrus.

<img width="752" height="320" alt="Screenshot 2026-06-05 130449" src="https://github.com/user-attachments/assets/8bc84748-acf4-4c5f-9bb7-dc76bf4f9136" />

4. **Trade.**
   - **Spot** — swap tokens on Sui mainnet at the displayed rate. Tokens settle in the same block.
   - **Predict** — pick **Up** or **Down**, set a strike price, and mint your position. After the market expires, redeem if you were on the winning side.

<img width="591" height="301" alt="Screenshot 2026-06-05 130709" src="https://github.com/user-attachments/assets/bbf0902c-88c5-44fc-bc8c-d0cffe0d3946" />

5. **Create a new insight** — if no existing insight matches your window or asset, jump to **Add Insight**, pick your data sources (Oracle SVI, Polymarket odds, Kalshi tickers), and let the AI compose an analysis. Tatum handles the Walrus upload in the background — wait a few seconds, and your insight is published.

<img width="757" height="334" alt="Screenshot 2026-06-05 130546" src="https://github.com/user-attachments/assets/a91319e2-b790-4741-a728-d0c69102f99c" />

One terminal, three markets, and an AI co-pilot that turns dense oracle data into trades you can act on.

---

## For developers

### Local setup

```bash
git clone <your fork url>
cd deepwatch
npm install
cp .env.example .env       # then fill in your keys
npm run dev
```

Open `http://localhost:3000`. The dev server uses HMR.

### Environment variables

All values are placeholders. The canonical, runnable template lives in [`.env.example`](.env.example) (which is committed). Your real `.env` is gitignored.

| Env var | Purpose |
| --- | --- | 
| `NEXT_PUBLIC_TESTNET_GRPC` | Sui testnet gRPC endpoint (Tatum gateway) | 
| `NEXT_PUBLIC_MAINNET_GRPC` | Sui mainnet gRPC endpoint (Tatum gateway) |
| `NEXT_PUBLIC_TATUM_API_KEY` | Tatum API key — used for Walrus upload/list and Polymarket/Kalshi search | 
| `MINIMAX_API_KEY` | MiniMax Anthropic-compatible API key (insight generation) | 
| `MINIMAX_BASE_URL` | MiniMax base URL — override only if you proxy | 
| `MINIMAX_MODEL` | MiniMax model id. Default: `MiniMax-M3` | 
| `MINIMAX_THINKING_BUDGET` | Optional extended-thinking budget in tokens. Set to `0` to disable. Default: `2048` |

Notes:

- `.env` is gitignored; the committed template is [`.env.example`](.env.example).
- Tatum gRPC URLs and `NEXT_PUBLIC_TATUM_API_KEY` ship to the browser by design — Tatum is CORS-allowed for client-direct calls.
- `MINIMAX_*` env vars must **never** be `NEXT_PUBLIC_*`. They are consumed only inside [`app/api/insights/generate/route.ts`](app/api/insights/generate/route.ts).

### npm scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server (HMR) |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint with `eslint-config-next` (core-web-vitals + typescript) |

There is **no `typecheck` script**. Type-checking is available via `npx tsc --noEmit` (the `tsconfig.json` has `"noEmit": true`).

### Project structure

```
deepwatch/
├── app/
│   ├── app/                # App Router pages — /app/spot, /app/predict, /app/margin, /app/add-insight, /app/recent-insights
│   ├── components/         # Reusable UI (common, layout, per-page)
│   ├── hooks/              # useDeepbook, usePredict, useSVI, useMarkets, ...
│   ├── landing/            # Public marketing site (/)
│   ├── lib/                # tatum, insights, polymarket, minimax, networkConfig
│   └── api/insights/       # Server route — streaming MiniMax proxy
├── .env.example            # Canonical env template (committed)
├── next.config.ts          # Remote image patterns
└── tsconfig.json           # Strict TS, paths @/* → ./*
```

---

## License

MIT.
