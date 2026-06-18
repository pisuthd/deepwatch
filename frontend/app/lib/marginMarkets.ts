// Margin markets data. Two flavors:
//  - `HARDCODED_TESTNET_MARGIN_MARKETS` — last-known-good testnet pool list,
//    used as a fallback if the indexer is unreachable.
//  - `MAINNET_MARGIN_MARKETS` — last-known-good mainnet pool list (empty for
//    now because mainnet margin pools change over time and the indexer is the
//    source of truth).
//  - `MARGIN_MARKETS: Record<Network, MarginMarket[]>` — convenience export so
//    consumers can pick the right list per network without hard-coding the key.
//
// The live source is `useMarginMarkets()` (hooks/useMarginMarkets.ts), which
// fetches `/margin_managers_info` from the DeepBook indexer and dedupes by
// `deepbookPoolId`. UI components should prefer the hook over the hardcoded
// lists; the hardcoded lists are a resilience fallback only.

import type { Network } from '../context/NetworkContext';

export interface MarginMarket {
  /** Display name: "DEEP/SUI" */
  market: string;
  /** Base asset symbol, e.g. "DEEP" */
  baseAssetSymbol: string;
  /** Quote asset symbol, e.g. "SUI" */
  quoteAssetSymbol: string;
  /** Full coin type string, e.g. "0x...::deep::DEEP" */
  baseAssetId: string;
  /** Full coin type string, e.g. "0x...::sui::SUI" */
  quoteAssetId: string;
  /** DeepBook V3 pool object id. */
  deepbookPoolId: string;
  /** Base-asset margin pool object id. */
  baseMarginPoolId: string;
  /** Quote-asset margin pool object id. */
  quoteMarginPoolId: string;

  // ---- Rich market data (populated by useMarginMarkets from indexer) ----
  /** Base asset decimals, e.g. 6 for DBUSDC. */
  baseAssetDecimals?: number;
  /** Quote asset decimals, e.g. 9 for SUI. */
  quoteAssetDecimals?: number;
  /** Last trade price, in quote units per 1 base. */
  lastPrice?: number;
  /** 24h price change as a fraction (0.0123 == +1.23%). */
  change24h?: number;
  /** 24h base volume. */
  baseVolume?: number;
  /** 24h quote volume. */
  quoteVolume?: number;
  /** Highest traded price in the last 24h. */
  highestPrice24h?: number;
  /** Lowest traded price in the last 24h. */
  lowestPrice24h?: number;
  /** Best ask (lowest sell price) from the last summary. */
  lowestAsk?: number;
  /** Best bid (highest buy price) from the last summary. */
  highestBid?: number;
  /** Taker fee rate (e.g. 0.0005 == 5 bps). */
  takerFee?: number;
  /** Maker fee rate (e.g. 0.0002 == 2 bps). */
  makerFee?: number;
  /** Stake required to open a margin manager for this pool (raw, in MIST). */
  stakeRequired?: number;
  /** Whether the pool is frozen (no new positions). */
  isFrozen?: boolean;
}

export const HARDCODED_TESTNET_MARGIN_MARKETS: MarginMarket[] = [
  {
    market: "DEEP/SUI",
    baseAssetSymbol: "DEEP",
    quoteAssetSymbol: "SUI",
    baseAssetId: "0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP",
    quoteAssetId: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
    deepbookPoolId: "0x48c95963e9eac37a316b7ae04a0deb761bcdcc2b67912374d6036e7f0e9bae9f",
    baseMarginPoolId: "0x610640613f21d9e688d6f8103d17df22315c32e0c80590ce64951a1991378b55",
    quoteMarginPoolId: "0xcdbbe6a72e639b647296788e2e4b1cac5cea4246028ba388ba1332ff9a382eea",
  },
  {
    market: "SUI/DBUSDC",
    baseAssetSymbol: "SUI",
    quoteAssetSymbol: "DBUSDC",
    baseAssetId: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
    quoteAssetId: "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC",
    deepbookPoolId: "0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5",
    baseMarginPoolId: "0xcdbbe6a72e639b647296788e2e4b1cac5cea4246028ba388ba1332ff9a382eea",
    quoteMarginPoolId: "0xf08568da93834e1ee04f09902ac7b1e78d3fdf113ab4d2106c7265e95318b14d",
  },
  {
    market: "DEEP/DBUSDC",
    baseAssetSymbol: "DEEP",
    quoteAssetSymbol: "DBUSDC",
    baseAssetId: "0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP",
    quoteAssetId: "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC",
    deepbookPoolId: "0xe86b991f8632217505fd859445f9803967ac84a9d4a1219065bf191fcb74b622",
    baseMarginPoolId: "0x610640613f21d9e688d6f8103d17df22315c32e0c80590ce64951a1991378b55",
    quoteMarginPoolId: "0xf08568da93834e1ee04f09902ac7b1e78d3fdf113ab4d2106c7265e95318b14d",
  },
  {
    market: "DBTC/DBUSDC",
    baseAssetSymbol: "DBTC",
    quoteAssetSymbol: "DBUSDC",
    baseAssetId: "0x6502dae813dbe5e42643c119a6450a518481f03063febc7e20238e43b6ea9e86::dbtc::DBTC",
    quoteAssetId: "0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC",
    deepbookPoolId: "0x0dce0aa771074eb83d1f4a29d48be8248d4d2190976a5241f66b43ec18fa34de",
    baseMarginPoolId: "0xf3440b4aafcc8b12fc4b242e9590c52873b8238a0d0e52fbf9dae61d2970796a",
    quoteMarginPoolId: "0xf08568da93834e1ee04f09902ac7b1e78d3fdf113ab4d2106c7265e95318b14d",
  },
];

/**
 * Mainnet fallback list. The DeepBook indexer is the source of truth for
 * mainnet margin pools — this list is intentionally empty so the indexer
 * fetch has priority; if the indexer is down the UI just shows "no markets
 * available" instead of a stale hardcoded list.
 */
export const MAINNET_MARGIN_MARKETS: MarginMarket[] = [];

/** Per-network map. Consumers should pick `MARGIN_MARKETS[network]`. */
export const MARGIN_MARKETS: Record<Network, MarginMarket[]> = {
  testnet: HARDCODED_TESTNET_MARGIN_MARKETS,
  mainnet: MAINNET_MARGIN_MARKETS,
};
