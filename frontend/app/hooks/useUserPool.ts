'use client';

/**
 * `useUserPool` — derives the current wallet's per-user state from
 * the DeepWatch pool: active `Subscription` NFT(s), outstanding
 * `Debt` NFT(s), access validity, time-remaining.
 *
 * # Active-subscription semantics
 *
 * A user can stake multiple times and accumulate multiple
 * Subscription NFTs. We surface the *latest* one (highest
 * `deposited_at_ms`) that is still valid (`now < expires_at_ms`).
 * If that one is expired, `subscription` is `null` and
 * `hasAccess === false` — even if other expired NFTs are in the
 * wallet. The user has to either unstake the expired ones or wait
 * for them to expire before staking again to renew access.
 *
 * # Refresh cadence
 *
 * Polls every 30 s, matching `useDeepWatchPool`. Faster cadence is
 * unnecessary — the only thing that changes "soon" is the
 * `expiresAtMs` clock; a 30 s drift is invisible. Refresh is also
 * called explicitly after a successful stake/unstake PTB so the UI
 * flips immediately.
 *
 * # Replaces
 *
 * `useStake`'s v1 placeholder (`isStaker = !!account?.address`).
 * The new `useStake` is a thin wrapper around this hook — see
 * `app/hooks/useStake.ts` for the migration notes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from './useWallet';
import { useNetworkConfig } from './useNetworkConfig';
import {
  fetchUserSubscriptions,
  isSubscriptionValid,
  type UserSubscription,
} from '../lib/deepwatch-pool';

const POLL_INTERVAL_MS = 30_000;
const TTL_TICK_MS = 1_000;

export interface UseUserPoolResult {
  /** The latest non-expired `Subscription` NFT, or `null`. */
  subscription: UserSubscription | null;
  /** All `Subscription` NFTs in the wallet (including expired). */
  allSubscriptions: UserSubscription[];
  /** `subscription != null && now < expires_at_ms`. */
  hasAccess: boolean;
  /** Ms remaining on the active subscription (0 if none). */
  subscribeTtl: number;
  /** Unix ms of the last fetch. */
  lastFetched: number | null;
  /** True once the first fetch completed (success or empty). */
  isReady: boolean;
  /** Manual refetch. Same callback ref across renders. */
  refresh: () => Promise<void>;
  /** True if the network config is missing the deepwatch package ID. */
  isConfigured: boolean;
}

export function useUserPool(): UseUserPoolResult {
  const { account } = useWallet();
  const cfg = useNetworkConfig();
  const packageId = cfg.deepwatch.packageId;
  const isConfigured = packageId !== null;
  const rpcUrl = cfg.fullnodeGrpc.replace(/:443$/, '');

  const [allSubscriptions, setAll] = useState<UserSubscription[]>([]);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);
  // Tick state drives the TTL countdown. Updated once per second by a
  // dedicated effect so we don't call `Date.now()` directly during
  // render (React 19 strict purity rule).
  const [now, setNow] = useState<number>(() => Date.now());

  const cancelledRef = useRef<boolean>(false);

  const refresh = useCallback(async () => {
    if (!packageId || !account?.address) {
      setAll([]);
      setIsReady(true);
      setLastFetched(null);
      return;
    }
    const subs = await fetchUserSubscriptions(rpcUrl, account.address, packageId);
    if (cancelledRef.current) return;
    setAll(subs);
    setLastFetched(Date.now());
    setIsReady(true);
  }, [packageId, rpcUrl, account]);

  useEffect(() => {
    cancelledRef.current = false;
    // Schedule the initial fetch via a microtask deferral so it lands
    // inside an event-handler context (setInterval callback) instead
    // of the effect body — keeps React 19's set-state-in-effect rule
    // happy without sacrificing latency.
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

  // Tick the "now" clock so the TTL countdown stays fresh without
  // calling Date.now() during render.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TTL_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Derive the "active" subscription: latest by deposited_at_ms that
  // hasn't expired yet. If the latest IS expired, we still expose
  // it (with hasAccess=false) so the UI can render the expiry
  // countdown rather than pretending it never existed.
  const sorted = [...allSubscriptions].sort((a, b) => b.depositedAtMs - a.depositedAtMs);
  const latest = sorted[0] ?? null;
  const subscription = latest && isSubscriptionValid(latest, now) ? latest : null;
  const hasAccess = subscription !== null;
  const subscribeTtl = subscription ? Math.max(0, subscription.expiresAtMs - now) : 0;

  return {
    subscription,
    allSubscriptions,
    hasAccess,
    subscribeTtl,
    lastFetched,
    isReady,
    refresh,
    isConfigured,
  };
}
