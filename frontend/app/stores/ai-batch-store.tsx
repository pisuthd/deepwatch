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
import {
  generateInsightBatch,
  type InsightBatchChunk,
} from '../lib/minimax';
import type { CmcContext, MatchAnalysis } from '../lib/match-analyses';
import type { DeepBookMatch } from '../lib/match';
import {
  uploadInsightToWalrus,
  pollWalrusStatus,
  batchFilename,
} from '../lib/tatum';

// Tatum API key is sourced from the same env var the old code used. The
// helper accepts the key as a parameter (see `lib/tatum.ts`), so we read
// it here and pass it through. Reads via `process.env` work on both the
// server (initial render) and the client (bundled via NEXT_PUBLIC_).
const TATUM_API_KEY =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_TATUM_API_KEY) || '';

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
  const { setMany } = useMatchAnalyses();
  const { set: setBatchIndex } = useBatchIndex();
  const { notify } = useToast();

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
   * a toast but do not block the UI or revert the local cache.
   * Declared before `prepareBatch` so it can be referenced without a
   * circular-dep warning.
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
      try {
        const json = JSON.stringify(batch, null, 2);
        const file = new File([json], batchFilename(batch.batchId, batch.createdAt), {
          type: 'application/json',
        });
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
          // Cache the body locally so the Recent Batches panel and the
          // Predict page don't need to re-fetch.
          setBatchIndex(batch);
          notify(`Batch ${batch.batchId} saved to Walrus.`, {
            variant: 'success',
            title: 'Saved to Walrus',
            duration: 4000,
          });
        } else if (final.status === 'FAILED') {
          notify(
            final.errorMessage ?? 'Walrus rejected the upload.',
            { variant: 'error', title: 'Walrus upload failed' },
          );
        } else {
          notify(
            `Batch still uploading — will appear on the Overview page once Walrus certifies it.`,
            { variant: 'info', title: 'Upload in progress' },
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Walrus upload failed';
        notify(msg, { variant: 'error', title: 'Upload failed' });
      }
    },
    [notify, setBatchIndex],
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

      // Guard: if the model produced 0 valid tool calls, don't persist
      // an empty batch to localStorage and don't upload a 0-market blob
      // to Walrus. Surface a clear error instead so the user can retry.
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

      // 5. Persist to useMatchAnalyses in one dispatch.
      setMany(persistedEntries);

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
  }, [abortBatch, notify, setMany, uploadBatchInBackground]);

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
