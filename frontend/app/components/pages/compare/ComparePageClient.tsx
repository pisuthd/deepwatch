'use client';

/**
 * ComparePageClient — single-table cross-venue comparison.
 *
 * Each row is one DeepBook Predict oracle (the protocol's native
 * market) with the closest-by-expiry Polymarket + Kalshi probs
 * attached. The last column ("AI") is staker-gated; the lock is
 * visible inline where the feature would be used, not buried at
 * the bottom of the page.
 *
 * State:
 *   - asset / horizon / sort — filter bar (ComparePageClient owns)
 *   - selectedKey — key of the match currently expanded in the drilldown
 *
 * Data:
 *   - `useGlobalMarkets()` provides the three source rows. We group
 *     them with the existing `groupPolymarketMarkets` / `groupKalshiMarkets`
 *     / `groupDeepBookMarkets` helpers, then call `findMatchesForDeepBook`
 *     to anchor each row on a DeepBook oracle and attach the closest
 *     Poly/Kalshi match by expiry. Matches are memoised on the grouped
 *     arrays, so polling refreshes (every 90s) just re-render the table
 *     in place — no skeleton flash after first load.
 */

import { useMemo, useState } from 'react';
import PageWrapper from '../../common/PageWrapper';
import FilterBar, {
  applyHorizon,
  applySort,
  type Horizon,
  type SortKey,
} from './FilterBar';
import MatchTable from './MatchTable';
import DrilldownPanel from './DrilldownPanel';
import LockedInsightsCard from './LockedInsightsCard';
import { useGlobalMarkets } from '../../../stores/markets-store';
import {
  groupPolymarketMarkets,
  type PolymarketGroup,
} from '@/app/lib/polymarket';
import {
  groupKalshiMarkets,
  type KalshiGroup,
} from '@/app/lib/kalshi';
import {
  groupDeepBookMarkets,
  type DeepBookGroup,
} from '@/app/lib/deepbook';
import { findMatchesForDeepBook, type DeepBookMatch } from '@/app/lib/match';

export default function ComparePageClient() {
  const {
    polyRows,
    kalshiRows,
    deepbookRows,
    firstLoad,
    everLoaded,
    lastFetched,
  } = useGlobalMarkets();

  const [asset, setAsset] = useState<string>('BTC');
  const [horizon, setHorizon] = useState<Horizon>('all');
  const [sort, setSort] = useState<SortKey>('expiry');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Group rows → match-ready groups. The groupers drop near-certain /
  // OTHER markets and dedupe YES/UP rows, so what comes out is exactly
  // the surface we want to match on.
  const polyGroups = useMemo<PolymarketGroup[]>(
    () => groupPolymarketMarkets(polyRows ?? []),
    [polyRows],
  );
  const kalshiGroups = useMemo<KalshiGroup[]>(
    () => groupKalshiMarkets(kalshiRows ?? []),
    [kalshiRows],
  );
  const deepBookGroups = useMemo<DeepBookGroup[]>(
    () => groupDeepBookMarkets(deepbookRows ?? []),
    [deepbookRows],
  );

  // Anchor ATM row to live spot when any deepBook group carries it.
  // The very first deepBook group in time-order is a fine enough proxy
  // for the global spot (DeepBook's oracles are BTC-only and the
  // SVI surface tracks spot closely across the ladder).
  const spotUsd = useMemo<number | null>(() => {
    for (const g of deepBookGroups) {
      if (g.spotUsd && g.spotUsd > 0) return g.spotUsd;
    }
    return null;
  }, [deepBookGroups]);

  // Match list (un-filtered) — the FilterBar reads this to compute
  // per-horizon counts. Anchored on DeepBook; one row per oracle.
  const allMatches = useMemo<DeepBookMatch[]>(
    () =>
      findMatchesForDeepBook(deepBookGroups, polyGroups, kalshiGroups, {
        spotUsd,
      }),
    [deepBookGroups, polyGroups, kalshiGroups, spotUsd],
  );

  // Apply horizon + sort. Use `lastFetched.deepbook` as a clock to
  // bust the memo when spot/expiry windows shift (90s cadence).
  const filtered = useMemo<DeepBookMatch[]>(
    () => applySort(applyHorizon(allMatches, horizon), sort),
    // `lastFetched.deepbook` is the deepest of the three fetch stamps;
    // including it makes the horizon window (which is now-relative) and
    // the expiry sort recompute on each 90s poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allMatches, horizon, sort, lastFetched.deepbook],
  );

  const selected = useMemo<DeepBookMatch | null>(
    () => allMatches.find((m) => m.key === selectedKey) ?? null,
    [allMatches, selectedKey],
  );

  return (
    <PageWrapper title="Compare">
      <div className="max-w-7xl mx-auto space-y-4">
        <FilterBar
          asset={asset}
          onAssetChange={setAsset}
          horizon={horizon}
          onHorizonChange={setHorizon}
          sort={sort}
          onSortChange={setSort}
          allMatches={allMatches}
        />

        <MatchTable
          matches={filtered}
          firstLoad={firstLoad}
          onSelect={setSelectedKey}
          venuesLoaded={everLoaded}
        />

        <LockedInsightsCard />
      </div>

      <DrilldownPanel
        match={selected}
        spotUsd={spotUsd}
        onClose={() => setSelectedKey(null)}
      />
    </PageWrapper>
  );
}
