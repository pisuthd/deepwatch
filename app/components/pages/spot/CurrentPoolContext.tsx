'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface CurrentPool {
  poolKey: string | null;
  baseAsset: string | null;
  quoteAsset: string | null;
  baseAssetId: string | null;
  quoteAssetId: string | null;
  baseAssetDecimals: number | null;
  quoteAssetDecimals: number | null;
}

interface CurrentPoolCtxValue {
  current: CurrentPool;
  setCurrent: (next: CurrentPool) => void;
}

const Ctx = createContext<CurrentPoolCtxValue | null>(null);

const EMPTY: CurrentPool = {
  poolKey: null,
  baseAsset: null,
  quoteAsset: null,
  baseAssetId: null,
  quoteAssetId: null,
  baseAssetDecimals: null,
  quoteAssetDecimals: null,
};

export function CurrentPoolProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<CurrentPool>(EMPTY);
  const value = useMemo(() => ({ current, setCurrent }), [current]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrentPool(): CurrentPool {
  const ctx = useContext(Ctx);
  return ctx?.current ?? EMPTY;
}

export function useSetCurrentPool(): (next: CurrentPool) => void {
  const ctx = useContext(Ctx);
  return ctx?.setCurrent ?? (() => {});
}
