'use client';

/**
 * Local insights store. Replaces the old Tatum / Walrus surface.
 *
 * Insights live in `localStorage` under `STORAGE_KEY`. The store is
 * intentionally simple — no cross-tab sync, no pagination, no search
 * — because /frontend only ever renders ~50 insights at most and the
 * quota is fine well past that.
 *
 *  - `add(body)` mints a uuid, persists, and returns the row.
 *  - `remove(id)` / `clear()` are direct mutations.
 *  - `getById(id)` is a synchronous lookup (no fetching).
 *  - `hydrated` flips to true after the first read so the consumer can
 *    show a spinner without flashing "no insights yet" on every reload.
 *
 * SSR safety: every `localStorage` access is gated behind
 * `typeof window !== 'undefined'`.
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
import {
  buildInsightBody,
  INSIGHT_MAX_BYTES,
  type SavedInsight,
} from '../lib/insights';

const STORAGE_KEY = 'deepwatch:insights:v1';

interface InsightsState {
  insights: SavedInsight[];
  hydrated: boolean;
}

const initialState: InsightsState = {
  insights: [],
  hydrated: false,
};

type Action =
  | { type: 'HYDRATE'; insights: SavedInsight[] }
  | { type: 'ADD'; insight: SavedInsight }
  | { type: 'REMOVE'; id: string }
  | { type: 'CLEAR' };

function reducer(state: InsightsState, action: Action): InsightsState {
  switch (action.type) {
    case 'HYDRATE':
      return { insights: action.insights, hydrated: true };
    case 'ADD':
      return { ...state, insights: [action.insight, ...state.insights] };
    case 'REMOVE':
      return { ...state, insights: state.insights.filter((i) => i.id !== action.id) };
    case 'CLEAR':
      return { ...state, insights: [] };
  }
}

const InsightsContext = createContext<{
  state: InsightsState;
  add: (input: Parameters<typeof buildInsightBody>[0]) => SavedInsight | null;
  remove: (id: string) => void;
  clear: () => void;
  getById: (id: string) => SavedInsight | null;
} | null>(null);

function safeRead(): SavedInsight[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Light validation — drop anything that doesn't have the expected shape.
    return parsed.filter(
      (x): x is SavedInsight =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as SavedInsight).id === 'string' &&
        typeof (x as SavedInsight).createdAt === 'number' &&
        typeof (x as SavedInsight).sourceBytes === 'number' &&
        !!(x as SavedInsight).body &&
        typeof (x as SavedInsight).body.title === 'string',
    );
  } catch {
    return [];
  }
}

function safeWrite(rows: SavedInsight[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    return true;
  } catch (err) {
    // QuotaExceededError, etc. — caller decides what to do.
    console.warn('[insights-store] write failed:', err);
    return false;
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function InsightsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  // Cache the current rows in a ref so the persistence effect can read
  // them without re-running on every render. Reducer state is the
  // source of truth for consumers.
  const rowsRef = useRef<SavedInsight[]>([]);

  // Hydrate from localStorage exactly once on mount.
  useEffect(() => {
    const rows = safeRead();
    rowsRef.current = rows;
    dispatch({ type: 'HYDRATE', insights: rows });
  }, []);

  // Persist after every mutation. The reducer already updated `state`,
  // so we mirror via rowsRef (kept in sync inside the action callbacks).
  useEffect(() => {
    if (!state.hydrated) return;
    safeWrite(state.insights);
  }, [state.hydrated, state.insights]);

  const add = useCallback(
    (input: Parameters<typeof buildInsightBody>[0]): SavedInsight | null => {
      const body = buildInsightBody(input);
      const sourceBytes = (() => {
        try {
          return JSON.stringify(body).length;
        } catch {
          return 0;
        }
      })();
      if (sourceBytes > INSIGHT_MAX_BYTES) {
        console.warn(`[insights-store] insight ${sourceBytes} B exceeds ${INSIGHT_MAX_BYTES} B cap`);
        return null;
      }
      const row: SavedInsight = {
        id: newId(),
        body,
        createdAt: Date.now(),
        sourceBytes,
      };
      rowsRef.current = [row, ...rowsRef.current];
      dispatch({ type: 'ADD', insight: row });
      return row;
    },
    [],
  );

  const remove = useCallback((id: string) => {
    rowsRef.current = rowsRef.current.filter((i) => i.id !== id);
    dispatch({ type: 'REMOVE', id });
  }, []);

  const clear = useCallback(() => {
    rowsRef.current = [];
    dispatch({ type: 'CLEAR' });
  }, []);

  const getById = useCallback(
    (id: string): SavedInsight | null => rowsRef.current.find((i) => i.id === id) ?? null,
    [],
  );

  return (
    <InsightsContext.Provider value={{ state, add, remove, clear, getById }}>
      {children}
    </InsightsContext.Provider>
  );
}

export function useInsights() {
  const ctx = useContext(InsightsContext);
  if (!ctx) {
    throw new Error('useInsights must be used inside <InsightsProvider>');
  }
  return {
    insights: ctx.state.insights,
    hydrated: ctx.state.hydrated,
    add: ctx.add,
    remove: ctx.remove,
    clear: ctx.clear,
    getById: ctx.getById,
  };
}
