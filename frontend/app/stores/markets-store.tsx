'use client';

/**
 * Global markets store — Polymarket + Kalshi only.
 *
 * Mirrors the root app's `stores/markets-store.tsx` with one important
 * difference: DeepBook Predict is NOT fetched here, because `/frontend`
 * already has its own `app/hooks/useMarkets.ts` hook for the DeepBook
 * oracle data (different return shape — `Market[]`, one row per oracle).
 * To avoid a name collision, the DeepBook hook is imported in callers
 * under the alias `useDeepBookMarkets` and this global store exports
 * `useGlobalMarkets` instead.
 *
 * Loads Polymarket + Kalshi once on app mount (in parallel) and refreshes
 * every 90 s. Any page that needs live odds just calls `useGlobalMarkets()`
 * — no per-page fetching, no per-source controllers, no duplicate requests
 * on source switches.
 *
 * `firstLoad` is true until every source has produced at least one
 * result (success OR error). After that, subsequent interval refreshes
 * update the rows silently.
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
import { fetchPolymarketMarkets } from '@/lib/markets/polymarket';
import { fetchKalshiMarkets } from '@/lib/markets/kalshi';
import type { BinaryMarket } from '@/lib/markets/types';

type Source = 'polymarket' | 'kalshi';

interface MarketsState {
  polyRows: BinaryMarket[] | null;
  kalshiRows: BinaryMarket[] | null;
  polyLoading: boolean;
  kalshiLoading: boolean;
  polyError: string | null;
  kalshiError: string | null;
  lastFetched: { polymarket: number | null; kalshi: number | null };
  everLoaded: { polymarket: boolean; kalshi: boolean };
  /** True until every source has produced at least one result. */
  firstLoad: boolean;
}

const initialState: MarketsState = {
  polyRows: null,
  kalshiRows: null,
  polyLoading: true,
  kalshiLoading: true,
  polyError: null,
  kalshiError: null,
  lastFetched: { polymarket: null, kalshi: null },
  everLoaded: { polymarket: false, kalshi: false },
  firstLoad: true,
};

type Action =
  | { type: 'FETCH_START'; source: Source }
  | { type: 'FETCH_SUCCESS'; source: Source; data: BinaryMarket[] }
  | { type: 'FETCH_ERROR'; source: Source; error: string };

const rowsKey = (s: Source): 'polyRows' | 'kalshiRows' =>
  s === 'polymarket' ? 'polyRows' : 'kalshiRows';
const loadingKey = (s: Source): 'polyLoading' | 'kalshiLoading' =>
  s === 'polymarket' ? 'polyLoading' : 'kalshiLoading';
const errorKey = (s: Source): 'polyError' | 'kalshiError' =>
  s === 'polymarket' ? 'polyError' : 'kalshiError';

function reducer(state: MarketsState, action: Action): MarketsState {
  switch (action.type) {
    case 'FETCH_START': {
      return {
        ...state,
        [loadingKey(action.source)]: true,
        [errorKey(action.source)]: null,
      };
    }
    case 'FETCH_SUCCESS': {
      const updatedEverLoaded = { ...state.everLoaded, [action.source]: true };
      const allLoaded = updatedEverLoaded.polymarket && updatedEverLoaded.kalshi;
      return {
        ...state,
        [rowsKey(action.source)]: action.data,
        [loadingKey(action.source)]: false,
        lastFetched: { ...state.lastFetched, [action.source]: Date.now() },
        everLoaded: updatedEverLoaded,
        firstLoad: !allLoaded,
      };
    }
    case 'FETCH_ERROR': {
      // An error also counts as "loaded" — we made the attempt.
      // firstLoad flips to false so the page stops showing the
      // first-load spinner even if one source is broken.
      const updatedEverLoaded = { ...state.everLoaded, [action.source]: true };
      const allLoaded = updatedEverLoaded.polymarket && updatedEverLoaded.kalshi;
      return {
        ...state,
        [errorKey(action.source)]: action.error,
        [loadingKey(action.source)]: false,
        everLoaded: updatedEverLoaded,
        firstLoad: !allLoaded,
      };
    }
  }
}

const MarketsContext = createContext<MarketsState | null>(null);

const REFRESH_INTERVAL_MS = 90_000;
const SOURCES: Source[] = ['polymarket', 'kalshi'];

export function MarketsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const ctrlRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;

    for (const source of SOURCES) {
      dispatch({ type: 'FETCH_START', source });
    }

    const results = await Promise.allSettled([
      fetchPolymarketMarkets(ctrl.signal),
      fetchKalshiMarkets(ctrl.signal),
    ]);

    if (ctrl.signal.aborted) return;

    SOURCES.forEach((source, i) => {
      const r = results[i];
      if (r.status === 'fulfilled') {
        dispatch({ type: 'FETCH_SUCCESS', source, data: r.value });
      } else {
        const reason = (r as PromiseRejectedResult).reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        dispatch({ type: 'FETCH_ERROR', source, error: message });
      }
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => {
      refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return <MarketsContext.Provider value={state}>{children}</MarketsContext.Provider>;
}

export function useGlobalMarkets(): MarketsState {
  const ctx = useContext(MarketsContext);
  if (!ctx) {
    throw new Error('useGlobalMarkets must be used inside <MarketsProvider>');
  }
  return ctx;
}
