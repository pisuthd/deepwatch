'use client';

/**
 * In-memory index of `BatchInsight` blob bodies fetched from Walrus.
 *
 * # Storage model — Walrus is the source of truth
 *
 * Per user direction (Part 6): no localStorage anywhere. Walrus is
 * the only durable home for AI batches. This store is a pure
 * in-memory React context:
 *
 *   - `refresh()` calls `listWalrusUploads`, fetches every CERTIFIED
 *     batch blob body (single blob per batch in v4+), validates, and
 *     indexes them by `batchId`. Called on Compare-page mount + after
 *     every successful `AiBatchProvider` upload.
 *   - The encrypted slice lives INLINE in the same blob (hybrid
 *     Seal+AES — see `lib/aes.ts`); decryption happens in
 *     `ComparePageClient`'s hydration effect or `useMatchInsight`
 *     after the read side fetches the body.
 *   - `hydrated` flips to `true` once `refresh()` has resolved (or
 *     failed). Consumers wait on this to know whether the index has
 *     caught up.
 *
 * Source of truth: Tatum/Walrus. This is a **read cache** — the only
 * state is what `refresh()` last pulled. Re-mounts and hard reloads
 * re-fetch from Walrus (no localStorage to bail out early).
 *
 * Shape: `Record<batchId, BatchInsight>`.
 *
 * API:
 *   - `getByBatchId(id)` — sync lookup
 *   - `set(insight)` — single write, used by `useMatchInsight` after
 *     a Walrus lazy-fetch
 *   - `setMany(insights)` — bulk write, used by `AiBatchProvider`
 *   - `remove(id)` / `clear()` — direct mutations
 *   - `all` — array view (newest first, sorted in `refresh()`)
 *   - `latest()` — the single newest batch
 *   - `hydrated` — true after the first `refresh()` resolves
 *   - `refresh()` — pull from Walrus, replace all entries
 */

import {
  createContext,
  useCallback,
  useContext,
  useReducer,
  useRef,
} from 'react';
import type { ReactNode } from 'react';
import {
  listWalrusUploads,
  fetchInsightBlob,
  parseBatchFilename,
} from '../lib/tatum';
import {
  validateBatchInsight,
  type BatchInsight,
  type MatchAnalysis,
} from '../lib/match-analyses';
import { useInsightSource } from '../context/InsightSourceContext';
import { getLocalBatches } from '../lib/local-insights';

const TATUM_API_KEY =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_TATUM_API_KEY) || '';

interface BatchIndexState {
  /** Keyed by `batchId` for O(1) lookup. */
  byBatchId: Record<string, BatchInsight>;
  hydrated: boolean;
  /** True while a refresh is in flight. */
  refreshing: boolean;
  /** Unix ms of the last successful refresh. */
  lastRefreshedAt: number | null;
}

const initialState: BatchIndexState = {
  byBatchId: {},
  hydrated: false,
  refreshing: false,
  lastRefreshedAt: null,
};

type Action =
  | { type: 'SET'; insight: BatchInsight }
  | { type: 'SET_MANY'; insights: BatchInsight[] }
  | {
      type: 'SET_ENCRYPTED_RESULTS';
      batchId: string;
      results: Record<string, MatchAnalysis>;
    }
  | { type: 'REMOVE'; batchId: string }
  | { type: 'CLEAR' }
  | { type: 'REFRESH_START' }
  | {
      type: 'REFRESH_END';
      byBatchId: Record<string, BatchInsight>;
      lastRefreshedAt: number;
    };

function reducer(state: BatchIndexState, action: Action): BatchIndexState {
  switch (action.type) {
    case 'SET': {
      const next = { ...state.byBatchId, [action.insight.batchId]: action.insight };
      return { ...state, byBatchId: next };
    }
    case 'SET_MANY': {
      const next = { ...state.byBatchId };
      for (const i of action.insights) next[i.batchId] = i;
      return { ...state, byBatchId: next };
    }
    case 'SET_ENCRYPTED_RESULTS': {
      const existing = state.byBatchId[action.batchId];
      if (!existing) return state; // batch not indexed yet — drop silently
      const next = {
        ...state.byBatchId,
        [action.batchId]: { ...existing, encryptedResults: action.results },
      };
      return { ...state, byBatchId: next };
    }
    case 'REMOVE': {
      const next = { ...state.byBatchId };
      delete next[action.batchId];
      return { ...state, byBatchId: next };
    }
    case 'CLEAR':
      return { ...state, byBatchId: {} };
    case 'REFRESH_START':
      return { ...state, refreshing: true };
    case 'REFRESH_END':
      return {
        byBatchId: action.byBatchId,
        hydrated: true,
        refreshing: false,
        lastRefreshedAt: action.lastRefreshedAt,
      };
  }
}

const BatchIndexContext = createContext<{
  state: BatchIndexState;
  getByBatchId: (id: string) => BatchInsight | null;
  set: (insight: BatchInsight) => void;
  setMany: (insights: BatchInsight[]) => void;
  /**
   * Cache the Seal-decrypted entries for a batch. Populated by
   * `useSealDecrypt` after a successful `sealClient.decrypt`; subsequent
   * reads of `getByBatchId(id).encryptedResults` skip the decrypt
   * roundtrip until the next refresh. Silently no-ops if the batch is
   * not in the index yet.
   */
  setEncryptedResults: (batchId: string, results: Record<string, MatchAnalysis>) => void;
  remove: (batchId: string) => void;
  clear: () => void;
  all: BatchInsight[];
  latest: BatchInsight | null;
  refresh: () => Promise<void>;
} | null>(null);

export function BatchIndexProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  // Per-refresh guard: avoid concurrent `refresh()` calls fighting each
  // other. The ref holds the most recent in-flight promise so callers
  // can `await` the same one.
  const inflightRef = useRef<Promise<void> | null>(null);
  const { source } = useInsightSource();

  const refresh = useCallback(async (): Promise<void> => {
    if (inflightRef.current) return inflightRef.current;

    // Local-source branch: read straight from `lib/local-insights.ts`,
    // skip the Tatum roundtrip entirely. SSR-safe (empty array on the
    // server; hydrate on the client). Mark hydrated so consumers
    // unblock.
    if (source === 'local') {
      dispatch({ type: 'REFRESH_START' });
      try {
        const localBatches = getLocalBatches();
        const byBatchId: Record<string, BatchInsight> = {};
        for (const b of localBatches) byBatchId[b.batchId] = b;
        dispatch({
          type: 'REFRESH_END',
          byBatchId,
          lastRefreshedAt: Date.now(),
        });
      } finally {
        inflightRef.current = null;
      }
      return;
    }

    // Walrus-source branch (default): existing Tatum roundtrip.
    if (!TATUM_API_KEY) {
      // No API key → mark hydrated so consumers don't block forever.
      // The empty index is the correct empty state.
      dispatch({
        type: 'REFRESH_END',
        byBatchId: {},
        lastRefreshedAt: Date.now(),
      });
      return;
    }

    dispatch({ type: 'REFRESH_START' });
    const promise = (async () => {
      try {
        const rows = await listWalrusUploads(TATUM_API_KEY, { limit: 50 });

        // Single-blob batches (v4+): each `analysis-batch-<id>-<ts>.json`
        // holds the plaintext free slice + base64 AES ciphertext +
        // base64 wrapped key. Older two-blob uploads (v3, plaintext +
        // `-enc-` companion) are tolerated by the filename parser but
        // will only populate the plaintext `results` map from the
        // primary row — the `-enc-` row is skipped (no JSON body to
        // fetch).
        const byBatchId: Record<string, BatchInsight> = {};
        const newestByBatchId = new Map<string, (typeof rows)[number]>();
        for (const row of rows) {
          if (row.status !== 'CERTIFIED') continue;
          const parsed = parseBatchFilename(row.filename);
          if (!parsed) continue;
          // Skip old-style `-enc-` companion rows. Their body was
          // ciphertext, not a parseable BatchInsight JSON.
          if (parsed.encrypted) continue;
          const existing = newestByBatchId.get(parsed.batchId);
          if (!existing || parsed.timestamp > parseBatchFilename(existing.filename)!.timestamp) {
            newestByBatchId.set(parsed.batchId, row);
          }
        }

        await Promise.all(
          Array.from(newestByBatchId.entries()).map(async ([batchId, row]) => {
            if (!row.downloadUrlByQuiltId) return;
            try {
              const raw = await fetchInsightBlob<unknown>(row.downloadUrlByQuiltId);
              const insight = validateBatchInsight(raw);
              if (insight) byBatchId[batchId] = insight;
            } catch {
              // Single-blob failure → skip. We still mark the index
              // hydrated at the end so consumers don't block forever.
            }
          }),
        );

        dispatch({
          type: 'REFRESH_END',
          byBatchId,
          lastRefreshedAt: Date.now(),
        });
      } catch {
        // Whole-list failure → empty index, hydrated=true.
        dispatch({
          type: 'REFRESH_END',
          byBatchId: {},
          lastRefreshedAt: Date.now(),
        });
      } finally {
        inflightRef.current = null;
      }
    })();
    inflightRef.current = promise;
    return promise;
  }, [source]);

  const getByBatchId = useCallback(
    (id: string): BatchInsight | null => state.byBatchId[id] ?? null,
    [state.byBatchId],
  );

  const set = useCallback((insight: BatchInsight): void => {
    dispatch({ type: 'SET', insight });
  }, []);

  const setMany = useCallback((insights: BatchInsight[]): void => {
    dispatch({ type: 'SET_MANY', insights });
  }, []);

  const setEncryptedResults = useCallback(
    (batchId: string, results: Record<string, MatchAnalysis>): void => {
      dispatch({ type: 'SET_ENCRYPTED_RESULTS', batchId, results });
    },
    [],
  );

  const remove = useCallback((batchId: string): void => {
    dispatch({ type: 'REMOVE', batchId });
  }, []);

  const clear = useCallback((): void => {
    dispatch({ type: 'CLEAR' });
  }, []);

  // Newest-first array view (sorted by `createdAt` desc).
  const all = Object.values(state.byBatchId).sort((a, b) => b.createdAt - a.createdAt);
  const latest = all[0] ?? null;

  return (
    <BatchIndexContext.Provider
      value={{
        state,
        getByBatchId,
        set,
        setMany,
        setEncryptedResults,
        remove,
        clear,
        all,
        latest,
        refresh,
      }}
    >
      {children}
    </BatchIndexContext.Provider>
  );
}

export function useBatchIndex() {
  const ctx = useContext(BatchIndexContext);
  if (!ctx) {
    throw new Error('useBatchIndex must be used inside <BatchIndexProvider>');
  }
  return {
    state: ctx.state,
    hydrated: ctx.state.hydrated,
    refreshing: ctx.state.refreshing,
    lastRefreshedAt: ctx.state.lastRefreshedAt,
    getByBatchId: ctx.getByBatchId,
    set: ctx.set,
    setMany: ctx.setMany,
    setEncryptedResults: ctx.setEncryptedResults,
    remove: ctx.remove,
    clear: ctx.clear,
    all: ctx.all,
    latest: ctx.latest,
    refresh: ctx.refresh,
  };
}
