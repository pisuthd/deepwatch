'use client';

/**
 * ComparePageClient — single-table cross-venue comparison.
 *
 * Each row is one DeepBook Predict oracle (the protocol's native
 * market) with the closest-by-expiry Polymarket + Kalshi probs
 * attached. The last column ("AI") is staker-gated and lives inline
 * — not buried at the bottom of the page.
 *
 * State:
 *   - asset / horizon / sort — filter bar (ComparePageClient owns)
 *   - selectedKey — key of the match currently expanded in the drilldown
 *
 * AI batch lifecycle is owned by `AiBatchProvider` (mounted in
 * `app/providers.tsx`). When the user clicks "Analyse" on a row, the
 * page snapshots the currently visible matches, ensures the CMC
 * context is loaded, and calls `startBatch(matches, cmcContext)`. The
 * provider aborts any in-flight batch, resets state, opens the modal,
 * and fires the SSE consumer. Closing the modal does NOT stop the
 * batch — the dock pill (rendered in the provider layer) is the
 * persistent signal, and reopening the modal shows current progress.
 *
 * Data:
 *   - `useGlobalMarkets()` provides the three source rows. We group
 *     them with the existing `groupPolymarketMarkets` / `groupKalshiMarkets`
 *     / `groupDeepBookMarkets` helpers, then call `findMatchesForDeepBook`
 *     to anchor each row on a DeepBook oracle and attach the closest
 *     Poly/Kalshi match by expiry. Matches are memoised on the grouped
 *     arrays, so polling refreshes (every 90s) just re-render the table
 *     in place — no skeleton flash after first load.
 *
 * CMC context:
 *   - Fetched lazily on first "Analyse" click via `GET /api/cmc/context`.
 *     Cached for the page session; the route itself caches for 60 s.
 *     If the request fails or the key isn't configured, the batch still
 *     runs (cmcContext=null) — the route fetches fresh server-side on
 *     demand as a backup.
 */

import { useCallback, useMemo, useState } from 'react';
import PageWrapper from '../../common/PageWrapper';
import FilterBar, {
  applyHorizon,
  applySort,
  type Horizon,
  type SortKey,
} from './FilterBar';
import MatchTable from './MatchTable';
import DrilldownPanel from './DrilldownPanel';
import AiAnalyseModal from './AiAnalyseModal';
import { useGlobalMarkets } from '../../../stores/markets-store';
import { useAiBatch } from '@/app/stores/ai-batch-store';
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
import type { CmcContext } from '@/app/lib/match-analyses';

export default function ComparePageClient() {
  const {
    polyRows,
    kalshiRows,
    deepbookRows,
    firstLoad,
    everLoaded,
    lastFetched,
    refresh: refreshMarkets,
  } = useGlobalMarkets();
  const { prepareBatch } = useAiBatch();

  const [asset, setAsset] = useState<string>('BTC');
  const [horizon, setHorizon] = useState<Horizon>('all');
  const [sort, setSort] = useState<SortKey>('expiry');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [cmcContext, setCmcContext] = useState<CmcContext | null>(null);

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

  // Ensure CMC context is loaded. Fetched once on first analyse click
  // and cached for the page session; the route itself caches for 60 s.
  // Silent on failure — the batch still runs (cmcContext=null) and the
  // route fetches server-side as a backup.
  const ensureCmcContext = useCallback(async (): Promise<CmcContext | null> => {
    if (cmcContext) return cmcContext;
    try {
      const res = await fetch('/api/cmc/context', { cache: 'no-store' });
      if (!res.ok) return null;
      const json = (await res.json()) as CmcContext;
      setCmcContext(json);
      return json;
    } catch {
      return null;
    }
  }, [cmcContext]);

  // Clicked "Analyse" on any row → snapshot the visible matches, force a
  // re-fetch of the latest market data (so the analysis runs on truly
  // up-to-date numbers, not whatever the 90s poll last cached), and hand
  // everything to the provider's `prepareBatch`. The provider opens the
  // modal in `reviewing` state — the SSE consumer does NOT fire until
  // the user clicks "Start analysis" inside the modal. This is the
  // critical Part-4 fix: previously the modal auto-started the moment
  // you opened it, which is hostile to the user if they click Analyse
  // by accident or want to review the match list first.
  const handleClickAnalyse = useCallback(
    (key: string) => {
      // `key` is accepted to match `MatchTable`'s prop signature
      // (`(key: string) => void`) but isn't needed here — the
      // provider analyses the full `filtered` snapshot regardless of
      // which row triggered the click.
      void key;
      void (async () => {
        // Fire both in parallel: a fresh markets pull (Polymarket /
        // DeepBook / Kalshi all three) and a fresh CMC context. The
        // prepare call below uses the `filtered` snapshot at the moment
        // of completion, so if the refresh produces new rows they will
        // be included in the upcoming analysis.
        const [, ctx] = await Promise.all([refreshMarkets(), ensureCmcContext()]);
        prepareBatch(filtered, ctx);
      })();
    },
    [ensureCmcContext, filtered, prepareBatch, refreshMarkets],
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
          onClickAnalyse={handleClickAnalyse}
        />
      </div>

      <DrilldownPanel
        match={selected}
        spotUsd={spotUsd}
        onClose={() => setSelectedKey(null)}
      />

      <AiAnalyseModal />
    </PageWrapper>
  );
}
