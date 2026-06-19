'use client';

/**
 * AutoPopupMatchInsight — auto-opens the `MatchInsightButton` popover
 * for the active market on the Predict page, **once per matchKey per
 * session** and **only for stakers**.
 *
 * Lives at the page level (mounted in `app/app/predict/page.tsx` next
 * to `MainnetWarning`) so it can watch the active `matchKey` for the
 * whole page, regardless of which mode (Simple/Advanced) is active.
 *
 * Why a custom event and not lifted state: the button is mounted in
 * `TradeWrapper.trailing`, which is a generic slot that doesn't
 * expose a way to inject state. A small `deepwatch:open-match-insight`
 * window event is the cleanest cross-component signal — the button
 * listens for it (filtered by its own `matchKey`) and opens its
 * popover. No globals, no context, no refactoring of `TradeWrapper`.
 *
 * Why a `setTimeout(0)` dispatch: the button is mounted in the same
 * React commit as this component. Its `useEffect` listener attaches
 * after the commit; the dispatch needs to land after the listener
 * is attached. `setTimeout(0)` defers the dispatch to the next task,
 * by which point the listener is in place. The 50 ms fallback is a
 * safety net for slow first-paint on cold loads.
 *
 * Why a `firedRef` (not state): the set of fired `matchKey`s is
 * per-session, never rendered, and shouldn't trigger a re-render
 * when it changes. A `useRef<Set<string>>` is the right primitive.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useCurrentMarket } from './CurrentMarketContext';
import { useMatchInsight } from '@/app/hooks/useMatchInsight';
import { useStake } from '@/app/hooks/useStake';

const DISPATCH_DELAY_MS = 50;
const OPEN_EVENT = 'deepwatch:open-match-insight';

export default function AutoPopupMatchInsight() {
  const { isStaker } = useStake();
  const { oracleId, expiryMs } = useCurrentMarket();
  const matchKey = useMemo<string | null>(
    () => (oracleId && expiryMs ? `${oracleId}::${expiryMs}` : null),
    [oracleId, expiryMs],
  );
  const analysis = useMatchInsight(matchKey);
  // Per-session set of `matchKey`s we've already auto-opened for. A
  // `useRef` (not `useState`) because the set never drives rendering
  // and shouldn't trigger a re-render when it grows.
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isStaker) return; // gate
    if (!matchKey) return; // no market selected
    if (!analysis) return; // no analysis for this market yet
    if (firedRef.current.has(matchKey)) return; // already fired

    firedRef.current.add(matchKey);
    const detail = { matchKey };
    // Defer to the next task so the MatchInsightButton listener has
    // time to attach (it mounts in the same commit but its
    // `useEffect` runs after).
    const id = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail }));
    }, DISPATCH_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [isStaker, matchKey, analysis]);

  // Renderless — the popover is owned by `MatchInsightButton`; this
  // component is a side-effect-only coordinator.
  return null;
}
