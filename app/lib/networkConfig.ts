/**
 * Per-network config for the deepwatch app.
 *
 * Single source of truth for RPC URLs, off-chain indexer URLs, package IDs, and
 * coin types. Driven by `useNetwork()` from `app/context/NetworkContext.tsx`.
 *
 * `predictServer` is `null` on mainnet because Mysten has not (yet) published
 * a public mainnet predict server. Predict UI surfaces a "testnet only" notice
 * when this is `null`.
 */

import type { Network } from '../context/NetworkContext';

export const SUI_TYPE =
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

export const CLOCK_ID = '0x6';

export interface NetworkConfig {
  /** gRPC base URL for `SuiGrpcClient` (used by dapp-kit + DeepBook SDK). */
  fullnodeGrpc: string;
  /** Predict protocol indexer. `null` on mainnet. */
  predictServer: string | null;
  /** DeepBook V3 indexer. */
  deepbookIndexer: string;
  /** On-chain package IDs. */
  packages: {
    deepbookV3: string;
    balanceManager: string;
  };
  /** Coin type strings per asset. Missing assets should be added per-network as needed. */
  coins: {
    SUI: string;
    USDC: string;
    DBUSDC: string | null;
    DEEP: string;
  };
  /** Pool keys to feature by default in the simple-mode pair selector. */
  defaultPools: string[];
}

export const NETWORKS: Record<Network, NetworkConfig> = {
  testnet: {
    fullnodeGrpc: 'https://fullnode.testnet.sui.io:443',
    predictServer: 'https://predict-server.testnet.mystenlabs.com',
    deepbookIndexer: 'https://deepbook-indexer.testnet.mystenlabs.com',
    packages: {
      // Resolved at runtime by `@mysten/deepbook-v3` SDK (`client.deepbook.poolId(poolKey)`).
      deepbookV3: '',
      balanceManager: '',
    },
    coins: {
      SUI: SUI_TYPE,
      USDC: '0x4f1d0a9c5b1f0e6b1d6e9a3a1c4b5b2e0d3c6f4a8e2b1c0d5e4f3a2b1c0d6e7f::usdc::USDC',
      DBUSDC: '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC',
      DEEP: '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP',
    },
    defaultPools: ['SUI_DBUSDC', 'DEEP_USDC', 'SUI_USDC'],
  },
  mainnet: {
    fullnodeGrpc: 'https://fullnode.mainnet.sui.io:443',
    predictServer: null,
    deepbookIndexer: 'https://deepbook-indexer.mainnet.mystenlabs.com',
    packages: {
      deepbookV3: '',
      balanceManager: '',
    },
    coins: {
      SUI: SUI_TYPE,
      // Mainnet native USDC type — confirm against Mysten docs at integration time.
      USDC: '0xdba34672e30cb065b1f93e3ab5531877fd33825a21d9b1c0a8b4d8b3e8a2d3c5::usdc::USDC',
      // DBUSDC is a testnet-only token; no mainnet equivalent in v1.
      DBUSDC: null,
      DEEP: '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP',
    },
    defaultPools: ['SUI_USDC', 'DEEP_SUI', 'DEEP_USDC', 'WUSDT_USDC', 'BETH_USDC'],
  },
};
