/**
 * useDefaultSpotPool - Auto-select a default DeepBook spot pool.
 *
 * When the user lands on the Spot page (simple or advanced mode) and no
 * pool has been chosen yet, this hook writes a sensible default into the
 * shared `CurrentPoolContext` so the chart, swap card, and price stats
 * mount on first paint.
 *
 * - Mainnet: prefers `XBTC_USDC` (the headline BTC pair), falling back to
 *   the first pool in the list.
 * - Testnet: falls back to the first pool in the list (the testnet default
 *   varies by season).
 *
 * Shared by `SpotSimpleMode` and `SpotAdvancedMode` so the two views stay
 * in lockstep and neither can drift.
 */

import { useEffect } from 'react';
import {
  useCurrentPool,
  useSetCurrentPool,
} from '../components/pages/spot/CurrentPoolContext';
import { useNetwork } from '../context/NetworkContext';
import type { SpotPool } from './useSpotPools';

export function useDefaultSpotPool(pools: SpotPool[]): void {
  const { poolKey } = useCurrentPool();
  const setCurrentPool = useSetCurrentPool();
  const { network } = useNetwork();

  useEffect(() => {
    if (poolKey || pools.length === 0) return;
    const preferred =
      network === 'mainnet'
        ? pools.find((p) => p.poolName === 'XBTC_USDC') ?? pools[0]
        : pools[0];
    setCurrentPool({
      poolKey: preferred.poolName,
      baseAsset: preferred.baseAsset,
      quoteAsset: preferred.quoteAsset,
      baseAssetId: preferred.baseAssetId,
      quoteAssetId: preferred.quoteAssetId,
      baseAssetDecimals: preferred.baseAssetDecimals,
      quoteAssetDecimals: preferred.quoteAssetDecimals,
    });
  }, [poolKey, pools, setCurrentPool, network]);
}
