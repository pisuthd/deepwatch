/**
 * `useStake` — wallet-presence check for the Compare page AI features.
 *
 * **v1 placeholder behaviour:** any connected wallet is treated as a
 * staker. Disconnected wallets return `isStaker === false` (so the AI
 * column renders the locked state). This is intentionally a placeholder
 * — the real on-chain staker check (a contract call or indexer lookup)
 * needs design and lands in v2. The hook's `isReady` field is exposed
 * so v2's async check can flip it during lookup without changing the
 * call sites.
 *
 * The Compare page is the first consumer (via `AiCell`). Add new
 * call sites with care — the gate belongs in the feature it gates, not
 * in the data components (the drilldown modal is a passive viewer of
 * pre-fetched data and is intentionally NOT gated by `useStake`).
 */

import { useWallet } from './useWallet';

export interface UseStakeResult {
  /** Whether the current wallet may use AI features. */
  isStaker: boolean;
  /** True after wallet hydration completes. v1 is always true. */
  isReady: boolean;
}

export function useStake(): UseStakeResult {
  const { account } = useWallet();
  // v1 placeholder: any connected wallet is treated as a staker.
  // Disconnected wallet → isStaker false → AI column shows the lock.
  const isStaker = !!account?.address;
  // isReady is true because useCurrentAccount is synchronous today;
  // exposed so v2's async staker lookup can flip it during resolution.
  return { isStaker, isReady: true };
}
