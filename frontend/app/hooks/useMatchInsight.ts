'use client';

/**
 * useMatchInsight — read-side hook for the per-market AI analysis.
 *
 * The Compare page runs an AI batch via `AiBatchProvider` and stores
 * results in two places:
 *   1. `useMatchAnalyses()` (localStorage, per-row fast cache) — the
 *      most recent result for each `matchKey`, written by the provider
 *      on batch completion. Read by `AiCell` on the Compare table.
 *   2. Walrus (Tatum) — the durable source of truth. One blob per
 *      batch, with the full `BatchInsight { results: { matchKey ->
 *      MatchAnalysis } }` shape.
 *
 * The Predict page needs the same per-market analysis (for the new
 * `MatchInsightButton` + auto-popup surface) but is outside the batch
 * flow — it doesn't know which Walrus blob holds the analysis for the
 * current market. This hook bridges that gap.
 *
 * Lookup order (each step is synchronous until the network call):
 *   1. **`useMatchAnalyses().getByMatchKey(key)`** — local cache, O(1).
 *      Hits when a batch was just kicked on the Compare page and the
 *      user navigated to Predict; the provider populated the cache
 *      before the user could move.
 *   2. **`useBatchIndex().all`** — localStorage cache of already-
 *      fetched `BatchInsight` blobs. Hits when the user re-visits
 *      Predict for a market whose batch blob was fetched in a
 *      previous session.
 *   3. **Walrus lazy fetch** — `listWalrusUploads` → for each
 *      `CERTIFIED` row whose filename matches the `analysis-batch-`
 *      convention, fetch the blob body, validate, index it in the
 *      batch-index store, and check whether the body has an entry
 *      for `matchKey`. Stops at the first hit. Sets `remoteAnalysis`
 *      so the hook returns synchronously on the next render.
 *
 * Returns `null` if no analysis exists for the key (no batch yet, or
 * no batch contains the current market).
 *
 * The hook is read-only and side-effect-bounded: the only state
 * mutation is `useBatchIndex().set(insight)`, which caches the blob
 * for future reads. Repeated calls with the same `matchKey` do NOT
 * re-fetch from Walrus (the `attemptedRef` short-circuits).
 */

import { useEffect, useRef, useState } from 'react';
import { useMatchAnalyses } from '@/app/stores/match-analyses-store';
import { useBatchIndex } from '@/app/stores/batch-index-store';
import {
  listWalrusUploads,
  fetchInsightBlob,
  parseBatchFilename,
} from '@/app/lib/tatum';
import { validateBatchInsight, type MatchAnalysis } from '@/app/lib/match-analyses';

const TATUM_API_KEY =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_TATUM_API_KEY) || '';

export function useMatchInsight(matchKey: string | null | undefined): MatchAnalysis | null {
  const { getByMatchKey, hydrated: analysesHydrated } = useMatchAnalyses();
  const { all: batches, set: setBatch, hydrated: batchesHydrated } = useBatchIndex();
  const [remoteAnalysis, setRemoteAnalysis] = useState<MatchAnalysis | null>(null);
  // Per-key set of `matchKey`s we've already attempted to fetch from
  // Walrus. Lives in a ref so it doesn't trigger re-renders, and so
  // the same key isn't re-fetched if the effect re-runs for any
  // reason.
  const attemptedRef = useRef<Set<string>>(new Set());

  // Step 1: local per-match cache.
  const local: MatchAnalysis | null =
    matchKey && analysesHydrated ? getByMatchKey(matchKey) ?? null : null;

  // Step 2: search the batch-index cache. Linear scan, but bounded by
  // the 100-entry cap on the index (and each batch is ~12 markets,
  // so worst case is ~1,200 lookups per call — fine for a 60 fps hook
  // when called from a single component).
  const fromIndex: MatchAnalysis | null =
    matchKey && batchesHydrated
      ? (batches.find((b) => b.results[matchKey] != null)?.results[matchKey] ?? null)
      : null;

  // Step 3: lazy fetch from Walrus. Triggered only when both stores
  // are hydrated AND neither local nor index has a hit. The
  // `attemptedRef` makes this a no-op on subsequent calls.
  useEffect(() => {
    if (!matchKey) return;
    if (!analysesHydrated || !batchesHydrated) return; // wait for hydration
    if (local || fromIndex) return; // already have a hit
    if (!TATUM_API_KEY) return; // no API key → can't fetch
    if (attemptedRef.current.has(matchKey)) return; // already tried
    attemptedRef.current.add(matchKey);

    let cancelled = false;
    void (async () => {
      try {
        const rows = await listWalrusUploads(TATUM_API_KEY, { limit: 50 });
        // Newest first — stop at the first batch whose body contains
        // the requested matchKey. Walrus has no native "lookup by
        // key" endpoint, so we walk the list. In practice most users
        // will have 1–5 batches.
        for (const row of rows) {
          if (cancelled) return;
          if (row.status !== 'CERTIFIED') continue;
          if (!row.downloadUrlByQuiltId) continue;
          if (!parseBatchFilename(row.filename)) continue;
          const raw = await fetchInsightBlob<unknown>(row.downloadUrlByQuiltId);
          const insight = validateBatchInsight(raw);
          if (!insight) continue;
          // Index the body for future reads regardless of whether it
          // contains the requested key — other Predict-page markets
          // may also be in the same batch.
          setBatch(insight);
          if (insight.results[matchKey]) {
            if (!cancelled) setRemoteAnalysis(insight.results[matchKey]);
            return;
          }
        }
        // No batch had this key.
        if (!cancelled) setRemoteAnalysis(null);
      } catch {
        // Silent — Walrus unreachable / 4xx / 5xx all collapse to
        // "no insight available". The user can re-run an analysis on
        // the Compare page to populate.
        if (!cancelled) setRemoteAnalysis(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally depend on `local` and `fromIndex` so the effect
    // re-runs (and short-circuits via the early return) when a cache
    // hit arrives. The `setBatch` dep keeps the effect stable across
    // store identity changes (it's a useCallback).
  }, [matchKey, analysesHydrated, batchesHydrated, local, fromIndex, setBatch]);

  return local ?? fromIndex ?? remoteAnalysis;
}
