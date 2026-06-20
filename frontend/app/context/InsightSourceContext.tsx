'use client';

/**
 * InsightSourceContext — global preference for where AI batch insights
 * are read from / written to.
 *
 * Two sources:
 *   - `'walrus'` (default): reads via Tatum listWalrusUploads →
 *     fetchInsightBlob. Writes via the existing `uploadBatchInBackground`
 *     path. Requires a Tatum API key (env), subject to credit top-ups
 *     and outages.
 *   - `'local'`: reads from `lib/local-insights.ts` (browser
 *     localStorage). Free, instant, but temporary — clearing browser
 *     data wipes the cache. Used by the "Run One-Time Analyse (Local)"
 *     button on the Compare page.
 *
 * The preference is global: it's mounted at the app root and applies
 * everywhere a batch is read (Compare hydration, Predict
 * `useMatchInsight`, Auto Trade's `useAutoTrade`, etc.). The Compare
 * page renders the `InsightSourceSelector` for the user to flip it.
 *
 * Storage: `localStorage["deepwatch:insight-source"]`. Default
 * `'walrus'` on first mount and on storage errors. SSR returns
 * `'walrus'` (initial useState initializer); the hydration effect on
 * the client may flip it once mounted.
 */

import { createContext, useContext, useState, type ReactNode } from 'react';

export type InsightSource = 'walrus' | 'local';

interface InsightSourceContextType {
  source: InsightSource;
  setSource: (source: InsightSource) => void;
}

const InsightSourceContext = createContext<InsightSourceContextType | undefined>(undefined);

const STORAGE_KEY = 'deepwatch:insight-source';

function readStoredSource(): InsightSource {
  if (typeof window === 'undefined') return 'walrus';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'local' ? 'local' : 'walrus';
  } catch {
    return 'walrus';
  }
}

export function InsightSourceProvider({ children }: { children: ReactNode }) {
  const [source, setSourceState] = useState<InsightSource>(() => readStoredSource());

  const setSource = (next: InsightSource) => {
    setSourceState(next);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch (e: any) {
        console.warn('[insight-source] failed to persist:', e?.message ?? e);
      }
    }
  };

  return (
    <InsightSourceContext.Provider value={{ source, setSource }}>
      {children}
    </InsightSourceContext.Provider>
  );
}

export function useInsightSource(): InsightSourceContextType {
  const ctx = useContext(InsightSourceContext);
  if (!ctx) {
    throw new Error('useInsightSource must be used within InsightSourceProvider');
  }
  return ctx;
}