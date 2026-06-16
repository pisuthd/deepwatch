'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from 'react';
import type { ReactNode } from 'react';
import { fetchDeepBookMarkets } from '@/lib/markets/deepbook';
import { fetchPolymarketMarkets } from '@/lib/markets/polymarket';
import { fetchKalshiMarkets } from '@/lib/markets/kalshi';
import type { BinaryMarket, DeepBookMarket } from '@/lib/markets/types';

/**
 * Global markets store.
 *
 * Loads Polymarket, DeepBook, and Kalshi once on app mount (in parallel),
 * then refreshes them on a 60s interval. Any page that needs live
 * odds just calls `useMarkets()` — no per-page fetching, no per-source
 * controllers, no duplicate requests on source switches.
 *
 * `firstLoad` is true until every source has produced at least one
 * result (success OR error). After that, subsequent interval refreshes
 * update the rows silently — pages that want a full-page spinner on
 * the very first load read `firstLoad`; pages that just want the data
 * read `polyLoading` / `dbLoading` / `kalshiLoading` (which stays true
 * for the source being refetched).
 */

type Source = 'polymarket' | 'deepbook' | 'kalshi';

interface MarketsState {
  polyRows: BinaryMarket[] | null;
  dbRows: DeepBookMarket[] | null;
  kalshiRows: BinaryMarket[] | null;
  polyLoading: boolean;
  dbLoading: boolean;
  kalshiLoading: boolean;
  polyError: string | null;
  dbError: string | null;
  kalshiError: string | null;
  lastFetched: { polymarket: number | null; deepbook: number | null; kalshi: number | null };
  everLoaded: { polymarket: boolean; deepbook: boolean; kalshi: boolean };
  /** True until every source has produced at least one result. */
  firstLoad: boolean;
}

const initialState: MarketsState = {
  polyRows: null,
  dbRows: null,
  kalshiRows: null,
  polyLoading: true,
  dbLoading: true,
  kalshiLoading: true,
  polyError: null,
  dbError: null,
  kalshiError: null,
  lastFetched: { polymarket: null, deepbook: null, kalshi: null },
  everLoaded: { polymarket: false, deepbook: false, kalshi: false },
  firstLoad: true,
};

type Action =
  | { type: 'FETCH_START'; source: Source }
  | { type: 'FETCH_SUCCESS'; source: Source; data: BinaryMarket[] | DeepBookMarket[] }
  | { type: 'FETCH_ERROR'; source: Source; error: string };

const rowsKey = (s: Source): 'polyRows' | 'dbRows' | 'kalshiRows' =>
  s === 'polymarket' ? 'polyRows' : s === 'deepbook' ? 'dbRows' : 'kalshiRows';
const loadingKey = (s: Source): 'polyLoading' | 'dbLoading' | 'kalshiLoading' =>
  s === 'polymarket' ? 'polyLoading' : s === 'deepbook' ? 'dbLoading' : 'kalshiLoading';
const errorKey = (s: Source): 'polyError' | 'dbError' | 'kalshiError' =>
  s === 'polymarket' ? 'polyError' : s === 'deepbook' ? 'dbError' : 'kalshiError';

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
      const allLoaded =
        updatedEverLoaded.polymarket &&
        updatedEverLoaded.deepbook &&
        updatedEverLoaded.kalshi;
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
      const allLoaded =
        updatedEverLoaded.polymarket &&
        updatedEverLoaded.deepbook &&
        updatedEverLoaded.kalshi;
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
const SOURCES: Source[] = ['polymarket', 'deepbook', 'kalshi'];

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
      fetchDeepBookMarkets(ctrl.signal),
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

  // Initial fetch on mount.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Periodic refresh.
  useEffect(() => {
    const id = setInterval(() => {
      refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return <MarketsContext.Provider value={state}>{children}</MarketsContext.Provider>;
}

export function useMarkets(): MarketsState {
  const ctx = useContext(MarketsContext);
  if (!ctx) {
    throw new Error('useMarkets must be used inside <MarketsProvider>');
  }
  return ctx;
}
