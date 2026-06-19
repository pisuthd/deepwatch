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

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useMatchAnalyses } from '@/app/stores/match-analyses-store';
import { useBatchIndex } from '@/app/stores/batch-index-store';
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
  const batchIndex = useBatchIndex();
  const matchAnalyses = useMatchAnalyses();

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
  //
  // **Pure sort, no analyzed-first grouping.** The table is sorted
  // purely by the user's chosen key (expiry / spread / question).
  // Analyzed matches land wherever the sort places them — a 5m-out
  // locked match sorts above a 19h analyzed match, not below it.
  // The 3 free-slice matches are still highlighted via the AI cell
  // (AnalysisView vs "Stake to unlock"), so the user can spot them
  // by their content, not by position.
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

  // Clicked "Analyse" on any row → open the modal IMMEDIATELY with the
  // current snapshot so the user gets instant feedback (no double-click
  // required). The refresh + CMC fetch run in the background; the 90s
  // polling cycle already keeps the snapshot fresh enough that waiting
  // on the refresh before opening the modal was just adding latency.
  //
  // The provider opens the modal in `reviewing` state — the SSE
  // consumer does NOT fire until the user clicks "Start analysis"
  // inside the modal. If the user clicks Start before the background
  // refresh resolves, the analysis runs on whatever was visible at
  // click time (still ≤90s old). The next "Re-analyse" from the
  // done-panel will pick up the warmed cache.
  const handleClickAnalyse = useCallback(
    (key: string) => {
      // `key` is accepted to match `MatchTable`'s prop signature
      // (`(key: string) => void`) but isn't needed here — the
      // provider analyses the full `filtered` snapshot regardless of
      // which row triggered the click.
      void key;
      // Open the modal synchronously so the click feels responsive.
      prepareBatch(filtered, cmcContext);
      // Fire the background refresh in parallel — fire-and-forget.
      // The next batch (or re-analyse) gets the warmed cache.
      void Promise.all([refreshMarkets(), ensureCmcContext()]);
    },
    [cmcContext, ensureCmcContext, filtered, prepareBatch, refreshMarkets],
  );

  // ─── Walrus hydration (Part 6) ────────────────────────────────────────
  // On mount, kick off the batch-index refresh. Once it resolves,
  // hydrate `match-analyses` with the latest batch's plaintext
  // preview (first FREE_SLICE_SIZE markets) — this is what every
  // visitor sees, regardless of wallet / stake state. The full set
  // for stakers comes from the Seal-decrypted blob in the second
  // effect below.
  //
  // After a successful batch upload, `AiBatchProvider.onBatchComplete`
  // already pushes the in-flight entries into `match-analyses-store`
  // (so the user sees their fresh analyses immediately, before the
  // Walrus round-trip). The hydration effect below picks up the next
  // visitor's view of the same batch.
  useEffect(() => {
    void batchIndex.refresh();
    // refresh() is stable from useCallback; running once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Plaintext preview hydration. Runs once per "latest batch changed"
  // transition. Only fires when `hydrated` is true and we haven't yet
  // hydrated from this exact batch (so a re-render mid-Walrus-fetch
  // doesn't loop). Also skips when the user is the uploader of this
  // batch — the SSE consumer already populated the full in-memory
  // set (free + encrypted-tail), and the plaintext-only Walrus
  // preview would regress the user back to 3 visible entries.
  useEffect(() => {
    if (!batchIndex.hydrated) return;
    const latest = batchIndex.latest;
    if (!latest) return;
    if (matchAnalyses.lastHydratedBatchId === latest.batchId) return;
    if (matchAnalyses.lastUploadedBatchId === latest.batchId) {
      // Still mark "hydrated" for this batch so subsequent re-renders
      // don't try to re-hydrate. The user keeps the SSE-populated set.
      matchAnalyses.hydrateFromWalrus(matchAnalyses.state.byKey, latest.batchId);
      return;
    }
    // Preview = the plaintext blob's `results` (first FREE_SLICE_SIZE).
    matchAnalyses.hydrateFromWalrus(latest.results, latest.batchId);
  }, [
    batchIndex.hydrated,
    batchIndex.latest,
    matchAnalyses,
  ]);

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
          spotUsd={spotUsd}
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
