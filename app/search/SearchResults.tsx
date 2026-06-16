'use client';

import { useEffect, useMemo, useState } from 'react';
import UpDownCard from '@/components/search/UpDownCard';
import RangeCard from '@/components/search/RangeCard';
import {
  fetchDeepBookMarkets,
  groupDeepBookMarkets,
  type DeepBookGroup,
} from '@/lib/markets/deepbook';
import {
  fetchPolymarketMarkets,
  groupPolymarketMarkets,
  type PolymarketGroup,
} from '@/lib/markets/polymarket';
import {
  fetchKalshiMarkets,
  groupKalshiMarkets,
  type KalshiGroup,
} from '@/lib/markets/kalshi';
import type { BinaryMarket, DeepBookMarket } from '@/lib/markets/types';
import type { ReactNode } from 'react';

type Platform = 'DEEPBOOK' | 'POLYMARKET' | 'KALSHI';

interface Props {
  activeSource: Platform;
}

// Eyebrow node per platform — passed into both card types so the card
// title reflects the source of the data, not a hardcoded label.
const PLATFORM_EYEBROW: Record<Platform, ReactNode> = {
  POLYMARKET: (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent-primary)]">
      Polymarket
    </div>
  ),
  DEEPBOOK: (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent-primary)]">
      DeepBook Predict
    </div>
  ),
  KALSHI: (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent-primary)]">
      Kalshi
    </div>
  ),
};

export default function SearchResults({ activeSource }: Props) {
  // Polymarket state
  const [polyRows, setPolyRows] = useState<BinaryMarket[] | null>(null);
  const [polyError, setPolyError] = useState<string | null>(null);
  const [polyLoading, setPolyLoading] = useState(true);
  // DeepBook state
  const [dbRows, setDbRows] = useState<DeepBookMarket[] | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [dbLoading, setDbLoading] = useState(true);
  // Kalshi state
  const [kalshiRows, setKalshiRows] = useState<BinaryMarket[] | null>(null);
  const [kalshiError, setKalshiError] = useState<string | null>(null);
  const [kalshiLoading, setKalshiLoading] = useState(true);

  useEffect(() => {
    // Clear caches for non-active sources
    if (activeSource !== 'POLYMARKET') {
      setPolyRows([]);
      setPolyLoading(false);
    }
    if (activeSource !== 'DEEPBOOK') {
      setDbRows([]);
      setDbLoading(false);
    }
    if (activeSource !== 'KALSHI') {
      setKalshiRows([]);
      setKalshiLoading(false);
    }

    const ctrl = new AbortController();
    let cancelled = false;

    if (activeSource === 'POLYMARKET') {
      (async () => {
        try {
          const data = await fetchPolymarketMarkets(ctrl.signal);
          if (cancelled) return;
          setPolyRows(data);
          setPolyError(null);
        } catch (e) {
          if (cancelled) return;
          setPolyError(e instanceof Error ? e.message : String(e));
          setPolyRows([]);
        } finally {
          if (!cancelled) setPolyLoading(false);
        }
      })();
    } else if (activeSource === 'DEEPBOOK') {
      (async () => {
        try {
          const data = await fetchDeepBookMarkets(ctrl.signal);
          if (cancelled) return;
          setDbRows(data);
          setDbError(null);
        } catch (e) {
          if (cancelled) return;
          setDbError(e instanceof Error ? e.message : String(e));
          setDbRows([]);
        } finally {
          if (!cancelled) setDbLoading(false);
        }
      })();
    } else if (activeSource === 'KALSHI') {
      (async () => {
        try {
          const data = await fetchKalshiMarkets(ctrl.signal);
          console.log("data:", data)
          if (cancelled) return;
          setKalshiRows(data);
          setKalshiError(null);
        } catch (e) {
          if (cancelled) return;
          setKalshiError(e instanceof Error ? e.message : String(e));
          setKalshiRows([]);
        } finally {
          if (!cancelled) setKalshiLoading(false);
        }
      })();
    }

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [activeSource]);

  // Grouping lives in the lib; SearchResults is a pure view layer.
  const polyGroups = useMemo<PolymarketGroup[]>(
    () => (polyRows ? groupPolymarketMarkets(polyRows) : []),
    [polyRows],
  );
  const dbGroups = useMemo<DeepBookGroup[]>(
    () => (dbRows ? (groupDeepBookMarkets(dbRows) as DeepBookGroup[]) : []),
    [dbRows],
  );
  const kalshiGroups = useMemo<KalshiGroup[]>(
    () => (kalshiRows ? groupKalshiMarkets(kalshiRows) : []),
    [kalshiRows],
  );

  const eyebrow = PLATFORM_EYEBROW[activeSource];
  const loading =
    activeSource === 'POLYMARKET'
      ? polyLoading
      : activeSource === 'KALSHI'
        ? kalshiLoading
        : dbLoading;
  const error =
    activeSource === 'POLYMARKET'
      ? polyError
      : activeSource === 'KALSHI'
        ? kalshiError
        : dbError;

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-sm text-gray-400">Loading latest markets…</div>
      )}

      {!loading && activeSource === 'POLYMARKET' && polyGroups.length === 0 && !error && (
        <div className="text-sm text-gray-500 italic">
          No active markets. The Polymarket indexer may be empty right now.
        </div>
      )}

      {!loading && activeSource === 'DEEPBOOK' && dbGroups.length === 0 && !error && (
        <div className="text-sm text-gray-500 italic">
          No active oracles. The DeepBook Predict testnet may be empty right now.
        </div>
      )}

      {!loading && activeSource === 'KALSHI' && kalshiGroups.length === 0 && !error && (
        <div className="text-sm text-gray-500 italic">
          No active Kalshi markets right now.
        </div>
      )}

      {/*
       * Polymarket rendering: each (event, expiry) group is a 2-col row
       * with UP_DOWN on the left and RANGE on the right. If only one type
       * exists for the group, the other slot is empty (the single card
       * fills the left column at xl).
       */}
      {activeSource === 'POLYMARKET' && (
        <div className="space-y-3">
          {polyGroups.map((g) => (
            <div
              key={g.key}
              className="grid grid-cols-1 xl:grid-cols-2 gap-3"
            >
              {g.upDown.length > 0 && (
                <UpDownCard
                  asset="BTC"
                  expiryMs={g.expiryMs}
                  spotUsd={null}
                  forwardUsd={null}
                  eyebrow={eyebrow}
                  rows={g.upDown}
                />
              )}
              {g.range.length > 0 && (
                <RangeCard
                  asset="BTC"
                  expiryMs={g.expiryMs}
                  spotUsd={null}
                  forwardUsd={null}
                  eyebrow={eyebrow}
                  rows={g.range}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/*
       * Kalshi rendering: same 2-col layout as Polymarket. UP_DOWN
       * markets (from KXBTCD or the KXBTC greater/less tails) and
       * RANGE buckets (KXBTC between buckets) get paired by
       * (event, expiry).
       */}
      {activeSource === 'KALSHI' && (
        <div className="space-y-3">
          {kalshiGroups.map((g) => (
            <div
              key={g.key}
              className="grid grid-cols-1 xl:grid-cols-2 gap-3"
            >
              {g.upDown.length > 0 && (
                <UpDownCard
                  asset="BTC"
                  expiryMs={g.expiryMs}
                  spotUsd={null}
                  forwardUsd={null}
                  eyebrow={eyebrow}
                  rows={g.upDown}
                />
              )}
              {g.range.length > 0 && (
                <RangeCard
                  asset="BTC"
                  expiryMs={g.expiryMs}
                  spotUsd={null}
                  forwardUsd={null}
                  eyebrow={eyebrow}
                  rows={g.range}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/*
       * DeepBook rendering: each oracle+expiry has both up/down and range
       * ladders, so we keep them side-by-side in a 2-col grid (xl+).
       */}
      {activeSource === 'DEEPBOOK' &&
        dbGroups.map((g) => (
          <div
            key={`${g.oracleId}::${g.expiryMs}`}
            className="grid grid-cols-1 xl:grid-cols-2 gap-3"
          >
            <UpDownCard
              asset={g.asset}
              expiryMs={g.expiryMs}
              spotUsd={g.spotUsd}
              forwardUsd={g.forwardUsd}
              eyebrow={eyebrow}
              rows={g.upDown.map((r) => ({
                strikeUsd: r.strikeUsd,
                impliedProbUp: r.impliedProbUp,
              }))}
            />
            <RangeCard
              asset={g.asset}
              expiryMs={g.expiryMs}
              spotUsd={g.spotUsd}
              forwardUsd={g.forwardUsd}
              eyebrow={eyebrow}
              rows={g.range.map((r) => ({
                floorStrikeUsd: r.floorStrikeUsd ?? 0,
                capStrikeUsd: r.capStrikeUsd ?? 0,
                rangeBandPct: r.rangeBandPct,
                impliedProbUp: r.impliedProbUp,
              }))}
            />
          </div>
        ))}
    </div>
  );
}
