'use client';

/**
 * `useDeepWatchPool` — polls the live state of the DeepWatch second-
 * layer staking pool. Mirrors the cadence of `useMarkets` (30 s).
 *
 * # State surface
 *
 *   `snapshot`  — the most recent `PoolSnapshot` (see
 *                 `lib/deepwatch-pool.ts`) or `null` if no data yet /
 *                 pool not deployed on this network.
 *   `lastFetched` — Unix ms of the last successful fetch (or `null`).
 *   `isReady`   — true after the first fetch completes (success OR
 *                 the explicit null return).
 *   `refresh()` — manual refetch. Same callback ref to keep consumer
 *                 `useEffect` deps stable.
 *
 * # Why a hook
 *
 * The pool state is read-only and poll-driven, exactly like
 * `useMarkets`. Centralising the polling here means every consumer
 * (stake page VaultStats, BorrowPanel, UseStake) sees the same
 * numbers without each spinning their own timer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNetworkConfig } from './useNetworkConfig';
import { fetchPoolSnapshot, type PoolSnapshot } from '../lib/deepwatch-pool';

const POLL_INTERVAL_MS = 30_000;

export interface UseDeepWatchPoolResult {
  snapshot: PoolSnapshot | null;
  lastFetched: number | null;
  isReady: boolean;
  refresh: () => Promise<void>;
  /** True if the network config is missing the pool object ID. */
  isConfigured: boolean;
}

export function useDeepWatchPool(): UseDeepWatchPoolResult {
  const cfg = useNetworkConfig();
  const poolId = cfg.deepwatch.poolObjectId;
  const isConfigured = poolId !== null;
  // Strip the gRPC port suffix if present (matches usePredict's convention).
  const rpcUrl = cfg.fullnodeGrpc.replace(/:443$/, '');

  const [snapshot, setSnapshot] = useState<PoolSnapshot | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);

  // Stale-flag guard so a slow response from a previous poll can't
  // overwrite a fresher one. `cancelledRef` only matters for the
  // mount-time fetch — interval polls use a simpler `setSnapshot`.
  const cancelledRef = useRef<boolean>(false);

  const refresh = useCallback(async () => {
    if (!poolId) {
      setSnapshot(null);
      setIsReady(true);
      setLastFetched(null);
      return;
    }
    const next = await fetchPoolSnapshot(rpcUrl, poolId);
    if (cancelledRef.current) return;
    setSnapshot(next);
    setLastFetched(Date.now());
    setIsReady(true);
  }, [poolId, rpcUrl]);

  useEffect(() => {
    cancelledRef.current = false;
    // Schedule the initial fetch via setTimeout so it lands inside an
    // event-handler context — avoids React 19's set-state-in-effect.
    const initialId = setTimeout(() => {
      void refresh();
    }, 0);
    const id = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearTimeout(initialId);
      clearInterval(id);
    };
  }, [refresh]);

  return { snapshot, lastFetched, isReady, refresh, isConfigured };
}
