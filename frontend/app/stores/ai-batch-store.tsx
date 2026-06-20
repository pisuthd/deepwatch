'use client';

/**
 * AiBatchProvider — owns the AI batch lifecycle as a top-level React
 * context. The previous design (Part 2) lived this state inside
 * `AiAnalyseModal`, which meant closing the modal aborted the SSE
 * consumer. Moving the state machine up to the provider means:
 *
 *   1. Closing the modal mid-stream does NOT stop the batch.
 *   2. Reopening the modal (via the dock pill or the "Analyse" button on
 *      any row) shows the current state — no need to refetch.
 *   3. A "Start a new batch" call aborts the in-flight one and starts
 *      fresh, instead of needing the modal to be open.
 *   4. Completion fires a toast (per user direction: "toast + reopen
 *      prompt") even if the user has navigated away from the Compare page.
 *
 * The provider is mounted in `app/providers.tsx` (alongside the other
 * providers), so it survives any in-app route navigation. It is NOT
 * persisted across hard reloads — the durability lives in Walrus (the
 * completed batch is uploaded there) and in the local caches
 * (`useMatchAnalyses` for per-row, `useBatchIndex` for batch bodies).
 *
 * State machine:
 *
 *   idle → reviewing → analysing → done   (normal happy path)
 *   idle → reviewing                       (user opens modal, then closes)
 *   reviewing → idle                       (user cancels the review)
 *   analysing → done                       (stream completed)
 *   analysing → error                      (upstream failure, e.g. 502)
 *   analysing → analysing                  (new prepareBatch aborts the
 *                                            in-flight consumer)
 *   analysing → idle                       (explicit clearBatch)
 *
 * The new `reviewing` phase (Part 4) is the critical fix for the
 * "modal auto-started the batch the moment I clicked Analyse" feedback.
 * The user clicks Analyse → modal opens in `reviewing` (no SSE fired) →
 * they can review the match list + start the batch themselves, or close
 * the modal without spending a cent. Only `commitBatch()` actually kicks
 * the SSE consumer.
 *
 * Hot-reload safety: on mount, if `phase` is somehow stuck at `analysing`
 * (e.g. the previous tab was killed mid-stream), we downgrade to `idle`
 * and surface a one-line warning toast.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useMatchAnalyses } from './match-analyses-store';
import { useBatchIndex } from './batch-index-store';
import { useToast } from '../context/ToastContext';
import { useNetworkConfig } from '../hooks/useNetworkConfig';
import { useNetwork } from '../context/NetworkContext';
import {
  generateInsightBatch,
  type InsightBatchChunk,
} from '../lib/minimax';
import type { BatchInsight, CmcContext, MatchAnalysis } from '../lib/match-analyses';
import type { DeepBookMatch } from '../lib/match';
import {
  uploadInsightToWalrus,
  pollWalrusStatus,
  batchFilename,
} from '../lib/tatum';
import {
  buildSealSuiClient,
  getSealClient,
  hexToBytes,
  sealEncrypt,
} from '../lib/seal';
import { generateAesKey, aesEncrypt } from '../lib/aes';
import { toHex } from '@mysten/sui/utils';

// Tatum API key is sourced from the same env var the old code used. The
// helper accepts the key as a parameter (see `lib/tatum.ts`), so we read
// it here and pass it through. Reads via `process.env` work on both the
// server (initial render) and the client (bundled via NEXT_PUBLIC_).
const TATUM_API_KEY =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_TATUM_API_KEY) || '';

/**
 * Free-slice composition. The plaintext blob carries a public preview
 * so any visitor can see the AI's directional read on a few markets
 * without paying the stake fee. The encrypted slice carries the full
 * set behind the Seal gate.
 *
 * Per user direction (Part 6 / preview-too-short fix):
 *   - Keep the first `HEAD_SIZE` markets as the "head" (stable, in
 *     insertion order — same as the old behaviour).
 *   - Pick `MIDDLE_SIZE` more markets from the middle of the
 *     remainder, evenly spaced. Gives a wider preview without
 *     putting too many on the public slice (the gate is the product).
 *   - Total free slice: `HEAD_SIZE + MIDDLE_SIZE = 6` markets.
 *
 * Small batches (≤ `HEAD_SIZE + MIDDLE_SIZE` total entries) include
 * everything — no point encrypting a 4-market batch.
 */
const HEAD_SIZE = 3;
const MIDDLE_SIZE = 3;

/**
 * Pick `count` entries from `entries` evenly spaced through its
 * length. Deterministic (no randomness) so two consecutive uploads
 * of the same batch produce the same free slice.
 */
function pickMiddleEntries<T>(entries: T[], count: number): T[] {
  const n = entries.length;
  const size = Math.min(count, n);
  if (size <= 0) return [];
  if (size >= n) return entries.slice();
  const out: T[] = [];
  for (let i = 0; i < size; i++) {
    // Distribute the picks through `(0, n)` with a midpoint bias.
    // For `n=20, size=3`: indices 5, 10, 15.
    const idx = Math.floor((n * (i + 1)) / (size + 1));
    out.push(entries[idx]);
  }
  return out;
}

export type BatchPhase = 'idle' | 'reviewing' | 'analysing' | 'done' | 'error';

export interface AiBatchState {
  phase: BatchPhase;
  /** Snapshot of matches at the moment the batch was prepared. */
  matches: DeepBookMatch[] | null;
  /** matchKey → MatchAnalysis for every result received so far. */
  latestResults: Record<string, MatchAnalysis>;
  /** Tool-call events seen so far (cosmetic — used by the progress list). */
  toolStarted: number;
  /** Aggregated thinking chunks (for the collapsible reasoning panel). */
  thinkingBuf: string;
  /** Aggregated text chunks. */
  textBuf: string;
  /** Error message when phase === 'error'. */
  error: string | null;
  /** When the current batch was kicked (Unix ms). Null in `reviewing`. */
  startedAt: number | null;
  /** The batch's stable ID — also used as the Walrus filename stem. */
  batchId: string | null;
  /** When the batch finished (Unix ms) — set on done/error. */
  finishedAt: number | null;
}

export interface AiBatchApi {
  state: AiBatchState;
  /**
   * Stage a batch for review. Stores the matches + cmcContext, opens the
   * modal in `reviewing`, but does NOT fire the SSE consumer. The user
   * sees the match list and a "Start analysis" button. Only `commitBatch`
   * (or clicking Start) actually starts the run.
   *
   * Calling this while a batch is `analysing` aborts the in-flight one
   * first (matching the old `startBatch` behaviour for the re-analyse
   * path).
   */
  prepareBatch: (matches: DeepBookMatch[], cmcContext: CmcContext | null) => void;
  /**
   * Actually fire the SSE consumer. No-op unless `phase === 'reviewing'`.
   * If called from a different phase (e.g. from the Done panel's
   * "Re-analyse" button), it re-prepares from the current `state.matches`
   * first so the flow is consistent.
   */
  commitBatch: () => void;
  /** Abort the in-flight batch without starting a new one. No-op if idle. */
  abortBatch: () => void;
  /** Reset to idle, dropping the last batch's results from the viewer. */
  clearBatch: () => void;
  /** Whether the modal is currently open. */
  isModalOpen: boolean;
  setModalOpen: (open: boolean) => void;
}

const AiBatchContext = createContext<AiBatchApi | null>(null);

const IDLE_STATE: AiBatchState = {
  phase: 'idle',
  matches: null,
  latestResults: {},
  toolStarted: 0,
  thinkingBuf: '',
  textBuf: '',
  error: null,
  startedAt: null,
  batchId: null,
  finishedAt: null,
};

const REVIEWING_STATE_TEMPLATE: Omit<AiBatchState, 'matches'> = {
  phase: 'reviewing',
  latestResults: {},
  toolStarted: 0,
  thinkingBuf: '',
  textBuf: '',
  error: null,
  startedAt: null,
  batchId: null,
  finishedAt: null,
};

function randomBatchId(): string {
  // 8-char hex string. `crypto.getRandomValues` is available in both
  // browser and modern Node; fall back to Math.random for SSR safety.
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
}

export function AiBatchProvider({ children }: { children: ReactNode }) {
  const { setMany, markUploaded } = useMatchAnalyses();
  const { set: setBatchIndex } = useBatchIndex();
  const { notify } = useToast();
  const cfg = useNetworkConfig();
  const { network } = useNetwork();

  const [state, setState] = useState<AiBatchState>(IDLE_STATE);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  // Refs that don't drive rendering but must persist across the batch's
  // lifetime: the AbortController, the buffer of results to flush on done,
  // and the cmcContext for the active batch. cmcContext is a ref (not
  // state) because it's set during `prepareBatch` and read inside the
  // SSE consumer's `applyChunk` — promoting it to state would force a
  // needless re-render every time we accept a new context.
  const abortRef = useRef<AbortController | null>(null);
  const cmcContextRef = useRef<CmcContext | null>(null);
  const preparedMatchesRef = useRef<DeepBookMatch[] | null>(null);
  // Buffer of in-flight results waiting to be bulk-persisted.
  const bufRef = useRef<Array<[string, MatchAnalysis]>>([]);

  // Hot-reload safety: on mount, ensure phase is not stuck at analysing.
  // (Impossible on a clean mount because `useState(IDLE_STATE)`, but
  // possible across HMR if React preserves the provider's state.)
  useEffect(() => {
    setState((prev) => {
      if (prev.phase !== 'analysing' && prev.phase !== 'reviewing') return prev;
      notify('Previous batch was interrupted. Click Analyse to restart.', {
        variant: 'warning',
        key: 'ai-batch-hmr-warning',
      });
      return { ...IDLE_STATE };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abortBatch = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  /**
   * Upload a completed batch to Walrus. Best-effort — failures surface
   * a toast but do not block the UI or revert the in-memory cache.
   * Declared before `prepareBatch` so it can be referenced without a
   * circular-dep warning.
   *
   * v4 (single-blob, hybrid Seal + AES): per user direction (cost
   * feedback: two Walrus uploads per batch was burning Tatum credits),
   * the structure is now:
   *
   *   - **One JSON blob** containing everything:
   *       - `results` — plaintext `MatchAnalysis` map for the first
   *         `HEAD_SIZE + MIDDLE_SIZE` markets (the public "taster",
   *         anyone can read).
   *       - `encryptedPayload` — base64 AES-256-GCM ciphertext of the
   *         FULL set JSON (`{ batchId, createdAt, cmcContext, results }`).
   *       - `wrappedKey` — base64 Seal ciphertext wrapping the AES
   *         key. Only stakers in the matching pool can recover the
   *         key via Seal.
   *       - `keyId`, `poolObjectId` — metadata needed to build the
   *         `seal_approve` PTB on the decrypt side.
   *       - `encryptedMatchKeys` — unencrypted list of matchKeys
   *         behind the gate (so `useMatchInsight` knows when to
   *         attempt a decrypt without fetching ciphertext).
   *
   * Halves Walrus upload count vs the v3 "two blobs" approach. Seal's
   * key-server work is also reduced (encrypts 32 bytes instead of the
   * full insight payload) since only the AES key is Seal-wrapped.
   *
   * Access gate is preserved: a non-staker sees the free slice
   * plaintext; a staker Seal-decrypts the wrapped key, then
   * AES-decrypts the payload. Any wallet with a valid, unexpired
   * `Subscription` NFT for the matching pool can recover the key —
   * same as v3.
   */
  const uploadBatchInBackground = useCallback(
    async (batch: BatchInsightForUpload) => {
      if (!TATUM_API_KEY) {
        notify('Skipped Walrus upload — NEXT_PUBLIC_TATUM_API_KEY is not set.', {
          variant: 'warning',
          title: 'Upload skipped',
          duration: 6000,
        });
        return;
      }

      // Split by insertion order — the SSE consumer pushes results in
      // the same order `matches` was provided to the model. We use that
      // to keep the "first N free" rule stable across re-runs.
      const entries = Object.entries(batch.results);
      // Free slice = HEAD_SIZE entries from the head + MIDDLE_SIZE
      // entries from the middle of the remainder. For small batches
      // (≤ HEAD_SIZE + MIDDLE_SIZE) we include everything so we
      // don't waste the encryption roundtrip on a 4-market blob.
      const headEntries = entries.slice(0, HEAD_SIZE);
      const restEntries = entries.slice(HEAD_SIZE);
      const middleEntries = pickMiddleEntries(restEntries, MIDDLE_SIZE);
      const freeEntries =
        entries.length <= HEAD_SIZE + MIDDLE_SIZE
          ? entries.slice()
          : [...headEntries, ...middleEntries];
      const freeResults: Record<string, MatchAnalysis> = Object.fromEntries(freeEntries);
      // The encrypted payload carries the FULL set (not just the
      // tail), so a staker who decrypts it gets everything in one
      // shot — no need to merge preview + decrypted tail.
      const fullResults: Record<string, MatchAnalysis> = Object.fromEntries(entries);
      const encryptedMatchKeys = entries.map(([k]) => k);

      const filename = batchFilename(batch.batchId, batch.createdAt);

      // ─── Pre-compute the Seal namespace + keyId ────────────────────
      // Both are deterministic functions of `(poolObjectIdHex, nonce)`
      // — we choose the nonce upfront (5 random bytes) so the same
      // keyId is what we feed into Seal-encrypt-the-key below AND
      // what we write onto the blob's metadata.
      const poolObjectIdHex = cfg.deepwatch.poolObjectId;
      const sealPackageId = cfg.deepwatch.packageId;
      const hasSealInfra = Boolean(sealPackageId && poolObjectIdHex);

      let keyIdHex: string | undefined;
      let wrappedKeyB64: string | undefined;
      let encryptedPayloadB64: string | undefined;
      let encryptionError: string | null = null;

      if (encryptedMatchKeys.length > 0 && hasSealInfra) {
        try {
          // AES key (32 bytes) for the bulk payload.
          const aesKey = await generateAesKey();

          // Seal-wrap the AES key bytes under the pool's namespace.
          // `sealEncrypt` already accepts arbitrary bytes; the
          // resulting ciphertext is what we embed as `wrappedKey`.
          const poolBytes = hexToBytes(poolObjectIdHex!);
          const nonce = crypto.getRandomValues(new Uint8Array(5));
          keyIdHex = toHex(new Uint8Array([...poolBytes, ...nonce]));

          const sealSuiClient = buildSealSuiClient(network);
          const sealClient = getSealClient(sealSuiClient);
          const sealedKey = await sealEncrypt(
            aesKey,
            poolBytes,
            sealPackageId!,
            sealClient,
            keyIdHex, // pre-computed — ensures the persisted keyId matches what Seal used
          );
          keyIdHex = sealedKey.keyIdHex; // confirm
          wrappedKeyB64 = bufferToBase64(sealedKey.ciphertext);

          // AES-encrypt the FULL set JSON. The plaintext payload
          // includes batchId/createdAt/cmcContext so a decrypt
          // roundtrip can sanity-check we got the right blob.
          const fullJson = new TextEncoder().encode(
            JSON.stringify({
              batchId: batch.batchId,
              createdAt: batch.createdAt,
              cmcContext: batch.cmcContext,
              results: fullResults,
            }),
          );
          encryptedPayloadB64 = await aesEncrypt(fullJson, aesKey);
        } catch (err) {
          encryptionError = err instanceof Error ? err.message : 'Seal encrypt failed';
          // Wipe so we don't write a half-encrypted blob.
          keyIdHex = undefined;
          wrappedKeyB64 = undefined;
          encryptedPayloadB64 = undefined;
        }
      } else if (encryptedMatchKeys.length > 0 && !hasSealInfra) {
        notify(
          `Skipped Seal-encryption of ${encryptedMatchKeys.length} markets — DeepWatch pool is not deployed on this network. The plaintext blob holds everything as a fallback.`,
          {
            variant: 'warning',
            title: 'Encryption skipped',
            duration: 6000,
            key: `seal-skip-${batch.batchId}`,
          },
        );
      }

      if (encryptionError) {
        notify(
          `Failed to encrypt ${encryptedMatchKeys.length} markets: ${encryptionError}`,
          { variant: 'error', title: 'Encryption failed' },
        );
        // Fall through: still upload the plaintext-only blob so the
        // preview is at least available. Without the encrypted fields
        // there's nothing to decrypt later.
      }

      // ─── Build the single blob body ───────────────────────────────
      // Always upload the free slice (preview). The encrypted fields
      // are present iff the Seal step succeeded — missing means the
      // blob is plaintext-only and readers won't attempt a decrypt.
      const singleBlob: BatchInsight = {
        batchId: batch.batchId,
        createdAt: batch.createdAt,
        cmcContext: batch.cmcContext,
        results: freeResults,
        ...(encryptedMatchKeys.length > 0 ? { encryptedMatchKeys } : {}),
        ...(encryptedPayloadB64 ? { encryptedPayload: encryptedPayloadB64 } : {}),
        ...(wrappedKeyB64 ? { wrappedKey: wrappedKeyB64 } : {}),
        ...(keyIdHex ? { keyId: keyIdHex } : {}),
        ...(poolObjectIdHex ? { poolObjectId: poolObjectIdHex } : {}),
        plaintextFilename: filename,
      };

      // ─── Upload the single blob ───────────────────────────────────
      let certified = false;
      try {
        const json = JSON.stringify(singleBlob, null, 2);
        const file = new File([json], filename, { type: 'application/json' });
        const enqueued = await uploadInsightToWalrus(file, TATUM_API_KEY);
        notify(`Uploading batch ${batch.batchId} to Walrus…`, {
          variant: 'info',
          duration: 3000,
        });
        const final = await pollWalrusStatus(enqueued.jobId, TATUM_API_KEY, {
          intervalMs: 2_000,
          maxAttempts: 20,
        });
        if (final.status === 'CERTIFIED') {
          certified = true;
        } else if (final.status === 'FAILED') {
          notify(final.errorMessage ?? 'Walrus rejected the batch upload.', {
            variant: 'error',
            title: 'Walrus upload failed',
          });
        } else {
          notify(
            `Batch still uploading — will appear on the Overview page once Walrus certifies it.`,
            { variant: 'info', title: 'Upload in progress' },
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Walrus upload failed';
        notify(msg, { variant: 'error', title: 'Upload failed' });
        return;
      }

      if (certified) {
        setBatchIndex(singleBlob);
        notify(`Batch ${batch.batchId} saved to Walrus.`, {
          variant: 'success',
          title: 'Saved to Walrus',
          duration: 4000,
        });
      }
    },
    [
      cfg.deepwatch.packageId,
      cfg.deepwatch.poolObjectId,
      network,
      notify,
      setBatchIndex,
    ],
  );

  /**
   * Stage a batch for review. Sets phase to `reviewing` and opens the
   * modal. The SSE consumer is NOT fired here — the user has to click
   * "Start analysis" in the modal (or call `commitBatch` from code).
   *
   * If a batch is already analysing, this aborts it first (matching the
   * pre-Part-4 behaviour for the "user clicked Analyse again" path).
   */
  const prepareBatch = useCallback(
    (matches: DeepBookMatch[], cmcContext: CmcContext | null) => {
      if (matches.length === 0) return;

      // Abort any in-flight batch (analysing or another in-flight review).
      abortBatch();
      bufRef.current = [];
      cmcContextRef.current = cmcContext;
      preparedMatchesRef.current = matches;

      setState({
        ...REVIEWING_STATE_TEMPLATE,
        matches,
      });
      setIsModalOpen(true);
    },
    [abortBatch],
  );

  /**
   * Fire the SSE consumer. The flow is:
   *   1. Abort any in-flight batch.
   *   2. Set state to `analysing` with a fresh batchId + startedAt.
   *   3. Open the modal (no-op if already open).
   *   4. Stream the AI response; on each `result` chunk, append to state.
   *   5. On stream end, persist to useMatchAnalyses + kick off the
   *      Walrus upload in the background.
   *   6. On error, set phase to `error` and surface a toast.
   */
  const commitBatch = useCallback(() => {
    const matches = preparedMatchesRef.current;
    if (!matches || matches.length === 0) return;

    // 1. Abort any in-flight batch.
    abortBatch();
    bufRef.current = [];
    // Note: cmcContextRef is set in prepareBatch and read by applyChunk.
    // If `commitBatch` is called when not in `reviewing` (e.g. re-analyse
    // from the Done panel), we keep whatever's already in the ref.

    const batchId = randomBatchId();
    const startedAt = Date.now();

    // 2. Reset state to analysing.
    setState({
      phase: 'analysing',
      matches,
      latestResults: {},
      toolStarted: 0,
      thinkingBuf: '',
      textBuf: '',
      error: null,
      startedAt,
      batchId,
      finishedAt: null,
    });

    // 3. Make sure the modal is open (no-op if already open).
    setIsModalOpen(true);

    // 4. Fire the SSE consumer.
    const controller = new AbortController();
    abortRef.current = controller;

    const input = matches.map((m) => ({
      key: m.key,
      dbQuestion: m.dbQuestion,
      asset: m.asset,
      expiryMs: m.expiryMs,
      dbProb: m.dbProb,
      polyProb: m.polyProb,
      kalshiProb: m.kalshiProb,
      spread: m.spread,
      polyQuestion: m.polyQuestion,
      kalshiQuestion: m.kalshiQuestion,
      polyUrl: m.polyUrl,
      kalshiUrl: m.kalshiUrl,
    }));

    const cmcContext = cmcContextRef.current;

    const consume = async () => {
      try {
        for await (const chunk of generateInsightBatch(
          { cmcContext, matches: input },
          controller.signal,
        )) {
          applyChunk(chunk);
        }
        // Stream ended cleanly.
        onBatchComplete(batchId, startedAt, matches);
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') {
          // User aborted (or started a new batch). Don't persist partials.
          return;
        }
        console.error('[AiBatchProvider] batch failed:', err);
        setState((prev) => ({
          ...prev,
          phase: 'error',
          error: (err as Error).message ?? 'Unknown error',
          finishedAt: Date.now(),
        }));
        notify(
          (err as Error).message ?? 'AI batch failed.',
          { variant: 'error', title: 'Batch failed' },
        );
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    };

    const applyChunk = (chunk: InsightBatchChunk) => {
      if (chunk.kind === 'result') {
        const now = Date.now();
        const entry: MatchAnalysis = {
          matchKey: chunk.payload.matchKey,
          signal: chunk.payload.signal,
          confidence: chunk.payload.confidence,
          positionSizePct: chunk.payload.positionSizePct,
          reasoning: chunk.payload.reasoning,
          ...(chunk.payload.macroTake ? { macroTake: chunk.payload.macroTake } : {}),
          cmcContext: cmcContextRef.current,
          createdAt: now,
        };
        setState((prev) => ({
          ...prev,
          latestResults: { ...prev.latestResults, [entry.matchKey]: entry },
        }));
        bufRef.current.push([entry.matchKey, entry]);
      } else if (chunk.kind === 'tool_start') {
        setState((prev) => ({ ...prev, toolStarted: prev.toolStarted + 1 }));
      } else if (chunk.kind === 'thinking') {
        setState((prev) => ({ ...prev, thinkingBuf: prev.thinkingBuf + chunk.text }));
      } else if (chunk.kind === 'text') {
        setState((prev) => ({ ...prev, textBuf: prev.textBuf + chunk.text }));
      }
    };

    const onBatchComplete = async (
      completedBatchId: string,
      completedStartedAt: number,
      completedMatches: DeepBookMatch[],
    ) => {
      const persistedEntries = bufRef.current.slice();
      bufRef.current = [];

      const completedAt = Date.now();

      setState((prev) => ({
        ...prev,
        phase: 'done',
        finishedAt: completedAt,
      }));

      // Guard: if the model produced 0 valid tool calls, don't push
      // an empty batch into the in-memory store and don't upload a
      // 0-market blob to Walrus. Surface a clear error instead so the
      // user can retry.
      if (persistedEntries.length === 0) {
        notify(
          `Batch ${completedBatchId} produced 0 valid results out of ${completedMatches.length} markets. The model may have hit a token limit or returned text instead of tool calls. Click Re-analyse to retry.`,
          {
            variant: 'error',
            title: 'AI batch produced no results',
            duration: 0, // sticky — the user needs to see this
            key: `ai-batch-empty-${completedBatchId}`,
          },
        );
        return;
      }

      // 5. Persist to useMatchAnalyses in one dispatch, then mark
      // this batchId as "personally uploaded" so the Compare-page
      // hydration effect (which would otherwise replace the full
      // in-memory result set with the plaintext-only Walrus preview)
      // skips this batch.
      setMany(persistedEntries);
      markUploaded(completedBatchId);

      // 6. Fire the completion toast (per user direction).
      notify(
        `Batch complete — ${persistedEntries.length} of ${completedMatches.length} markets analysed.`,
        {
          variant: 'success',
          title: 'AI batch complete',
          duration: 6000,
          key: `ai-batch-complete-${completedBatchId}`,
          action: {
            label: 'View results',
            onClick: () => setIsModalOpen(true),
          },
        },
      );

      // 7. Build the BatchInsight and upload to Walrus in the background.
      const results: Record<string, MatchAnalysis> = {};
      for (const [k, v] of persistedEntries) results[k] = v;
      const batch: BatchInsightForUpload = {
        batchId: completedBatchId,
        createdAt: completedStartedAt,
        cmcContext: cmcContextRef.current,
        results,
      };
      void uploadBatchInBackground(batch);
    };

    // Kick the consumer. Errors are caught inside `consume`.
    void consume();
  }, [abortBatch, markUploaded, notify, setMany, uploadBatchInBackground]);

  const clearBatch = useCallback(() => {
    abortBatch();
    bufRef.current = [];
    preparedMatchesRef.current = null;
    setState({ ...IDLE_STATE });
  }, [abortBatch]);

  const setModalOpen = useCallback((open: boolean) => {
    setIsModalOpen(open);
    // If the user closes the modal while still in `reviewing`, treat it
    // as a cancel — drop the prepared batch so it doesn't reappear next
    // time they open the modal.
    if (!open) {
      setState((prev) => {
        if (prev.phase !== 'reviewing') return prev;
        return { ...IDLE_STATE };
      });
      preparedMatchesRef.current = null;
    }
  }, []);

  const value: AiBatchApi = {
    state,
    prepareBatch,
    commitBatch,
    abortBatch,
    clearBatch,
    isModalOpen,
    setModalOpen,
  };

  return <AiBatchContext.Provider value={value}>{children}</AiBatchContext.Provider>;
}

export function useAiBatch() {
  const ctx = useContext(AiBatchContext);
  if (!ctx) {
    throw new Error('useAiBatch must be used inside <AiBatchProvider>');
  }
  return ctx;
}

// ─── Internal: a minimal BatchInsight shape for upload ──────────────────────

/**
 * Mirror of `BatchInsight` from `app/lib/match-analyses.ts` but with the
 * `cmcContext` typed as `CmcContext | null` directly (avoids an
 * import-cycle dance with the SSE consumer). Same shape — re-validated
 * on the read side via `validateBatchInsight`.
 */
interface BatchInsightForUpload {
  batchId: string;
  createdAt: number;
  cmcContext: CmcContext | null;
  results: Record<string, MatchAnalysis>;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/**
 * Encode a `Uint8Array` as base64. Mirrors the helper in `lib/aes.ts`
 * (kept private there; duplicated here because the Seal ciphertext is
 * sealed on the encrypt path and we don't want a public round-trip
 * helper).
 */
function bufferToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin);
}
