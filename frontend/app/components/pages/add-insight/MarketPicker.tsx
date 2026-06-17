'use client';

/**
 * MarketPicker — the compact list of DeepBook Predict oracles that
 * drives the cross-venue compare panel.
 *
 * Replaces the old Step 1 from the 3-step wizard. On the single-screen
 * Insights page this picker is always visible at the top of the
 * page; the 3-column compare (DeepBook / Polymarket / Kalshi) sits
 * directly below it and updates instantly on every selection — no
 * step transitions, no auto-advance.
 *
 * Three time-horizon chips (1d / 3d / 7d) above the picker narrow the
 * visible markets to those expiring within the window. Each chip
 * shows a count so the user knows what they're getting into. The
 * picker auto-selects the most-imminent market within the chosen
 * horizon — both on mount and on horizon change — so the compare
 * panel below is always populated.
 *
 * `findMatchingGroups` is computed for the currently-selected oracle
 * so `onPick` can stamp the matches onto the picked payload (the
 * LiveComparePanel reads them off `picked`).
 */

import { useEffect, useMemo, useState } from 'react';
import { formatUsd } from '@/lib/markets/format';
import { formatExpiryLabel } from '../../../lib/insights';
import {
  groupPolymarketMarkets,
  type PolymarketGroup,
} from '@/lib/markets/polymarket';
import {
  groupKalshiMarkets,
  type KalshiGroup,
} from '@/lib/markets/kalshi';
import { findMatchingGroups } from '@/lib/markets/match';
import { useGlobalMarkets } from '../../../stores/markets-store';
import { useMarkets as useDeepBookMarkets } from '../../../hooks/useMarkets';
import type { Market as DbMarket } from '../../../hooks/useMarkets';

const PRICE_SCALE = 1e9;
const green = '#00E68A';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

const HORIZONS = [
  { id: '1d', label: '1d', days: 1 },
  { id: '3d', label: '3d', days: 3 },
  { id: '7d', label: '7d', days: 7 },
] as const;

type HorizonId = (typeof HORIZONS)[number]['id'];

interface Props {
  selectedOracleId: string | null;
  onPick: (payload: {
    oracle: DbMarket;
    poly: PolymarketGroup | null;
    kalshi: KalshiGroup | null;
  }) => void;
}

function findNearest(markets: DbMarket[]): DbMarket | null {
  if (markets.length === 0) return null;
  const now = Date.now();
  let best = markets[0];
  let bestDelta = Math.abs(markets[0].expiryMs - now);
  for (let i = 1; i < markets.length; i++) {
    const delta = Math.abs(markets[i].expiryMs - now);
    if (delta < bestDelta) {
      best = markets[i];
      bestDelta = delta;
    }
  }
  return best;
}

export default function MarketPicker({ selectedOracleId, onPick }: Props) {
  const { markets: dbMarkets, loading: dbLoading, error: dbError } = useDeepBookMarkets();
  const { polyRows, kalshiRows } = useGlobalMarkets();

  const [horizon, setHorizon] = useState<HorizonId>('1d');

  const polyGroups = useMemo(() => groupPolymarketMarkets(polyRows ?? []), [polyRows]);
  const kalshiGroups = useMemo(() => groupKalshiMarkets(kalshiRows ?? []), [kalshiRows]);

  // Counts per horizon, so the chips show "1d · 6" / "3d · 12" / etc.
  const horizonCounts = useMemo(() => {
    const now = Date.now();
    const map: Record<HorizonId, number> = { '1d': 0, '3d': 0, '7d': 0 };
    for (const h of HORIZONS) {
      const cutoff = h.days * 24 * 60 * 60 * 1000;
      map[h.id] = dbMarkets.filter((m) => m.expiryMs - now <= cutoff).length;
    }
    return map;
  }, [dbMarkets]);

  // Markets visible in the current horizon, sorted by expiry ascending.
  const visibleMarkets = useMemo(() => {
    const now = Date.now();
    const cutoff = HORIZONS.find((h) => h.id === horizon)!.days * 24 * 60 * 60 * 1000;
    return [...dbMarkets]
      .filter((m) => m.expiryMs - now <= cutoff)
      .sort((a, b) => a.expiryMs - b.expiryMs);
  }, [dbMarkets, horizon]);

  const selected = useMemo(
    () => dbMarkets.find((m) => m.oracle_id === selectedOracleId) ?? null,
    [dbMarkets, selectedOracleId],
  );

  // Cache the matches for the currently-selected oracle so `onPick`
  // can stamp them onto the payload (LiveComparePanel reads them off
  // `picked`).
  const matches = useMemo(() => {
    if (!selected) return { poly: null as PolymarketGroup | null, kalshi: null as KalshiGroup | null };
    return findMatchingGroups(
      { oracleId: selected.oracle_id, expiryMs: selected.expiryMs, question: selected.name },
      polyGroups,
      kalshiGroups,
    );
  }, [selected, polyGroups, kalshiGroups]);

  // Auto-pick the most-imminent market within the chosen horizon
  // whenever:
  //   - nothing is selected yet (mount + re-entry)
  //   - the selected market fell out of the new horizon
  // Runs once per horizon/markets change. Skips while markets are
  // still loading so we don't flicker an auto-pick then immediately
  // overwrite it.
  useEffect(() => {
    if (dbLoading) return;
    if (visibleMarkets.length === 0) return;
    const inHorizon = visibleMarkets.find((m) => m.oracle_id === selectedOracleId);
    if (inHorizon) return;
    const nearest = findNearest(visibleMarkets);
    if (!nearest) return;
    const next = findMatchingGroups(
      { oracleId: nearest.oracle_id, expiryMs: nearest.expiryMs, question: nearest.name },
      polyGroups,
      kalshiGroups,
    );
    onPick({ oracle: nearest, poly: next.poly, kalshi: next.kalshi });
    // Intentionally omit `onPick` from deps — it changes identity on
    // every parent render. We only want to react to the inputs that
    // could change the auto-pick target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleMarkets, dbLoading, polyGroups, kalshiGroups, selectedOracleId]);

  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl border border-white/10 p-4"
        style={{ background: 'rgba(26, 29, 46, 0.6)', backdropFilter: 'blur(20px)' }}
      >
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold" style={{ color: textPrimary }}>
              Pick a DeepBook Predict market
            </h2>
            <p className="text-xs mt-0.5" style={{ color: textSecondary }}>
              We&apos;ll match it to Polymarket and Kalshi markets with the same expiry.
            </p>
          </div>

          {/* Horizon chips */}
          <div
            className="inline-flex items-center rounded-lg p-0.5 gap-0.5"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {HORIZONS.map((h) => {
              const isActive = horizon === h.id;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setHorizon(h.id)}
                  className="px-3 py-1 rounded-md text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
                  style={{
                    background: isActive ? green : 'transparent',
                    color: isActive ? '#000' : textSecondary,
                    cursor: 'pointer',
                  }}
                >
                  {h.label}
                  <span
                    className="text-[10px] font-mono px-1 rounded"
                    style={{
                      background: isActive ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.06)',
                      color: isActive ? '#000' : textSecondary,
                    }}
                  >
                    {horizonCounts[h.id]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {dbLoading && (
          <div className="text-sm py-6 text-center" style={{ color: textSecondary }}>
            Loading markets…
          </div>
        )}

        {dbError && (
          <div
            className="rounded-lg p-3 text-sm"
            style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}
          >
            Failed to load markets: {dbError}
          </div>
        )}

        {!dbLoading && !dbError && visibleMarkets.length === 0 && (
          <div className="text-sm py-6 text-center" style={{ color: textSecondary }}>
            {dbMarkets.length === 0
              ? 'No active DeepBook Predict markets right now.'
              : `No DeepBook Predict markets expiring within ${HORIZONS.find((h) => h.id === horizon)?.label}. Try a longer horizon.`}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {visibleMarkets.map((m) => {
            const isSelected = m.oracle_id === selectedOracleId;
            const remaining = formatExpiryLabel(m.expiryMs);
            return (
              <button
                key={m.oracle_id}
                type="button"
                onClick={() => onPick({ oracle: m, poly: matches.poly, kalshi: matches.kalshi })}
                className="text-left rounded-lg p-3 border transition-colors"
                style={{
                  background: isSelected ? 'rgba(0, 230, 138, 0.08)' : 'rgba(255,255,255,0.04)',
                  borderColor: isSelected ? green : 'rgba(255,255,255,0.08)',
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold" style={{ color: textPrimary }}>
                    {m.asset} · {formatUsd(m.spot / PRICE_SCALE)}
                  </span>
                  <span
                    className="text-[10px] uppercase tracking-wider font-semibold"
                    style={{ color: isSelected ? green : textSecondary }}
                  >
                    {isSelected ? 'Selected' : 'Select'}
                  </span>
                </div>
                <div className="text-xs mt-1 font-mono" style={{ color: textSecondary }}>
                  {remaining}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
