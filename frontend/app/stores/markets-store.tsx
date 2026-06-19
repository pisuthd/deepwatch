'use client';

/**
 * Global markets store — Polymarket + DeepBook Predict + Kalshi.
 *
 * Mirrors the root app's `stores/markets-store.tsx`: fetches all three
 * prediction-market sources in parallel, refreshes every 90s, and exposes
 * the latest rows + loading/error flags via `useGlobalMarkets()`.
 *
 * Note: `frontend/app/hooks/useMarkets.ts` is a separate hook with a
 * different return shape (`Market[]`, one row per oracle with `odds`,
 * `spot`, `forward`, …) and a faster 30s cadence. It powers the predict
 * trading UI (SimpleMode / AdvancedMode / MarketPicker / PredictCard).
 * That hook is untouched by this store — both can coexist because they
 * expose different shapes for different consumers.
 *
 * `firstLoad` is true until every source has produced at least one
 * result (success OR error). After that, subsequent interval refreshes
 * update the rows silently — pages that want a full-page spinner on
 * the very first load read `firstLoad`; pages that just want the data
 * read `polyLoading` / `deepbookLoading` / `kalshiLoading` (which stays
 * true for the source being refetched).
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
import { fetchDeepBookMarkets } from '@/app/lib/deepbook';
import { fetchPolymarketMarkets } from '@/app/lib/polymarket';
import { fetchKalshiMarkets } from '@/app/lib/kalshi';
import type { BinaryMarket, DeepBookMarket } from '@/app/lib/types';

type Source = 'polymarket' | 'deepbook' | 'kalshi';

interface MarketsState {
  polyRows: BinaryMarket[] | null;
  deepbookRows: DeepBookMarket[] | null;
  kalshiRows: BinaryMarket[] | null;
  polyLoading: boolean;
  deepbookLoading: boolean;
  kalshiLoading: boolean;
  polyError: string | null;
  deepbookError: string | null;
  kalshiError: string | null;
  lastFetched: { polymarket: number | null; deepbook: number | null; kalshi: number | null };
  everLoaded: { polymarket: boolean; deepbook: boolean; kalshi: boolean };
  /** True until every source has produced at least one result. */
  firstLoad: boolean;
}

const initialState: MarketsState = {
  polyRows: null,
  deepbookRows: null,
  kalshiRows: null,
  polyLoading: true,
  deepbookLoading: true,
  kalshiLoading: true,
  polyError: null,
  deepbookError: null,
  kalshiError: null,
  lastFetched: { polymarket: null, deepbook: null, kalshi: null },
  everLoaded: { polymarket: false, deepbook: false, kalshi: false },
  firstLoad: true,
};

type Action =
  | { type: 'FETCH_START'; source: Source }
  | { type: 'FETCH_SUCCESS'; source: Source; data: BinaryMarket[] | DeepBookMarket[] }
  | { type: 'FETCH_ERROR'; source: Source; error: string };

const rowsKey = (s: Source): 'polyRows' | 'deepbookRows' | 'kalshiRows' =>
  s === 'polymarket' ? 'polyRows' : s === 'deepbook' ? 'deepbookRows' : 'kalshiRows';
const loadingKey = (s: Source): 'polyLoading' | 'deepbookLoading' | 'kalshiLoading' =>
  s === 'polymarket' ? 'polyLoading' : s === 'deepbook' ? 'deepbookLoading' : 'kalshiLoading';
const errorKey = (s: Source): 'polyError' | 'deepbookError' | 'kalshiError' =>
  s === 'polymarket' ? 'polyError' : s === 'deepbook' ? 'deepbookError' : 'kalshiError';

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

const MarketsContext = createContext<(MarketsState & { refresh: () => Promise<void> }) | null>(null);

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

  return (
    <MarketsContext.Provider value={{ ...state, refresh }}>
      {children}
    </MarketsContext.Provider>
  );
}

export function useGlobalMarkets(): MarketsState & { refresh: () => Promise<void> } {
  const ctx = useContext(MarketsContext);
  if (!ctx) {
    throw new Error('useGlobalMarkets must be used inside <MarketsProvider>');
  }
  return ctx;
}