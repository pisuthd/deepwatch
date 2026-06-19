'use client';

/**
 * Local-storage cache of `BatchInsight` blob bodies fetched from Walrus.
 *
 * The Tatum `/v4/data/storage/uploads` list endpoint returns job rows
 * (filename, status, size, etc.) but NOT the blob body — to render the
 * Recent Batches panel's expanded row or the Predict page's
 * `useMatchInsight`, we need to fetch the body from `downloadUrlByQuiltId`
 * and parse the JSON.
 *
 * The body fetch is the expensive part (~12 KB round-trip per batch). This
 * store caches the parsed `BatchInsight` in localStorage keyed by
 * `batchId`, so:
 *   - Subsequent renders of the same row are O(1) (synchronous lookup).
 *   - Cross-session persistence (reloads don't re-fetch).
 *   - Cross-tab persistence (one tab's fetch warms the others).
 *
 * Source of truth: Tatum/Walrus. This is a **cache**, not a registry —
 * `RecentBatchesPanel` always calls `listWalrusUploads` on mount + on a
 * 30 s interval, and only the parsed body is cached.
 *
 * Storage:
 *   - localStorage key `deepwatch:walrus-batches:v1`
 *   - shape: `Record<batchId, BatchInsight>`
 *   - 100-entry LRU cap (oldest by `createdAt` dropped on overflow)
 *   - SSR-safe (gate localStorage behind `typeof window !== 'undefined'`)
 *
 * API:
 *   - `getByBatchId(id)` — sync lookup
 *   - `set(insight)` — single write, deep merge
 *   - `setMany(insights)` — bulk write in one dispatch
 *   - `remove(id)` / `clear()` — direct mutations
 *   - `all` — array view (for debug / future list view)
 *   - `hydrated` — true after the first localStorage read
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from 'react';
import type { ReactNode } from 'react';
import { validateBatchInsight, type BatchInsight } from '../lib/match-analyses';

const STORAGE_KEY = 'deepwatch:walrus-batches:v1';
const MAX_ENTRIES = 100;

interface BatchIndexState {
  /** Keyed by `batchId` for O(1) lookup. */
  byBatchId: Record<string, BatchInsight>;
  hydrated: boolean;
}

const initialState: BatchIndexState = {
  byBatchId: {},
  hydrated: false,
};

type Action =
  | { type: 'HYDRATE'; byBatchId: Record<string, BatchInsight> }
  | { type: 'SET'; insight: BatchInsight }
  | { type: 'SET_MANY'; insights: BatchInsight[] }
  | { type: 'REMOVE'; batchId: string }
  | { type: 'CLEAR' };

function reducer(state: BatchIndexState, action: Action): BatchIndexState {
  switch (action.type) {
    case 'HYDRATE':
      return { byBatchId: action.byBatchId, hydrated: true };
    case 'SET': {
      const next = { ...state.byBatchId, [action.insight.batchId]: action.insight };
      return { ...state, byBatchId: enforceCap(next) };
    }
    case 'SET_MANY': {
      const next = { ...state.byBatchId };
      for (const i of action.insights) next[i.batchId] = i;
      return { ...state, byBatchId: enforceCap(next) };
    }
    case 'REMOVE': {
      const next = { ...state.byBatchId };
      delete next[action.batchId];
      return { ...state, byBatchId: next };
    }
    case 'CLEAR':
      return { ...state, byBatchId: {} };
  }
}

function enforceCap(
  byBatchId: Record<string, BatchInsight>,
): Record<string, BatchInsight> {
  const entries = Object.values(byBatchId);
  if (entries.length <= MAX_ENTRIES) return byBatchId;
  entries.sort((a, b) => a.createdAt - b.createdAt);
  const keep = entries.slice(entries.length - MAX_ENTRIES);
  const next: Record<string, BatchInsight> = {};
  for (const e of keep) next[e.batchId] = e;
  return next;
}

function safeRead(): Record<string, BatchInsight> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, BatchInsight> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const validated = validateBatchInsight(v);
      if (validated) out[k] = validated;
    }
    return out;
  } catch {
    return {};
  }
}

function safeWrite(byBatchId: Record<string, BatchInsight>): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(byBatchId));
    return true;
  } catch (err) {
    // QuotaExceededError, etc. — caller decides what to do.
    console.warn('[batch-index-store] write failed:', err);
    return false;
  }
}

const BatchIndexContext = createContext<{
  state: BatchIndexState;
  getByBatchId: (id: string) => BatchInsight | null;
  set: (insight: BatchInsight) => void;
  setMany: (insights: BatchInsight[]) => void;
  remove: (batchId: string) => void;
  clear: () => void;
  all: BatchInsight[];
} | null>(null);

export function BatchIndexProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const byBatchIdRef = useRef<Record<string, BatchInsight>>({});

  useEffect(() => {
    const byBatchId = safeRead();
    byBatchIdRef.current = byBatchId;
    dispatch({ type: 'HYDRATE', byBatchId });
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    safeWrite(state.byBatchId);
  }, [state.hydrated, state.byBatchId]);

  const getByBatchId = useCallback(
    (id: string): BatchInsight | null => byBatchIdRef.current[id] ?? null,
    [],
  );

  const set = useCallback((insight: BatchInsight): void => {
    byBatchIdRef.current = enforceCap({ ...byBatchIdRef.current, [insight.batchId]: insight });
    dispatch({ type: 'SET', insight });
  }, []);

  const setMany = useCallback((insights: BatchInsight[]): void => {
    const next = { ...byBatchIdRef.current };
    for (const i of insights) next[i.batchId] = i;
    byBatchIdRef.current = enforceCap(next);
    dispatch({ type: 'SET_MANY', insights });
  }, []);

  const remove = useCallback((batchId: string): void => {
    const next = { ...byBatchIdRef.current };
    delete next[batchId];
    byBatchIdRef.current = next;
    dispatch({ type: 'REMOVE', batchId });
  }, []);

  const clear = useCallback((): void => {
    byBatchIdRef.current = {};
    dispatch({ type: 'CLEAR' });
  }, []);

  return (
    <BatchIndexContext.Provider
      value={{
        state,
        getByBatchId,
        set,
        setMany,
        remove,
        clear,
        all: Object.values(state.byBatchId),
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
    getByBatchId: ctx.getByBatchId,
    set: ctx.set,
    setMany: ctx.setMany,
    remove: ctx.remove,
    clear: ctx.clear,
    all: ctx.all,
  };
}
