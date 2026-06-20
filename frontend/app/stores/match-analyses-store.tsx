'use client';

/**
 * In-memory store for per-match AI analyses (Compare page).
 *
 * # Storage model — Walrus is the source of truth
 *
 * Per user direction (Part 6): no localStorage anywhere. Walrus (via
 * Tatum) is the only durable home for AI analyses. This store is a
 * pure in-memory React context, fed by Walrus hydration:
 *
 *   - On Compare-page mount, `batch-index-store.refresh()` lists the
 *     certified blobs from Walrus, fetches each plaintext (free-slice)
 *     blob body, and calls `hydrateFromWalrus(...)` here.
 *   - Stakers additionally Seal-decrypt the encrypted blob and push
 *     the full set into the same store. See `ComparePageClient`'s
 *     `useEffect`.
 *   - `AiBatchProvider.onBatchComplete` also calls `setMany(...)`
 *     in-memory for the in-flight batch (no Walrus read needed for
 *     the batch the user just kicked).
 *
 * `hydrated` flips to `true` once Walrus hydration completes (or
 * fails). The Compare table's "Stake to unlock" gate waits on
 * `hydrated` so we don't flash locked CTAs for analyses that are
 * still in flight from Walrus.
 *
 * Shape: `Record<matchKey, MatchAnalysis>`.
 *
 * API:
 *   - `getByMatchKey(key)` — sync lookup, used by `AiCell`
 *   - `hydrateFromWalrus(entries, batchId)` — atomic replace with a
 *     Walrus-fetched batch (used on mount + after batch-index refresh)
 *   - `set(key, partial)` — single write, used by `AiBatchProvider`
 *     per result
 *   - `setMany(entries)` — bulk write in one dispatch
 *   - `remove(key)` / `clear()` — direct mutations
 *   - `all` — array view (debug / future list view)
 *   - `hydrated` — true after the first Walrus hydration completes
 *   - `lastHydratedBatchId` — for invalidation on a newer batch
 */

import {
  createContext,
  useCallback,
  useContext,
  useReducer,
} from 'react';
import type { ReactNode } from 'react';
import type { MatchAnalysis } from '../lib/match-analyses';
import { getLocalBatches } from '../lib/local-insights';

interface MatchAnalysesState {
  /** Keyed by `matchKey` (= `DeepBookMatch.key`) for O(1) lookup. */
  byKey: Record<string, MatchAnalysis>;
  /** True once the first Walrus hydration pass has resolved (success
   * or failure — failures stay at empty `byKey` and let the UI show
   * "Stake to unlock" everywhere, which is the correct empty state). */
  hydrated: boolean;
  /** `batchId` of the most recent hydration. Used by callers to know
   * when a newer Walrus batch has appeared. */
  lastHydratedBatchId: string | null;
  /** `batchId` of the most recent batch the user **personally** uploaded
   * (set via `markUploaded`). The hydration effect skips re-hydrating
   * for this batch — the in-memory store already has the full result
   * set (free + encrypted-tail) from the SSE consumer's `setMany`,
   * and replacing it with the plaintext-only Walrus body would lose
   * the encrypted-tail entries the user just saw. */
  lastUploadedBatchId: string | null;
}

const initialState: MatchAnalysesState = {
  byKey: {},
  hydrated: false,
  lastHydratedBatchId: null,
  lastUploadedBatchId: null,
};

type Action =
  | { type: 'HYDRATE'; entries: Record<string, MatchAnalysis>; batchId: string | null }
  | { type: 'SET'; matchKey: string; entry: MatchAnalysis }
  | { type: 'SET_MANY'; entries: Array<[string, MatchAnalysis]> }
  | { type: 'REMOVE'; matchKey: string }
  | { type: 'CLEAR' }
  | { type: 'MARK_UPLOADED'; batchId: string };

function reducer(state: MatchAnalysesState, action: Action): MatchAnalysesState {
  switch (action.type) {
    case 'HYDRATE':
      return {
        ...state,
        byKey: action.entries,
        hydrated: true,
        lastHydratedBatchId: action.batchId,
      };
    case 'SET': {
      const next = { ...state.byKey, [action.matchKey]: action.entry };
      return { ...state, byKey: next };
    }
    case 'SET_MANY': {
      const next = { ...state.byKey };
      for (const [k, entry] of action.entries) next[k] = entry;
      return { ...state, byKey: next };
    }
    case 'REMOVE': {
      const next = { ...state.byKey };
      delete next[action.matchKey];
      return { ...state, byKey: next };
    }
    case 'CLEAR':
      return { ...state, byKey: {} };
    case 'MARK_UPLOADED':
      return { ...state, lastUploadedBatchId: action.batchId };
  }
}

const MatchAnalysesContext = createContext<{
  state: MatchAnalysesState;
  getByMatchKey: (key: string) => MatchAnalysis | null;
  hydrateFromWalrus: (
    entries: Record<string, MatchAnalysis>,
    batchId?: string | null,
  ) => void;
  /**
   * Hydrate from the browser-local batch store (`lib/local-insights`).
   * Reads every cached batch newest-first, merges all `results` into
   * `byKey`. Called by Compare / Predict pages when the global source
   * is `'local'`.
   */
  hydrateFromLocal: () => void;
  /** Mark a batchId as "personally uploaded by this user" so the
   * hydration effect in ComparePageClient doesn't clobber the full
   * in-memory result set (set by SSE consumer's `setMany`) with the
   * plaintext-only Walrus preview. */
  markUploaded: (batchId: string) => void;
  set: (key: string, partial: Omit<MatchAnalysis, 'matchKey' | 'createdAt'> & { createdAt?: number }) => void;
  setMany: (entries: Array<[string, Omit<MatchAnalysis, 'matchKey' | 'createdAt'> & { createdAt?: number }]>) => void;
  remove: (matchKey: string) => void;
  clear: () => void;
  all: MatchAnalysis[];
} | null>(null);

export function MatchAnalysesProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Walrus is the source of truth — there's nothing to hydrate from
  // localStorage on mount. The Compare page kicks off the actual
  // Walrus fetch via `batch-index-store.refresh()` and pushes the
  // results through `hydrateFromWalrus`. Until that lands, the store
  // reports `hydrated: false` so the AI cell stays in its loading
  // branch instead of flashing locked CTAs.

  const getByMatchKey = useCallback(
    (key: string): MatchAnalysis | null => state.byKey[key] ?? null,
    [state.byKey],
  );

  const hydrateFromWalrus = useCallback(
    (entries: Record<string, MatchAnalysis>, batchId?: string | null): void => {
      dispatch({ type: 'HYDRATE', entries, batchId: batchId ?? null });
    },
    [],
  );

  const hydrateFromLocal = useCallback((): void => {
    // Merge every cached batch's `results` into one flat map. Newer
    // batches (already first in `getLocalBatches()`) win on overlap.
    const batches = getLocalBatches(); // newest first
    const merged: Record<string, MatchAnalysis> = {};
    for (const b of batches) {
      for (const [k, v] of Object.entries(b.results)) merged[k] = v;
    }
    dispatch({
      type: 'HYDRATE',
      entries: merged,
      batchId: batches[0]?.batchId ?? null,
    });
  }, []);

  const set = useCallback(
    (
      key: string,
      partial: Omit<MatchAnalysis, 'matchKey' | 'createdAt'> & { createdAt?: number },
    ): void => {
      const entry: MatchAnalysis = {
        ...partial,
        matchKey: key,
        createdAt: partial.createdAt ?? Date.now(),
      } as MatchAnalysis;
      dispatch({ type: 'SET', matchKey: key, entry });
    },
    [],
  );

  const setMany = useCallback(
    (
      entries: Array<
        [string, Omit<MatchAnalysis, 'matchKey' | 'createdAt'> & { createdAt?: number }]
      >,
    ): void => {
      const now = Date.now();
      const pairs: Array<[string, MatchAnalysis]> = entries.map(([k, p]) => [
        k,
        { ...p, matchKey: k, createdAt: p.createdAt ?? now } as MatchAnalysis,
      ]);
      dispatch({ type: 'SET_MANY', entries: pairs });
    },
    [],
  );

  const remove = useCallback((matchKey: string): void => {
    dispatch({ type: 'REMOVE', matchKey });
  }, []);

  const clear = useCallback((): void => {
    dispatch({ type: 'CLEAR' });
  }, []);

  const markUploaded = useCallback((batchId: string): void => {
    dispatch({ type: 'MARK_UPLOADED', batchId });
  }, []);

  return (
    <MatchAnalysesContext.Provider
      value={{
        state,
        getByMatchKey,
        hydrateFromWalrus,
        hydrateFromLocal,
        markUploaded,
        set,
        setMany,
        remove,
        clear,
        all: Object.values(state.byKey),
      }}
    >
      {children}
    </MatchAnalysesContext.Provider>
  );
}

export function useMatchAnalyses() {
  const ctx = useContext(MatchAnalysesContext);
  if (!ctx) {
    throw new Error('useMatchAnalyses must be used inside <MatchAnalysesProvider>');
  }
  return {
    state: ctx.state,
    hydrated: ctx.state.hydrated,
    lastHydratedBatchId: ctx.state.lastHydratedBatchId,
    lastUploadedBatchId: ctx.state.lastUploadedBatchId,
    getByMatchKey: ctx.getByMatchKey,
    hydrateFromWalrus: ctx.hydrateFromWalrus,
    hydrateFromLocal: ctx.hydrateFromLocal,
    markUploaded: ctx.markUploaded,
    set: ctx.set,
    setMany: ctx.setMany,
    remove: ctx.remove,
    clear: ctx.clear,
    all: ctx.all,
  };
}
