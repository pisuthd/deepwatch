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
import LocalAnalyseModal from './LocalAnalyseModal';
import LocalSourceExplainerModal from './LocalSourceExplainerModal';
import { useGlobalMarkets } from '../../../stores/markets-store';
import { useAiBatch } from '@/app/stores/ai-batch-store';
import { useMatchAnalyses } from '@/app/stores/match-analyses-store';
import { useBatchIndex } from '@/app/stores/batch-index-store';
import { useInsightSource } from '@/app/context/InsightSourceContext';
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
  const { source: insightSource } = useInsightSource();

  const [asset, setAsset] = useState<string>('BTC');
  const [horizon, setHorizon] = useState<Horizon>('all');
  const [sort, setSort] = useState<SortKey>('expiry');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [cmcContext, setCmcContext] = useState<CmcContext | null>(null);
  /**
   * Which analyse-modal surface the user last opened. Gates the two
   * modals on this page so they don't stack on top of each other —
   * both subscribe to the same `useAiBatch()` state, and `prepareBatch`
   * flips the provider's `isModalOpen` regardless of `target`, so we
   * have to make sure only one `<*AnalyseModal>` renders per click.
   * `null` = none open (clean state, dock pill still shows background
   * progress for any in-flight batch).
   */
  const [activeAnalyseModal, setActiveAnalyseModal] = useState<'walrus' | 'local' | null>(null);

  // ─── Local-source explainer (deprecation notice) ────────────────────
  // Surfaces a must-dismiss modal the first time the user flips the
  // source selector to Local on this browser. After dismissal, a
  // persistent localStorage flag (`deepwatch:local-explainer-seen`)
  // suppresses re-renders across page reloads.
  //
  // `seenFlag` follows the three-state pattern: `null` while we haven't
  // read localStorage yet, `true` after the user has dismissed or the
  // flag is already set, `false` only on first visit.
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [seenFlag, setSeenFlag] = useState<boolean | null>(null);

  useEffect(() => {
    // setTimeout(0) defers the localStorage read into an event-handler
    // context so React 19's set-state-in-effect rule stays happy.
    const initialId = setTimeout(() => {
      try {
        setSeenFlag(
          window.localStorage.getItem('deepwatch:local-explainer-seen') === '1',
        );
      } catch {
        // Storage unavailable (private mode, quota, denial) → don't nag.
        setSeenFlag(true);
      }
    }, 0);
    return () => clearTimeout(initialId);
  }, []);

  // Open the explainer on a Local-source flip, gated by the seen flag.
  // Sits alongside the source-flush effect below without interfering —
  // this effect only sets state on `explainerOpen`, never calls
  // `batchIndex.refresh()`.
  useEffect(() => {
    if (seenFlag !== false) return;
    if (insightSource !== 'local') return;
    // Same setTimeout(0) wrap as above to avoid React 19's
    // set-state-in-effect rule when a state setter is the entire body
    // of an effect.
    const id = setTimeout(() => setExplainerOpen(true), 0);
    return () => clearTimeout(id);
  }, [insightSource, seenFlag]);

  const closeExplainer = useCallback(() => {
    setExplainerOpen(false);
    try {
      window.localStorage.setItem('deepwatch:local-explainer-seen', '1');
    } catch {
      // Storage full or denied — in-memory `seenFlag=true` still
      // suppresses re-open for this session.
    }
    setSeenFlag(true);
  }, []);

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
      // Flip the active-modal gate BEFORE the prepareBatch call so the
      // provider's `isModalOpen=true` doesn't surface `AiAnalyseModal`
      // if the user has just switched from the local flow.
      setActiveAnalyseModal('walrus');
      // Open the modal synchronously so the click feels responsive.
      prepareBatch(filtered, cmcContext);
      // Fire the background refresh in parallel — fire-and-forget.
      // The next batch (or re-analyse) gets the warmed cache.
      void Promise.all([refreshMarkets(), ensureCmcContext()]);
    },
    [cmcContext, ensureCmcContext, filtered, prepareBatch, refreshMarkets],
  );

  // Sibling of `handleClickAnalyse` — same shape, but `prepareBatch`
  // stages the batch with `target: 'local'` so the SSE consumer's
  // on-complete path writes to `localStorage` (and auto-flips the
  // global source preference) instead of uploading to Walrus.
  const handleClickLocalAnalyse = useCallback(
    (key: string) => {
      void key;
      // Show the local modal — the Walrus `AiAnalyseModal` must not
      // also render, since `prepareBatch` flips the shared provider's
      // `isModalOpen` regardless of target.
      setActiveAnalyseModal('local');
      prepareBatch(filtered, cmcContext, { target: 'local' });
      void Promise.all([refreshMarkets(), ensureCmcContext()]);
    },
    [cmcContext, ensureCmcContext, filtered, prepareBatch, refreshMarkets],
  );

  // ─── Source-aware hydration ──────────────────────────────────────────
  // On mount AND whenever the user flips the global source selector,
  // kick off the batch-index refresh (which now branches on `source`
  // inside `batch-index-store.refresh()` — Walrus Tatum listWalrusUploads
  // vs `getLocalBatches()`). Once it resolves, hydrate the per-match
  // analyses store from the chosen source.
  //
  // We also `clear()` the per-match store on every source flip so the
  // table doesn't briefly show the OLD source's data while the new
  // source's batch-index refresh is in flight (the user would otherwise
  // see a flash of Walrus analyses on the screen even though they've
  // switched to Local).
  useEffect(() => {
    // `matchAnalyses` is intentionally NOT in the deps array —
    // `useMatchAnalyses()` returns a fresh wrapper object on every
    // render (spreads the context value into a new `{}`), so depending
    // on it would re-fire this effect every render → infinite loop.
    // `matchAnalyses.clear()` is a stable `useCallback` from the
    // provider and is safe to call without depending on the wrapper.
    matchAnalyses.clear();
    void batchIndex.refresh();
  }, [insightSource, batchIndex.refresh]);

  // Plaintext preview hydration. Runs once per "latest batch changed"
  // transition AND whenever the source flips. Branches on `insightSource`:
  //
  //   - `walrus` (default): hydrate from the latest batch's plaintext
  //     preview (first HEAD_SIZE + MIDDLE_SIZE markets). Skipped when
  //     the user is the uploader of this batch — the SSE consumer
  //     already populated the full in-memory set, and the plaintext-only
  //     Walrus body would regress them back to 3 visible entries.
  //   - `local`: hydrate from `lib/local-insights.ts` directly via
  //     `matchAnalyses.hydrateFromLocal()` — merges every cached
  //     batch's `results` into one map (newest batch wins on overlap).
  //     No Walrus roundtrip; no encrypted slice to worry about.
  useEffect(() => {
    if (!batchIndex.hydrated) return;
    if (insightSource === 'local') {
      matchAnalyses.hydrateFromLocal();
      return;
    }
    const latest = batchIndex.latest;
    if (!latest) return;
    if (matchAnalyses.lastHydratedBatchId === latest.batchId) return;
    if (matchAnalyses.lastUploadedBatchId === latest.batchId) {
      // Still mark "hydrated" for this batch so subsequent re-renders
      // don't try to re-hydrate. The user keeps the SSE-populated set.
      matchAnalyses.hydrateFromWalrus(matchAnalyses.state.byKey, latest.batchId);
      return;
    }
    // Preview = the plaintext blob's `results` (first HEAD_SIZE +
    // MIDDLE_SIZE markets — see `ai-batch-store.tsx`).
    matchAnalyses.hydrateFromWalrus(latest.results, latest.batchId);
  }, [
    insightSource,
    batchIndex.hydrated,
    batchIndex.latest,
    // `matchAnalyses` deliberately omitted — see comment in the
    // refresh effect above. The `useMatchAnalyses()` wrapper object
    // is recreated on every render; depending on it would loop.
  ]);

  // ─── (auto-decrypt removed — see doc comment above) ─────────────────

  return (
    <PageWrapper title="AI Insights">
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
          onClickLocalAnalyse={handleClickLocalAnalyse}
        />
      </div>

      <DrilldownPanel
        match={selected}
        spotUsd={spotUsd}
        onClose={() => setSelectedKey(null)}
      />

      {/*
        Only one modal at a time — `prepareBatch` flips the shared
        provider's `isModalOpen` regardless of `target`, so without
        the gate both `<AiAnalyseModal>` and `<LocalAnalyseModal>`
        would mount at z-50 on the same click. Gate is keyed on the
        user's most recent click (`activeAnalyseModal`).

        Why `=== 'walrus'` and not `!== 'local'`? When the user closes
        the local modal we set `activeAnalyseModal` back to `null`;
        `null !== 'local'` is true, so `AiAnalyseModal` would
        re-render and pick up the still-open `isModalOpen=true` flag
        from the provider — surfacing the Walrus modal as a phantom.
        Pinning the gate to the literal `'walrus'` keeps the Walrus
        modal hidden until the user actually clicks "Run Analyse".
      */}
      {activeAnalyseModal === 'walrus' && <AiAnalyseModal />}
      <LocalAnalyseModal
        open={activeAnalyseModal === 'local'}
        onClose={() => setActiveAnalyseModal(null)}
      />

      {/*
        Local-source deprecation explainer. Mounted at the page root so
        its lifecycle is independent of which analyse modal is open. Only
        renders when `explainerOpen` is true, which is only set on the
        first-ever Local flip per browser.
      */}
      <LocalSourceExplainerModal
        open={explainerOpen}
        onClose={closeExplainer}
      />
    </PageWrapper>
  );
}
