'use client';

/**
 * MarketPicker — random-pick chips that drive the cross-venue compare
 * panel.
 *
 * Replaces the old Step 1 from the 3-step wizard and the prior
 * chip-and-grid design. On the single-screen Insights page this
 * picker is the only thing above the compare panel — three horizon
 * chips (1d / 3d / 7d) and a tiny caption that says which market was
 * picked and where it lives in the chosen horizon. No grid, no
 * scroll-to-see list.
 *
 * Behavior:
 *  - On mount, auto-fallback: pick the first non-empty horizon
 *    (1d → 3d → 7d) and random-pick one market inside it. The
 *    compare panel is never empty on first paint unless every
 *    horizon is empty.
 *  - Clicking a chip random-picks a new market in that horizon
 *    (the same horizon if you click the active chip — "shake the
 *    dice").
 *  - Chips with zero markets in their window render disabled.
 *  - The parent's `selectedOracleId` is respected — once a pick is
 *    in flight, plain dep changes (dbMarkets refetch, etc.) don't
 *    re-roll it. Only a chip click re-rolls.
 *
 * `findMatchingGroups` is computed for the currently-selected oracle
 * so `onPick` can stamp the matches onto the payload (the
 * LiveComparePanel reads them off `picked`).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatExpiryLabel } from '../../../lib/insights';
import { formatDetailedExpiry } from '@/lib/markets/format';
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

const green = '#00E68A';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const red = '#ef4444';

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

function pickRandom(markets: DbMarket[]): DbMarket | null {
  if (markets.length === 0) return null;
  return markets[Math.floor(Math.random() * markets.length)];
}

function marketsInHorizon(dbMarkets: DbMarket[], days: number): DbMarket[] {
  const now = Date.now();
  const cutoff = days * 24 * 60 * 60 * 1000;
  return dbMarkets.filter((m) => m.expiryMs - now <= cutoff);
}

export default function MarketPicker({ selectedOracleId, onPick }: Props) {
  const { markets: dbMarkets, loading: dbLoading, error: dbError } = useDeepBookMarkets();
  const { polyRows, kalshiRows } = useGlobalMarkets();

  const [horizon, setHorizon] = useState<HorizonId>('1d');
  // Increments on every chip click (including re-clicks of the active
  // chip). Lets the pick effect distinguish "user clicked → re-roll"
  // from "deps changed for an unrelated reason → keep selection".
  const [nonce, setNonce] = useState(0);
  const userClickedRef = useRef(false);

  const polyGroups = useMemo(() => groupPolymarketMarkets(polyRows ?? []), [polyRows]);
  const kalshiGroups = useMemo(() => groupKalshiMarkets(kalshiRows ?? []), [kalshiRows]);

  // Counts per horizon, so the chips show "1d · 6" / "3d · 12" / etc.
  const horizonCounts = useMemo(() => {
    const map: Record<HorizonId, number> = { '1d': 0, '3d': 0, '7d': 0 };
    for (const h of HORIZONS) {
      map[h.id] = marketsInHorizon(dbMarkets, h.days).length;
    }
    return map;
  }, [dbMarkets]);

  // Sync `horizon` to the first non-empty bucket whenever the
  // current one empties (mount with 1d=0, market count drops to 0,
  // etc.). Only changes state — never picks — so the pick effect
  // can stay pure.
  useEffect(() => {
    if (dbLoading) return;
    if (horizonCounts[horizon] > 0) return;
    const next = HORIZONS.find((h) => horizonCounts[h.id] > 0);
    if (next && next.id !== horizon) setHorizon(next.id);
  }, [dbLoading, horizonCounts, horizon]);

  const selected = useMemo(
    () => dbMarkets.find((m) => m.oracle_id === selectedOracleId) ?? null,
    [dbMarkets, selectedOracleId],
  );

  // Pick effect. Runs on:
  //   - dbMarkets/dbLoading flip → auto-pick on mount with no selection
  //   - horizon change → random pick inside the new horizon
  //   - nonce change → random pick inside the current horizon (re-roll)
  // Skipped when there's already a selection AND no user click has
  // happened since the last pick (protects the user's pick from being
  // overwritten by a 90s dbMarkets refetch).
  useEffect(() => {
    if (dbLoading) return;
    if (!userClickedRef.current && selectedOracleId !== null) return;
    userClickedRef.current = false;

    const days = HORIZONS.find((h) => h.id === horizon)!.days;
    const inHorizon = marketsInHorizon(dbMarkets, days);
    const pick = pickRandom(inHorizon);
    if (!pick) return;

    const next = findMatchingGroups(
      { oracleId: pick.oracle_id, expiryMs: pick.expiryMs, question: pick.name },
      polyGroups,
      kalshiGroups,
    );
    onPick({ oracle: pick, poly: next.poly, kalshi: next.kalshi });
    // Intentionally omit `onPick` from deps — it changes identity on
    // every parent render. We only want to react to the inputs that
    // could change the pick target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbMarkets, dbLoading, horizon, nonce, polyGroups, kalshiGroups, selectedOracleId]);

  function handleChipClick(h: HorizonId) {
    if (horizonCounts[h] === 0) return;
    if (h !== horizon) setHorizon(h);
    setNonce((n) => n + 1);
    userClickedRef.current = true;
  }

  const activeHorizonLabel = HORIZONS.find((h) => h.id === horizon)?.label ?? horizon;
  const allEmpty = !dbLoading && horizonCounts['1d'] === 0 && horizonCounts['3d'] === 0 && horizonCounts['7d'] === 0;

  return (
    <div
      className="rounded-2xl border border-white/10 p-4"
      style={{ background: 'rgba(26, 29, 46, 0.6)', backdropFilter: 'blur(20px)' }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Horizon chips */}
          <div
            className="inline-flex items-center rounded-lg p-0.5 gap-0.5"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {HORIZONS.map((h) => {
              const isActive = horizon === h.id;
              const isEmpty = horizonCounts[h.id] === 0;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => handleChipClick(h.id)}
                  disabled={isEmpty}
                  className="px-3 py-1 rounded-md text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
                  style={{
                    background: isActive ? green : 'transparent',
                    color: isActive ? '#000' : isEmpty ? 'rgba(156,163,175,0.4)' : textSecondary,
                    cursor: isEmpty ? 'not-allowed' : 'pointer',
                    opacity: isEmpty ? 0.55 : 1,
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

          {/* Tiny caption — what's currently picked */}
          {selected && (
            <span
              className="text-xs font-mono"
              style={{ color: textSecondary }}
              title="Random pick inside the selected horizon"
            >
              {selected.asset} · {formatDetailedExpiry(selected.expiryMs)} · {formatExpiryLabel(selected.expiryMs)} ·{' '}
              <span style={{ color: textPrimary }}>random pick inside {activeHorizonLabel}</span>
            </span>
          )}
        </div>
      </div>

      {dbLoading && (
        <div className="text-sm py-3 mt-3 text-center" style={{ color: textSecondary }}>
          Loading markets…
        </div>
      )}

      {dbError && (
        <div
          className="rounded-lg p-3 text-sm mt-3"
          style={{ background: 'rgba(239, 68, 68, 0.1)', color: red }}
        >
          Failed to load markets: {dbError}
        </div>
      )}

      {allEmpty && (
        <div className="text-sm py-3 mt-3 text-center" style={{ color: textSecondary }}>
          No active DeepBook Predict markets right now.
        </div>
      )}
    </div>
  );
}
