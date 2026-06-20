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
  /**
   * Predict protocol wiring. All three fields are `null` on mainnet because
   * Mysten has not (yet) published a public mainnet predict server/package.
   * `packageId` is the Move package; `objectId` is the shared `PREDICT`
   * object; `dusdcType` is the `0x...::dusdc::DUSDC` coin type. `usePredict`
   * falls back to a "testnet only" error when any of these is null.
   */
  predict: {
    packageId: string | null;
    objectId: string | null;
    dusdcType: string | null;
  };
  /**
   * DeepWatch second-layer staking + lending pool wiring (see
   * `contracts/sources/pool.move`). `packageId` is the
   * `deepwatch` Move package; `poolObjectId` is the shared `Pool`
   * object that every staker/borrower interacts with; `poolCapId` is
   * the admin `PoolCap` (transferred to the deployer's wallet on
   * `init_pool`) used for `set_ltv_bps` / `set_borrow_rate_bps` /
   * `admin_seed_borrow`. All `null` on mainnet — the package is a
   * hackathon v1 and only published to testnet. The Seal encryption
   * pattern keys off `poolObjectId` (the key-id namespace is the
   * pool's bytes), so changing the pool object ID invalidates all
   * in-flight encrypted blobs.
   */
  deepwatch: {
    packageId: string | null;
    poolObjectId: string | null;
    poolCapId: string | null;
    /** PLP coin type produced by `predict::supply<DUSDC>`. */
    plpCoinType: string | null;
    /** Default stake duration the stake page pre-fills (ms). 30 days. */
    defaultStakeDurationMs: number;
  };
  /** Pool keys to feature by default in the simple-mode pair selector. */
  defaultPools: string[];
}

export const NETWORKS: Record<Network, NetworkConfig> = {
  testnet: {
    fullnodeGrpc: process.env.NEXT_PUBLIC_TESTNET_GRPC || 'https://fullnode.testnet.sui.io:443',
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
    predict: {
      packageId: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138',
      objectId: '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a',
      dusdcType: '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC',
    },
    deepwatch: {
      // Package `0x3816ac1…8c0c5` was published from `contracts/`
      // (modules `pool`, `subscription`) after adding the `init_pool`
      // entry wrapper. The Pool shared object (`0xec06…177f`) and the
      // admin PoolCap (`0xb1de…e26c`) were both created by the
      // `init_pool` tx (digest `2Bke3wZ…ghDN`, epoch 1135). The cap
      // lives in the deployer wallet and is what you'd pass to future
      // `set_ltv_bps` / `set_borrow_rate_bps` / `admin_seed_borrow`
      // calls.
      packageId: '0x3816ac19825e2da1715e5fa937ef8a800a0dca4071e5e732b18af0b56e68c0c5',
      poolObjectId: '0xec062bb23a7672d461a13666d7a698b092175e852ff871676ed22ca75708177f',
      poolCapId: '0xb1deec52a1d9838256b1f7e2f83acf505cee98c92195be044a493b28daa9e26c',
      plpCoinType: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::plp::PLP',
      defaultStakeDurationMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
    defaultPools: ['SUI_DBUSDC', 'DEEP_USDC', 'SUI_USDC'],
  },
  mainnet: {
    fullnodeGrpc: process.env.NEXT_PUBLIC_MAINNET_GRPC || 'https://fullnode.mainnet.sui.io:443',
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
    predict: {
      packageId: null,
      objectId: null,
      dusdcType: null,
    },
    deepwatch: {
      packageId: null,
      poolObjectId: null,
      poolCapId: null,
      plpCoinType: null,
      defaultStakeDurationMs: 30 * 24 * 60 * 60 * 1000,
    },
    defaultPools: ['SUI_USDC', 'DEEP_SUI', 'DEEP_USDC', 'WUSDT_USDC', 'BETH_USDC'],
  },
};
