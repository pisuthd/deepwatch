'use client';

/**
 * Local store for per-match AI analyses (Compare page).
 *
 * Different access pattern from `useInsights()`:
 *   - key = `DeepBookMatch.key` (lookup by match, not list newest-first)
 *   - shape = `MatchAnalysis` (signal + confidence + position + reasoning),
 *     not the wizard's `InsightBody` (title + long-form markdown)
 *   - writes happen in bulk during a batch AI call, not one-at-a-time
 *     from a wizard "Publish" button
 *   - staleness is silent (markets move, analyses go stale, user clears
 *     localStorage to force-refresh) — no archive/expire logic
 *
 * Storage:
 *   - localStorage key `deepwatch:match-analyses:v1`
 *   - shape: `Record<matchKey, MatchAnalysis>`
 *   - 200-entry LRU cap on `set`/`setMany` (oldest by `createdAt` dropped)
 *   - SSR-safe (gate localStorage behind `typeof window !== 'undefined'`)
 *
 * API:
 *   - `getByMatchKey(key)` — sync lookup, used by `AiCell` for fast reads
 *   - `set(key, partial)` — deep-merge, used by `AiAnalyseModal` per result
 *   - `setMany(entries)` — bulk write in one dispatch, used at end of batch
 *   - `remove(key)` / `clear()` — direct mutations
 *   - `all` — array view of all entries (for debugging / future list view)
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
import type { MatchAnalysis } from '../lib/match-analyses';

const STORAGE_KEY = 'deepwatch:match-analyses:v1';
const MAX_ENTRIES = 200;

interface MatchAnalysesState {
  /** Keyed by `matchKey` (= `DeepBookMatch.key`) for O(1) lookup. */
  byKey: Record<string, MatchAnalysis>;
  hydrated: boolean;
}

const initialState: MatchAnalysesState = {
  byKey: {},
  hydrated: false,
};

type Action =
  | { type: 'HYDRATE'; byKey: Record<string, MatchAnalysis> }
  | { type: 'SET'; matchKey: string; entry: MatchAnalysis }
  | { type: 'SET_MANY'; entries: Array<[string, MatchAnalysis]> }
  | { type: 'REMOVE'; matchKey: string }
  | { type: 'CLEAR' };

function reducer(state: MatchAnalysesState, action: Action): MatchAnalysesState {
  switch (action.type) {
    case 'HYDRATE':
      return { byKey: action.byKey, hydrated: true };
    case 'SET': {
      const next = { ...state.byKey, [action.matchKey]: action.entry };
      return { ...state, byKey: enforceCap(next) };
    }
    case 'SET_MANY': {
      const next = { ...state.byKey };
      for (const [k, entry] of action.entries) next[k] = entry;
      return { ...state, byKey: enforceCap(next) };
    }
    case 'REMOVE': {
      const next = { ...state.byKey };
      delete next[action.matchKey];
      return { ...state, byKey: next };
    }
    case 'CLEAR':
      return { ...state, byKey: {} };
  }
}

/**
 * Drop the oldest entries (by `createdAt`) until the map is at or
 * under the cap. Used after every write so the localStorage payload
 * never grows unbounded.
 */
function enforceCap(byKey: Record<string, MatchAnalysis>): Record<string, MatchAnalysis> {
  const entries = Object.values(byKey);
  if (entries.length <= MAX_ENTRIES) return byKey;
  entries.sort((a, b) => a.createdAt - b.createdAt);
  const keep = entries.slice(entries.length - MAX_ENTRIES);
  const next: Record<string, MatchAnalysis> = {};
  for (const e of keep) next[e.matchKey] = e;
  return next;
}

function safeRead(): Record<string, MatchAnalysis> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, MatchAnalysis> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const e = v as Partial<MatchAnalysis>;
      if (
        typeof e.matchKey !== 'string' ||
        typeof e.signal !== 'string' ||
        (e.signal !== 'UP' && e.signal !== 'DOWN' && e.signal !== 'NEUTRAL') ||
        typeof e.confidence !== 'number' ||
        typeof e.positionSizePct !== 'number' ||
        typeof e.reasoning !== 'string' ||
        typeof e.createdAt !== 'number'
      ) {
        continue;
      }
      out[k] = e as MatchAnalysis;
    }
    return out;
  } catch {
    return {};
  }
}

function safeWrite(byKey: Record<string, MatchAnalysis>): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(byKey));
    return true;
  } catch (err) {
    // QuotaExceededError, etc. — caller decides what to do.
    console.warn('[match-analyses-store] write failed:', err);
    return false;
  }
}

const MatchAnalysesContext = createContext<{
  state: MatchAnalysesState;
  getByMatchKey: (key: string) => MatchAnalysis | null;
  set: (key: string, partial: Omit<MatchAnalysis, 'matchKey' | 'createdAt'> & { createdAt?: number }) => void;
  setMany: (entries: Array<[string, Omit<MatchAnalysis, 'matchKey' | 'createdAt'> & { createdAt?: number }]>) => void;
  remove: (matchKey: string) => void;
  clear: () => void;
  all: MatchAnalysis[];
} | null>(null);

export function MatchAnalysesProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const byKeyRef = useRef<Record<string, MatchAnalysis>>({});

  useEffect(() => {
    const byKey = safeRead();
    byKeyRef.current = byKey;
    dispatch({ type: 'HYDRATE', byKey });
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    safeWrite(state.byKey);
  }, [state.hydrated, state.byKey]);

  const getByMatchKey = useCallback(
    (key: string): MatchAnalysis | null => byKeyRef.current[key] ?? null,
    [],
  );

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
      byKeyRef.current = enforceCap({ ...byKeyRef.current, [key]: entry });
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
      const next = { ...byKeyRef.current };
      for (const [k, e] of pairs) next[k] = e;
      byKeyRef.current = enforceCap(next);
      dispatch({ type: 'SET_MANY', entries: pairs });
    },
    [],
  );

  const remove = useCallback((matchKey: string): void => {
    const next = { ...byKeyRef.current };
    delete next[matchKey];
    byKeyRef.current = next;
    dispatch({ type: 'REMOVE', matchKey });
  }, []);

  const clear = useCallback((): void => {
    byKeyRef.current = {};
    dispatch({ type: 'CLEAR' });
  }, []);

  return (
    <MatchAnalysesContext.Provider
      value={{
        state,
        getByMatchKey,
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
    getByMatchKey: ctx.getByMatchKey,
    set: ctx.set,
    setMany: ctx.setMany,
    remove: ctx.remove,
    clear: ctx.clear,
    all: ctx.all,
  };
}
