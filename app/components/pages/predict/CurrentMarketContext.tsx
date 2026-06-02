'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface CurrentMarket {
  oracleId: string | null;
  asset: string | null;
}

interface CurrentMarketCtxValue {
  current: CurrentMarket;
  setCurrent: (next: CurrentMarket) => void;
}

const Ctx = createContext<CurrentMarketCtxValue | null>(null);

export function CurrentMarketProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<CurrentMarket>({ oracleId: null, asset: null });
  const value = useMemo(() => ({ current, setCurrent }), [current]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrentMarket(): CurrentMarket {
  const ctx = useContext(Ctx);
  // Safe fallback so the hook can be used outside the provider (e.g. on
  // pages that don't mount the provider yet).
  return ctx?.current ?? { oracleId: null, asset: null };
}

export function useSetCurrentMarket(): (next: CurrentMarket) => void {
  const ctx = useContext(Ctx);
  return ctx?.setCurrent ?? (() => {});
}
