/**
 * local-insights — browser-local storage for AI batch insights.
 *
 * Free, instant alternative to the Walrus + Tatum path. Every batch
 * the user runs via `Run One-Time Analyse (Local)` lands here; the
 * Compare / Predict pages read from it whenever `useInsightSource()`
 * returns `'local'`.
 *
 * # Why plaintext, no Seal encryption
 *
 * The Walrus path encrypts with AES + Seal-wraps the key so non-stakers
 * can't see the analysis behind a paywall. That has no meaning in the
 * user's own browser — the data is already in the user's session. We
 * persist the **full** results set directly (no free-slice split) and
 * skip `encryptedPayload` / `wrappedKey` / `keyId` / `poolObjectId` /
 * `encryptedMatchKeys` / `encryptedResults`. `BatchInsight` is the
 * shared shape, just with those optional fields absent.
 *
 * # Storage shape
 *
 *   localStorage["deepwatch:local-batches:v1"] =
 *     JSON.stringify({ batches: BatchInsight[] })
 *
 * Versioned key (`v1`) lets us evolve the schema without breaking
 * older browsers. Reads are defensive: any record that fails
 * `validateBatchInsight` is dropped (with a `console.warn`).
 *
 * # SSR
 *
 * Every function is SSR-safe — they short-circuit on `typeof window
 * === 'undefined'`. The Compare / Predict pages gate their reads
 * behind a hydration effect anyway, so SSR returning `[]` is fine.
 */

import { validateBatchInsight, type BatchInsight } from './match-analyses';

const STORAGE_KEY = 'deepwatch:local-batches:v1';

interface LocalBatchesEnvelope {
  batches: BatchInsight[];
}

/**
 * Read the local batch envelope. Returns `{ batches: [] }` if the
 * key is missing, malformed, or not yet hydrated.
 */
function readEnvelope(): LocalBatchesEnvelope {
  if (typeof window === 'undefined') return { batches: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { batches: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { batches: [] };
    const list = (parsed as Partial<LocalBatchesEnvelope>).batches;
    if (!Array.isArray(list)) return { batches: [] };
    return { batches: list };
  } catch (e: any) {
    console.warn('[local-insights] failed to read envelope:', e?.message ?? e);
    return { batches: [] };
  }
}

/**
 * Write the envelope. Returns `true` on success, `false` on quota or
 * serialisation error — callers should surface a toast.
 */
function writeEnvelope(envelope: LocalBatchesEnvelope): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch (e: any) {
    console.warn('[local-insights] failed to write envelope:', e?.message ?? e);
    return false;
  }
}

/**
 * Return every locally-cached batch, newest first. Records that fail
 * `validateBatchInsight` are dropped (corrupt JSON / schema drift) and
 * logged. SSR-safe.
 */
export function getLocalBatches(): BatchInsight[] {
  const { batches } = readEnvelope();
  const validated: BatchInsight[] = [];
  for (const raw of batches) {
    const v = validateBatchInsight(raw);
    if (v) validated.push(v);
  }
  // Newest first — `createdAt` desc.
  return validated.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Return the most recently cached local batch, or `null` if empty.
 * Convenience wrapper used by the Compare / Predict pages on mount.
 */
export function getLatestLocalBatch(): BatchInsight | null {
  const list = getLocalBatches();
  return list.length > 0 ? list[0] : null;
}

/**
 * Return the local batch with the given `batchId`, or `null`.
 */
export function getLocalBatchById(batchId: string): BatchInsight | null {
  return getLocalBatches().find((b) => b.batchId === batchId) ?? null;
}

/**
 * Find the first local batch that contains an analysis for `matchKey`,
 * walking newest-first. Returns `null` if none.
 */
export function findLocalAnalysisForMatch(matchKey: string): BatchInsight | null {
  for (const b of getLocalBatches()) {
    if (b.results[matchKey]) return b;
  }
  return null;
}

/**
 * Persist a batch. If a batch with the same `batchId` already exists,
 * it is replaced (re-running an analysis with the same id is the
 * idempotent re-save path). Returns `true` on success, `false` on
 * quota / serialisation failure (caller toasts).
 */
export function saveLocalBatch(batch: BatchInsight): boolean {
  const validated = validateBatchInsight(batch);
  if (!validated) {
    console.warn('[local-insights] saveLocalBatch: invalid batch, not saved');
    return false;
  }
  const envelope = readEnvelope();
  const idx = envelope.batches.findIndex((b) => b.batchId === validated.batchId);
  if (idx >= 0) {
    envelope.batches[idx] = validated;
  } else {
    envelope.batches.push(validated);
  }
  return writeEnvelope(envelope);
}

/**
 * Remove a single batch by id. No-op if it doesn't exist.
 */
export function removeLocalBatch(batchId: string): void {
  const envelope = readEnvelope();
  const next = envelope.batches.filter((b) => b.batchId !== batchId);
  if (next.length === envelope.batches.length) return;
  writeEnvelope({ batches: next });
}

/**
 * Wipe every local batch. Used by the selector's "Clear local" menu
 * item.
 */
export function clearLocalBatches(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (e: any) {
    console.warn('[local-insights] failed to clear:', e?.message ?? e);
  }
}

/**
 * Return the count of cached batches (after validation). Cheap —
 * reads + validates in one pass. SSR returns `0`.
 */
export function getLocalBatchCount(): number {
  return getLocalBatches().length;
}