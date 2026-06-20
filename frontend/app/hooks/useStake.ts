'use client';

/**
 * `useStake` — gating hook for AI features on the Compare and
 * Predict pages.
 *
 * # v2 behaviour (replaces the v1 placeholder)
 *
 *   - `isStaker` is `true` iff the connected wallet has an
 *     unexpired `deepwatch::subscription::Subscription` NFT minted
 *     by `pool::stake`. This is a real on-chain check via
 *     `useUserPool`, polled every 30 s.
 *   - `isReady` is `true` once the first poll completes (even if it
 *     returns zero subscriptions — i.e. the user genuinely has
 *     none). Callers that gate UI on `isStaker` should ALSO wait
 *     for `isReady` to avoid flashing the locked state during the
 *     initial fetch.
 *   - `subscription` exposes the active NFT (null if none) for UI
 *     that wants to show e.g. "expires in 14 days".
 *   - `refresh()` is exposed so the Compare / Predict page can
 *     force a re-check after a successful stake PTB without waiting
 *     for the 30 s poll.
 *
 * # Backward compat
 *
 * v1 callers only consumed `isStaker`. The new shape adds
 * `isReady`, `subscription`, `refresh`, and (breaking) changes the
 * semantics of `isStaker` from "wallet connected" to "subscription
 * valid". Call sites that previously treated a connected wallet as
 * a staker need to be re-tested.
 *
 * # Why this is the v2 design
 *
 * The v1 placeholder (`isStaker = !!account?.address`) was fine for
 * the wallet-presence demo but had no relation to actual stake. v2
 * ties the AI surface to a real on-chain condition: a valid
 * Subscription NFT. The "Stake to unlock" CTA on the AI surface
 * (Compare page's AiCell, Predict page's MatchInsightButton /
 * AutoPopupMatchInsight / MatchInsightPopover) leads to `/app/stake`
 * which calls `pool::stake` and mints the NFT. Access is then
 * real, not a fake gate.
 */

import { useUserPool, type UseUserPoolResult } from './useUserPool';
import type { UserSubscription } from '../lib/deepwatch-pool';

export interface UseStakeResult {
  /** Whether the current wallet may use AI features. */
  isStaker: boolean;
  /** True after the first on-chain check completes. */
  isReady: boolean;
  /** The active Subscription NFT, or `null` if none. */
  subscription: UserSubscription | null;
  /** Manual re-check (e.g. after a stake PTB confirms). */
  refresh: () => Promise<void>;
}

/** Convenience re-export so callers can grab the full hook if they want more. */
export type { UseUserPoolResult };

export function useStake(): UseStakeResult {
  const { subscription, hasAccess, isReady, refresh } = useUserPool();
  return {
    isStaker: hasAccess,
    isReady,
    subscription,
    refresh,
  };
}
