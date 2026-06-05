# DeepWatch

> The intelligence layer for DeepBook — an AI-augmented trading UI for Sui's DeepBook V3, with on-chain SVI surface data, Polymarket odds, and Kalshi tickers distilled into a markdown insight and pinned to Walrus.

DeepWatch is a Sui-native web app that bundles three on-chain trading surfaces (spot, predict/binary options, margin) with a generative-AI insight feed. The insights are built in-app from real market state, streamed through a MiniMax model, and persisted as blobs on Walrus via Tatum so they're readable later from any client.

---

## What is DeepWatch

**For traders.** DeepWatch gives you a single pane of glass over DeepBook V3 pools, DeepBook Predict binary options, and DeepBook margin — with an Insight button in the corner of every trading page that opens a feed of AI-generated market analyses. Each insight pulls in the SVI implied-vol surface for the current asset, the closest Polymarket markets, and any matching Kalshi tickers, so the prose is anchored in concrete numbers.

**For analysts.** The Add Insight wizard is a five-step composition surface: pick a title, attach a predict snapshot, attach Polymarket markets, attach Kalshi tickers, and let the model write the analysis. The result is published to Walrus and shows up on the Recent Insights page, where you can re-check the body, deep-link to the raw JSON, or revisit the underlying data sources.

**For the curious.** Every insight body is a self-contained JSON blob with a deterministic filename (`insight-{ASSET}-{timestamp}.json`), so anyone with a Walrus aggregator can verify what the model said against the inputs it had.

---

## Features

- **Spot trading** — DeepBook V3 pool swap, simple and advanced modes, candlestick chart. Route: [`/app/spot`](app/app/spot/page.tsx).
- **Predict markets** — binary up/down options on DeepBook Predict with a live strike grid. Route: [`/app/predict`](app/app/predict/page.tsx). *Note: the underlying `predict-server` is testnet-only; mainnet users see a warning toast.*
- **Margin** — DeepBook margin-manager flow, simple and advanced modes. Route: [`/app/margin`](app/app/margin/page.tsx).
- **AI insights** — a 5-step wizard ([`/app/add-insight`](app/app/add-insight/page.tsx)) composes a markdown analysis from on-chain SVI surface data, Polymarket odds, and Kalshi tickers, then publishes the blob to Walrus via Tatum. The streaming model runs through `MiniMax` (Anthropic-compatible SSE) using the `MiniMax-M3` default model.
- **Recent insights** — [`/app/recent-insights`](app/app/recent-insights/page.tsx) reads live from Tatum's Walrus list endpoint and lazily fetches full bodies.
- **Network switching** — mainnet ↔ testnet, persisted to `localStorage`. The wallet switcher is in the top bar.
- **Glass-morphism UI** — Tailwind v4 with a custom `@theme` block in [`app/globals.css`](app/globals.css) defining the neon-green primary (`#00E68A`), electric-blue secondary, and the Orbitron / Space Grotesk / Inter font stack.

## Tech stack

- **Framework** — [Next.js](https://nextjs.org) 16.2.6 (see "Conventions" — this project pins a vendored build, not the upstream release) with the App Router, plus React 19.2.4.
- **Language** — TypeScript 5, strict mode, `moduleResolution: "bundler"`, `@/*` path alias.
- **Styling** — Tailwind CSS v4 with a single `@import "tailwindcss"` and a custom `@theme` block.
- **Sui SDKs** — `@mysten/dapp-kit-react`, `@mysten/deepbook-v3`, `@mysten/sui` (`SuiGrpcClient`).
- **AI** — `MiniMax` (Anthropic-compatible Messages API). The server route streams SSE; the client parses it incrementally.
- **Storage** — Walrus via Tatum (browser-direct read paths, single `POST` for upload).
- **UI** — `framer-motion` 12, `lucide-react`, `lightweight-charts` 5, `react-markdown` 10 + `remark-gfm` 4.
- **State** — React Context only ([`NetworkContext`](app/context/NetworkContext.tsx), [`ToastContext`](app/context/ToastContext.tsx)). No Redux or Zustand.
- **Tooling** — ESLint 9 (flat config, `eslint-config-next`), pnpm workspace config, no test framework configured.

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
| `/app/settings` | App settings |
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
