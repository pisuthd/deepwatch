# DeepWatch — The Intelligence Layer for DeepBook

> DeepWatch uses live SVI oracle data, Polymarket & Kalshi odds via Tatum API — distilled into AI insights and published to Walrus for trading on all DeepBook markets (Spot, Margin, Predict).

DeepWatch is a Sui-native web app that bundles three on-chain trading surfaces (Spot, Margin, Predict) with a generative-AI insight feed. The insights are built from live SVI oracle data, enriched with Polymarket odds and Kalshi tickers via Tatum API, streamed through a MiniMax model, and persisted as blobs on Walrus so they're readable later from any client.

---

## What is DeepWatch

**DeepWatch** is a unified trading terminal for all DeepBook markets — Spot, Margin, and Predict. We use AI to convert complex on-chain SVI data, enriched with Polymarket and Kalshi odds via Tatum API, into actionable insights for confident trading. All insights are shared on Walrus for the community to verify and reference.

[DeepBook Predict](https://docs.sui.io/onchain-finance/deepbook-predict/) introduced institutional-grade prediction markets powered by Block Scholes oracle, but understanding the data isn't easy. DeepWatch bridges that gap — letting AI translate complex market signals into plain language anyone can act on.

---

## Highlight Features

- **Production-ready DeepBook trading** — spot swaps, margin manager, and predict markets from the battle-tested DeepBook V3 stack, with a live candlestick chart, all under one terminal.
- **DeepBook Predict, the easy way in** — Sui's new institutional-grade prediction markets (Block Scholes oracle pricing) ship dense data. DeepWatch turns it into plain-language insights so you can be early without the legwork.
- **AI insights, published on Walrus** — a 5-step wizard composes a markdown analysis from on-chain SVI surface data, Polymarket odds, and Kalshi tickers, then publishes the blob for the community to verify and reference.
- **Tatum-powered data layer** — Polymarket & Kalshi odds, Walrus upload/list, and Sui gRPC endpoints flow through Tatum APIs — one vendor, one key, no glue code.

## Tech stack

| Layer | What's used |
| --- | --- |
| Frontend | Next.js 16.2.6 · React 19.2.4 · TypeScript 5 · Tailwind v4 · `@mysten/dapp-kit-react` · `@mysten/deepbook-v3` · `@mysten/sui` (`SuiGrpcClient`) · framer-motion · lucide-react · lightweight-charts · react-markdown |
| DeepBook | DeepBook V3 — Spot, Margin, and Predict markets on Sui |
| Network | Sui mainnet (Spot) · Sui testnet (Spot, Predict) |
| AI | Anthropic Claude 4.6 · MiniMax M3 (Anthropic-compatible) |
| Tatum API | Sui gRPC endpoints · Storage API for Walrus · Prediction API · Price and Exchange Rate API |

---

## For developers

### Quick start

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

| Env var | Purpose | Server / Client |
| --- | --- | --- |
| `NEXT_PUBLIC_TESTNET_GRPC` | Sui testnet gRPC endpoint (Tatum gateway) | client |
| `NEXT_PUBLIC_MAINNET_GRPC` | Sui mainnet gRPC endpoint (Tatum gateway) | client |
| `NEXT_PUBLIC_TATUM_API_KEY` | Tatum API key — used for Walrus upload/list and Polymarket/Kalshi search | client |
| `MINIMAX_API_KEY` | MiniMax Anthropic-compatible API key (insight generation) | **server only** |
| `MINIMAX_BASE_URL` | MiniMax base URL — override only if you proxy | **server only** |
| `MINIMAX_MODEL` | MiniMax model id. Default: `MiniMax-M3` | **server only** |
| `MINIMAX_THINKING_BUDGET` | Optional extended-thinking budget in tokens. Set to `0` to disable. Default: `2048` | **server only** |

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
│   ├── app/                # App Router pages (authenticated shell: /app/spot, /predict, /margin, ...)
│   ├── components/         # Reusable UI: common/, layout/, pages/{spot,predict,margin,insights,add-insight}
│   ├── context/            # NetworkContext, ToastContext
│   ├── hooks/              # useDeepbook, usePredict, useSVI, useMarkets, useSpotPools, useMarginMarkets, ...
│   ├── landing/            # Public marketing site served at /
│   ├── lib/                # tatum, insights, polymarket, minimax, networkConfig, marginMarkets, coinIcons
│   ├── types/              # navigation.ts (sidebar source of truth)
│   ├── api/insights/       # Server route: streaming MiniMax proxy
│   ├── layout.tsx          # Root layout (fonts, metadata, providers)
│   ├── page.tsx            # Renders the landing page
│   └── providers.tsx       # DAppKitProvider → NetworkProvider → ToastProvider
├── public/                 # Static assets (empty)
├── next.config.ts          # Remote image patterns (CoinMarketCap, Sui bridge, suins.io)
├── tsconfig.json           # Strict TS, paths @/* → ./*, moduleResolution: "bundler"
├── pnpm-workspace.yaml     # allowBuilds: sharp, unrs-resolver
├── eslint.config.mjs       # ESLint 9 flat config (core-web-vitals + typescript)
└── postcss.config.mjs      # @tailwindcss/postcss
```

### Available routes

| Route | Description |
| --- | --- |
| `/` | Public marketing/landing page |
| `/app/spot` | DeepBook V3 spot swap (simple + advanced) |
| `/app/predict` | DeepBook Predict binary options (testnet only) |
| `/app/margin` | DeepBook margin manager (simple + advanced) |
| `/app/add-insight` | 5-step wizard that publishes an AI insight to Walrus |
| `/app/recent-insights` | Browse and read past published insights |
| `/app/download-agent` | Download AI trading agent (coming soon) |
| `/api/insights/generate` | `POST` — server-proxied streaming MiniMax completion |

### Conventions & gotchas

- **Vendored Next.js** — this project pins a custom build of Next.js (16.2.6) with API changes from upstream. The canonical reference is `node_modules/next/dist/docs/` (per [`AGENTS.md`](AGENTS.md)), not nextjs.org. Heed deprecation notices there.
- **Single project, mixed folders** — `app/app/` is the authenticated App Router; `app/landing/` is the public marketing site. The root `app/page.tsx` renders the landing page.
- **State** — Context only, no Redux/Zustand. New global state should be added under `app/context/`.
- **Styling** — Tailwind v4 with a custom `@theme` block in [`app/globals.css`](app/globals.css). Prefer the CSS variables (`--color-accent-primary`, `--color-bg-elevated`, `--color-border-default`) for theming.
- **Insight data** — body shape, filename convention (`insight-{ASSET}-{timestamp}.json`, 100 KB cap), and helper functions live in [`app/lib/insights.ts`](app/lib/insights.ts).
- **Walrus / Tatum** — all calls are browser-direct from [`app/lib/tatum.ts`](app/lib/tatum.ts). No server proxy for read paths.
- **AI generation** — the streaming proxy lives in [`app/api/insights/generate/route.ts`](app/api/insights/generate/route.ts). The client SSE parser is in [`app/lib/minimax.ts`](app/lib/minimax.ts).
- **No test framework** — there is no Jest / Vitest / Playwright configured. Add one if you need it.

### Known limitations

- **Account Overview is a stub** — [`/app/account-overview`](app/app/account-overview/page.tsx) renders a placeholder page.
- **Predict is testnet-only** — the underlying `predict-server` is testnet; the page surfaces a warning toast for mainnet users.
- **No test suite** — the project ships with no test framework configured.

---

## License

<!-- TODO: confirm license -->

MIT.
