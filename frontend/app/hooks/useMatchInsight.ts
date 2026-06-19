'use client';

/**
 * useMatchInsight — read-side hook for the per-market AI analysis.
 *
 * The Compare page runs an AI batch via `AiBatchProvider` and stores
 * results in two places:
 *   1. `useMatchAnalyses()` (localStorage, per-row fast cache) — the
 *      most recent result for each `matchKey`, written by the provider
 *      on batch completion. Read by `AiCell` on the Compare table.
 *      Includes BOTH free-slice and encrypted-slice entries (the
 *      provider's `setMany(persistedEntries)` flushes all entries,
 *      and the encrypted slice is held in the local cache as a
 *      per-device decryption cache).
 *   2. Walrus (Tatum) — the durable source of truth. One plaintext
 *      blob per batch (free slice, public) plus one ciphertext blob
 *      per batch (encrypted slice, Seal-gated).
 *
 * The Predict page needs the same per-market analysis (for the new
 * `MatchInsightButton` + auto-popup surface) but is outside the batch
 * flow — it doesn't know which Walrus blob holds the analysis for the
 * current market. This hook bridges that gap.
 *
 * # Lookup order (v2 — Seal-encrypted slice)
 *
 *   1. **`useMatchAnalyses().getByMatchKey(key)`** — local cache, O(1).
 *      Hits when a batch was just kicked on the Compare page and the
 *      user navigated to Predict; the provider populated the cache
 *      before the user could move.
 *   2. **`useBatchIndex().all`** — localStorage cache of already-
 *      fetched plaintext `BatchInsight` blobs. Hits when the user
 *      re-visits Predict for a market whose batch blob was fetched in
 *      a previous session. Note: this only covers the **free slice**;
 *      the encrypted slice is not in this store (it's only held in
 *      the per-device local cache or behind a Seal decrypt).
 *   3. **Walrus lazy fetch (plaintext)** — `listWalrusUploads` → for
 *      each `CERTIFIED` row whose filename matches the plaintext
 *      blob's filename (set by the provider at upload time, skipping
 *      encrypted blobs which share the same `batchId` stem but have a
 *      `-enc` suffix), fetch the blob body, validate, index it in the
 *      batch-index store, and check whether the body has an entry for
 *      `matchKey`. Stops at the first hit.
 *
 * # Access error
 *
 * When none of the above produces a hit but a batch in the index has
 * `matchKey` listed in `encryptedMatchKeys`, the requested analysis
 * lives in the **encrypted slice** of that batch. If the wallet is
 * NOT a current staker, we surface `accessError: 'NO_SUBSCRIPTION'`
 * so the UI can render the locked CTA ("Stake to unlock") instead of
 * the misleading "no analysis yet" message. If the wallet IS a
 * staker, the analysis should already be in the local cache (from the
 * last batch run on this device); if not, we return `null` and let
 * the user re-run an analysis on the Compare page to repopulate.
 *
 * # Returns
 *
 * A structured `{ analysis, accessError, isReady }` rather than a
 * bare `MatchAnalysis | null`, so the consumer can render different
 * UI for "no analysis" vs. "locked behind subscription". The
 * `analysis` field is `null` in both cases — only `accessError`
 * distinguishes them.
 *
 * The hook is read-only and side-effect-bounded: the only state
 * mutation is `useBatchIndex().set(insight)`, which caches the blob
 * for future reads. Repeated calls with the same `matchKey` do NOT
 * re-fetch from Walrus (the `attemptedRef` short-circuits).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMatchAnalyses } from '@/app/stores/match-analyses-store';
import { useBatchIndex } from '@/app/stores/batch-index-store';
import { useStake } from './useStake';
import {
  listWalrusUploads,
  fetchInsightBlob,
  parseBatchFilename,
} from '@/app/lib/tatum';
import { validateBatchInsight, type MatchAnalysis } from '@/app/lib/match-analyses';

const TATUM_API_KEY =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_TATUM_API_KEY) || '';

export type AccessError = 'NO_SUBSCRIPTION' | 'EXPIRED';

export interface UseMatchInsightResult {
  /** The per-market AI analysis, or `null` if no batch contains this
   * market (or it's behind the encrypted slice and the user isn't a
   * staker — see `accessError`). */
  analysis: MatchAnalysis | null;
  /** Why the analysis isn't available. `null` means "no batch has
   * this market at all" (or a free-slice hit is on its way). Set to
   * `'NO_SUBSCRIPTION'` when the market exists only in the encrypted
   * slice and the wallet doesn't hold a valid Subscription NFT. */
  accessError: AccessError | null;
  /** True once both stores have hydrated. UI should wait for this
   * before gating on `analysis`/`accessError`. */
  isReady: boolean;
}

export function useMatchInsight(
  matchKey: string | null | undefined,
): UseMatchInsightResult {
  const { getByMatchKey, hydrated: analysesHydrated } = useMatchAnalyses();
  const { all: batches, set: setBatch, hydrated: batchesHydrated } = useBatchIndex();
  const { isStaker } = useStake();
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

  // Step 2b: detect that the key lives in an encrypted slice but the
  // current wallet can't decrypt it. We only flag this when the
  // wallet has loaded and is NOT a staker — otherwise we'd flash the
  // locked CTA for the first ~30s of `useStake`'s poll.
  const accessError: AccessError | null = useMemo<AccessError | null>(() => {
    if (!matchKey || !batchesHydrated) return null;
    if (local || fromIndex || remoteAnalysis) return null;
    // Is any batch in the index gating this key?
    const gated = batches.some((b) => b.encryptedMatchKeys?.includes(matchKey) ?? false);
    if (!gated) return null;
    if (isStaker) return null; // staker should have it in local cache; if not, fall through to "not available"
    return 'NO_SUBSCRIPTION';
  }, [matchKey, batchesHydrated, local, fromIndex, remoteAnalysis, batches, isStaker]);

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
        // Build a quick lookup of plaintext filenames in the index so we
        // can skip the encrypted-slice blob (same batchId stem but
        // `-enc` suffix — `parseBatchFilename` returns a valid match
        // for both, so we need this extra filter).
        const plaintextFilenames = new Set<string>();
        for (const b of batches) {
          if (b.plaintextFilename) plaintextFilenames.add(b.plaintextFilename);
        }
        // Newest first — stop at the first batch whose body contains
        // the requested matchKey. Walrus has no native "lookup by
        // key" endpoint, so we walk the list. In practice most users
        // will have 1–5 batches.
        for (const row of rows) {
          if (cancelled) return;
          if (row.status !== 'CERTIFIED') continue;
          if (!row.downloadUrlByQuiltId) continue;
          const parsed = parseBatchFilename(row.filename);
          if (!parsed) continue;
          // Skip the encrypted-slice blob. The provider stores the
          // encrypted filename on the cached batch as `encryptedFilename`
          // — if this row's filename matches a known encrypted
          // filename, it's the sealed blob and we can't decrypt it
          // through this hook (decrypt is a separate flow, see
          // `seal.ts`).
          const isEncryptedBlob = batches.some((b) => b.encryptedFilename === row.filename);
          if (isEncryptedBlob) continue;
          // If we've already fetched this plaintext blob and it
          // didn't have the key, skip — the previous pass already
          // indexed it.
          if (plaintextFilenames.has(row.filename)) {
            const cached = batches.find((b) => b.plaintextFilename === row.filename);
            if (cached?.results[matchKey]) {
              if (!cancelled) setRemoteAnalysis(cached.results[matchKey]);
              return;
            }
            continue;
          }
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
    // store identity changes (it's a useCallback). `batches` is
    // included so a freshly-loaded index re-evaluates the
    // encrypted-blob skip.
  }, [matchKey, analysesHydrated, batchesHydrated, local, fromIndex, setBatch, batches]);

  return {
    analysis: local ?? fromIndex ?? remoteAnalysis,
    accessError,
    isReady: analysesHydrated && batchesHydrated,
  };
}