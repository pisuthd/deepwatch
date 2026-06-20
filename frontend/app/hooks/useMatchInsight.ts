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
 *   2. Walrus (Tatum) — the durable source of truth. One blob per
 *      batch (v4+ single-blob): JSON with plaintext `results` (free
 *      slice, public), `encryptedPayload` (base64 AES ciphertext of
 *      the full set), `wrappedKey` (base64 Seal ciphertext wrapping
 *      the AES key), and `encryptedMatchKeys` (the gated matchKeys
 *      list).
 *
 * The Predict page needs the same per-market analysis (for the new
 * `MatchInsightButton` + auto-popup surface) but is outside the batch
 * flow — it doesn't know which Walrus blob holds the analysis for the
 * current market. This hook bridges that gap.
 *
 * # Lookup order (v2 — hybrid Seal+AES-encrypted slice)
 *
 *   1. **`useMatchAnalyses().getByMatchKey(key)`** — local cache, O(1).
 *      Hits when a batch was just kicked on the Compare page and the
 *      user navigated to Predict; the provider populated the cache
 *      before the user could move.
 *   2. **`useBatchIndex().all`** — in-memory cache of already-fetched
 *      plaintext `BatchInsight` blobs (the `results` field). Hits
 *      when the user re-visits Predict for a market whose batch blob
 *      was fetched in a previous session. Note: this only covers the
 *      **free slice**; the encrypted slice is not in this map (it's
 *      only held in the per-device local cache or behind a Seal
 *      decrypt).
 *   3. **Walrus lazy fetch (plaintext)** — `listWalrusUploads` → for
 *      each `CERTIFIED` row whose filename parses as a non-encrypted
 *      `analysis-batch-<id>-<ts>.json` (skipping any old `-enc-`
 *      companion row), fetch the blob body, validate, index it in the
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
 * staker, we attempt the hybrid decrypt (`wrappedKey` →
 * Seal-decrypt → AES key → AES-decrypt(`encryptedPayload`)).
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
import { useSealDecrypt } from './useSealDecrypt';
import { SealAccessError, type SealAccessErrorReason } from '@/app/lib/seal';
import {
  listWalrusUploads,
  fetchInsightBlob,
  parseBatchFilename,
} from '@/app/lib/tatum';
import { validateBatchInsight, type MatchAnalysis } from '@/app/lib/match-analyses';

const TATUM_API_KEY =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_TATUM_API_KEY) || '';

export type AccessError = SealAccessErrorReason;

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
  const {
    all: batches,
    set: setBatch,
    setEncryptedResults: cacheEncryptedResults,
    hydrated: batchesHydrated,
  } = useBatchIndex();
  const { isStaker } = useStake();
  const { decrypt: sealDecryptBatch } = useSealDecrypt();
  const [remoteAnalysis, setRemoteAnalysis] = useState<MatchAnalysis | null>(null);
  // Per-key set of `matchKey`s we've already attempted to fetch from
  // Walrus. Lives in a ref so it doesn't trigger re-renders, and so
  // the same key isn't re-fetched if the effect re-runs for any
  // reason.
  const attemptedRef = useRef<Set<string>>(new Set());
  // Per-key set of decrypt attempts (separate from `attemptedRef`
  // because the two flows have different failure modes — plaintext
  // fetch silently fails, decrypt throws `SealAccessError`).
  const decryptAttemptedRef = useRef<Set<string>>(new Set());
  // Tracks the latest `matchKey` we've started an async flow for. The
  // Walrus fetch and the Seal decrypt can each take 5–10s (key-server
  // roundtrip). If the user clicks to a different market mid-flow, the
  // in-flight IIFE's `setRemoteAnalysis(...)` would otherwise clobber
  // state for the new matchKey. Both IIFEs capture `matchKey` into a
  // local `myKey` and bail out if this ref no longer matches.
  const liveMatchKeyRef = useRef<string | null>(null);

  // Step 1: local per-match cache.
  const local: MatchAnalysis | null =
    matchKey && analysesHydrated ? getByMatchKey(matchKey) ?? null : null;

  // Step 2: search the batch-index cache (plaintext `results`). Linear
  // scan, but bounded by the 100-entry cap on the index (and each batch
  // is ~12 markets, so worst case is ~1,200 lookups per call — fine
  // for a 60 fps hook when called from a single component).
  const fromIndex: MatchAnalysis | null =
    matchKey && batchesHydrated
      ? (batches.find((b) => b.results[matchKey] != null)?.results[matchKey] ?? null)
      : null;

  // Step 2b: encrypted-slice cache (set after a successful decrypt on
  // this device — `BatchInsight.encryptedResults`). Same linear scan
  // but on the post-decrypt map. Hits when a staker has previously
  // decrypted this batch on the same device.
  const fromEncryptedCache: MatchAnalysis | null =
    matchKey && batchesHydrated
      ? (batches.find((b) => b.encryptedResults?.[matchKey] != null)
          ?.encryptedResults?.[matchKey] ?? null)
      : null;

  // Step 2c: find the batch gating this key in its encrypted slice.
  // Used to (a) decide whether to attempt a decrypt and (b) know
  // which `batchId` to read `wrappedKey` / `encryptedPayload` /
  // `keyId` from. `null` for keys that don't appear in any
  // encrypted-slice list (so we know to skip the decrypt path
  // entirely).
  const gatedBatch = useMemo(() => {
    if (!matchKey || !batchesHydrated) return null;
    return batches.find((b) => b.encryptedMatchKeys?.includes(matchKey) ?? false) ?? null;
  }, [matchKey, batchesHydrated, batches]);

  // Step 2d: detect that the key lives in an encrypted slice but the
  // current wallet can't decrypt it. We only flag this when the
  // wallet has loaded and is NOT a staker — otherwise we'd flash the
  // locked CTA for the first ~30s of `useStake`'s poll. If the wallet
  // IS a staker, the decrypt effect below handles the failure
  // (mapping `SealAccessError` to `accessError` on the fly).
  const accessError: AccessError | null = useMemo<AccessError | null>(() => {
    if (!matchKey || !batchesHydrated) return null;
    if (local || fromIndex || fromEncryptedCache || remoteAnalysis) return null;
    if (!gatedBatch) return null;
    if (isStaker) return null; // decrypt path below will surface a real reason
    return 'NO_SUBSCRIPTION';
  }, [
    matchKey,
    batchesHydrated,
    local,
    fromIndex,
    fromEncryptedCache,
    remoteAnalysis,
    gatedBatch,
    isStaker,
  ]);

  // Decrypt-failure surfacing. When the decrypt attempt below throws
  // `SealAccessError`, we mirror it into `accessError` so the UI can
  // render the right CTA ("Subscription expired" vs "Stake to unlock").
  const [decryptError, setDecryptError] = useState<AccessError | null>(null);

  // Step 3: lazy fetch from Walrus. Triggered only when both stores
  // are hydrated AND neither local nor index has a hit. The
  // `attemptedRef` makes this a no-op on subsequent calls.
  //
  // No cancellation flag here. ComparePageClient.tsx hit the same bug
  // (cleanup firing on every re-render because deps were unstable
  // wrapper objects) and dropping the post-await `setBatch` /
  // `setRemoteAnalysis` side effects. Same shape here: `batches` is a
  // fresh `Object.values(...).sort(...)` on every BatchIndexProvider
  // render, so a cancellation-flag cleanup would fire on every parent
  // re-render and silently drop the success path. `attemptedRef`
  // already prevents re-fetching the same matchKey — nothing left to
  // cancel.
  useEffect(() => {
    if (!matchKey) return;
    if (!analysesHydrated || !batchesHydrated) return; // wait for hydration
    if (local || fromIndex || fromEncryptedCache) return; // already have a hit
    if (!TATUM_API_KEY) return; // no API key → can't fetch
    if (attemptedRef.current.has(matchKey)) return; // already tried
    attemptedRef.current.add(matchKey);
    // Track which matchKey this IIFE is for. See `liveMatchKeyRef`.
    liveMatchKeyRef.current = matchKey;

    void (async () => {
      const myKey = matchKey;
      try {
        const rows = await listWalrusUploads(TATUM_API_KEY, { limit: 50 });
        if (liveMatchKeyRef.current !== myKey) return; // user moved on
        // Build a quick lookup of plaintext filenames in the index so we
        // can skip any old `-enc-` companion row (the v3 two-blob shape
        // — its body was ciphertext, not parseable as BatchInsight).
        const plaintextFilenames = new Set<string>();
        for (const b of batches) {
          if (b.plaintextFilename) plaintextFilenames.add(b.plaintextFilename);
        }
        // Newest first — stop at the first batch whose body contains
        // the requested matchKey. Walrus has no native "lookup by
        // key" endpoint, so we walk the list. In practice most users
        // will have 1–5 batches.
        for (const row of rows) {
          if (row.status !== 'CERTIFIED') continue;
          if (!row.downloadUrlByQuiltId) continue;
          const parsed = parseBatchFilename(row.filename);
          if (!parsed) continue;
          // v3 two-blob shape: skip the encrypted companion row.
          if (parsed.encrypted) continue;
          // If we've already fetched this plaintext blob and it
          // didn't have the key, skip — the previous pass already
          // indexed it.
          if (plaintextFilenames.has(row.filename)) {
            const cached = batches.find((b) => b.plaintextFilename === row.filename);
            if (cached?.results[matchKey]) {
              setRemoteAnalysis(cached.results[matchKey]);
              return;
            }
            continue;
          }
          const raw = await fetchInsightBlob<unknown>(row.downloadUrlByQuiltId);
          if (liveMatchKeyRef.current !== myKey) return; // user moved on
          const insight = validateBatchInsight(raw);
          if (!insight) continue;
          // Index the body for future reads regardless of whether it
          // contains the requested key — other Predict-page markets
          // may also be in the same batch.
          setBatch(insight);
          if (insight.results[matchKey]) {
            setRemoteAnalysis(insight.results[matchKey]);
            return;
          }
        }
        // No batch had this key.
        if (liveMatchKeyRef.current !== myKey) return;
        setRemoteAnalysis(null);
      } catch {
        // Silent — Walrus unreachable / 4xx / 5xx all collapse to
        // "no insight available". The user can re-run an analysis on
        // the Compare page to populate.
        if (liveMatchKeyRef.current !== myKey) return;
        setRemoteAnalysis(null);
      }
    })();
    // We intentionally depend on `local` and `fromIndex` so the effect
    // re-runs (and short-circuits via the early return) when a cache
    // hit arrives. The `setBatch` dep keeps the effect stable across
    // store identity changes (it's a useCallback). `batches` is
    // included so a freshly-loaded index re-evaluates the skip.
    // `fromEncryptedCache` short-circuits on a decrypt hit.
  }, [
    matchKey,
    analysesHydrated,
    batchesHydrated,
    local,
    fromIndex,
    fromEncryptedCache,
    setBatch,
    batches,
  ]);

  // Step 4: staker-only hybrid decrypt. Triggered when:
  //   - the key is gated by an encrypted slice (gatedBatch != null)
  //   - the wallet is a staker AND the gatedBatch carries
  //     `wrappedKey` + `encryptedPayload` + `keyId` inline
  //   - we don't already have a hit from local / plaintext index / decrypt cache
  //   - we haven't already attempted this key
  // On success: write `BatchInsight.encryptedResults` (cached for
  // re-reads) and push into `match-analyses-store`. On `SealAccessError`,
  // surface the structured reason via `accessError` so the UI shows
  // the right CTA. On any other error: silent (re-tried on next mount).
  //
  // No cancellation flag here. ComparePageClient.tsx hit the same bug
  // (cleanup firing on every re-render because deps were unstable
  // wrapper objects) and dropping the post-await `cacheEncryptedResults`
  // + `setRemoteAnalysis` side effects. Same shape here: the deps
  // include `gatedBatch`, `local`, `fromIndex`, `fromEncryptedCache` —
  // all of which can be derived from `batches` (a fresh array on every
  // BatchIndexProvider render) — so a cancellation-flag cleanup would
  // fire on every parent re-render and silently drop the success path.
  // `decryptAttemptedRef` already prevents re-decrypting the same
  // matchKey — nothing left to cancel.
  useEffect(() => {
    if (!matchKey) return;
    if (!analysesHydrated || !batchesHydrated) return;
    if (!isStaker) return; // non-stakers: leave `accessError: 'NO_SUBSCRIPTION'` in place
    if (!gatedBatch) return; // not in any encrypted slice
    if (local || fromIndex || fromEncryptedCache) return; // already have a hit
    if (
      !gatedBatch.wrappedKey ||
      !gatedBatch.encryptedPayload ||
      !gatedBatch.keyId
    ) {
      return; // metadata missing — old v3 blob without inline encryption
    }
    if (decryptAttemptedRef.current.has(matchKey)) return;
    decryptAttemptedRef.current.add(matchKey);
    // Track which matchKey this IIFE is for. See `liveMatchKeyRef`.
    liveMatchKeyRef.current = matchKey;

    void (async () => {
      const myKey = matchKey;
      try {
        const decrypted = await sealDecryptBatch({
          wrappedKeyB64: gatedBatch.wrappedKey!,
          encryptedPayloadB64: gatedBatch.encryptedPayload!,
          keyIdHex: gatedBatch.keyId!,
        });
        if (liveMatchKeyRef.current !== myKey) return; // user moved on
        // Cache for re-reads + push into the per-match store so the
        // popover shows the analysis immediately.
        cacheEncryptedResults(gatedBatch.batchId, decrypted);
        // Also surface as `remoteAnalysis` so the merge at the bottom
        // picks it up on the same render (the index-store update is
        // async w.r.t. this render).
        const target = decrypted[myKey];
        if (target) setRemoteAnalysis(target);
      } catch (e: unknown) {
        if (liveMatchKeyRef.current !== myKey) return;
        if (e instanceof SealAccessError) {
          setDecryptError(e.reason);
        }
        // Non-Seal errors (network / key-server 5xx) — silent; the
        // next mount will retry via `decryptAttemptedRef` reset.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    matchKey,
    analysesHydrated,
    batchesHydrated,
    isStaker,
    gatedBatch,
    local,
    fromIndex,
    fromEncryptedCache,
    sealDecryptBatch,
    cacheEncryptedResults,
  ]);

  return {
    analysis: local ?? fromIndex ?? fromEncryptedCache ?? remoteAnalysis,
    // decryptError overrides the metadata-only accessError when a real
    // decrypt attempt failed — gives the UI a more specific reason.
    accessError: accessError ?? decryptError,
    isReady: analysesHydrated && batchesHydrated,
  };
}