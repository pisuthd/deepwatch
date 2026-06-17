'use client';

/**
 * LiveComparePanel — the 3-column cross-venue compare (DeepBook Predict,
 * Polymarket, Kalshi) used on the single-screen Add Insight page.
 *
 * Synthesizes the DeepBook 5-strike + 3-band ladder from the oracle's
 * SVI surface using Black-76 + SVI math (mirrors the math in
 * `app/hooks/useMarkets.ts`). The Polymarket + Kalshi ladders come
 * straight from the matched groups; missing matches render a
 * `ComparePlaceholder` so the user can see why one venue dropped out.
 */

import { useMemo } from 'react';
import { formatExpiryLabel } from '../../../lib/insights';
import type { PolymarketGroup } from '@/lib/markets/polymarket';
import type { KalshiGroup } from '@/lib/markets/kalshi';
import type { Market as DbMarket } from '../../../hooks/useMarkets';
import UpDownCard, { type UpDownRow } from '@/components/compare/UpDownCard';
import RangeCard, { type RangeRow } from '@/components/compare/RangeCard';

const PRICE_SCALE = 1e9;
const SVI_SCALE = 1e8;
const RHO_SCALE = 1e9;

const TICK = 1000;
const N_STRIKES = 5;
const RANGE_BAND_WIDTHS_PCT = [2, 6, 10] as const;

function normCDF(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

function sviVol(K: number, F: number, T: number, svi: { a: number; b: number; rho: number; m: number; sigma: number }): number {
  if (T <= 0) return svi.sigma / SVI_SCALE;
  const a = svi.a / SVI_SCALE;
  const b = svi.b / SVI_SCALE;
  const rho = svi.rho / RHO_SCALE;
  const m = svi.m / SVI_SCALE;
  const sig = svi.sigma / SVI_SCALE;
  const k = Math.log(K / F);
  const w = a + b * (rho * (k - m) + Math.sqrt((k - m) ** 2 + sig ** 2));
  return w > 0 ? Math.sqrt(w / T) : sig;
}

function binaryUpProb(F: number, K: number, T: number, vol: number): number {
  if (T <= 0 || vol <= 0) return F > K ? 1 : 0;
  const d2 = (Math.log(F / K) - 0.5 * vol ** 2 * T) / (vol * Math.sqrt(T));
  return normCDF(d2);
}

function generateStrikes(centerUsd: number, count: number, tick: number): number[] {
  if (!centerUsd || count <= 0 || tick <= 0) return [];
  const center = Math.round(centerUsd / tick) * tick;
  const half = Math.floor(count / 2);
  return Array.from({ length: count }, (_, i) => center + (i - half) * tick);
}

function generateRangeBands(spotUsd: number, tick: number): { floorUsd: number; capUsd: number; widthPct: number }[] {
  if (!spotUsd || spotUsd <= 0 || tick <= 0) return [];
  return RANGE_BAND_WIDTHS_PCT.map((widthPct) => {
    const half = (spotUsd * widthPct) / 200;
    const rawFloor = spotUsd - half;
    const rawCap = spotUsd + half;
    const floorUsd = Math.floor(rawFloor / tick) * tick;
    const capUsd = Math.ceil(rawCap / tick) * tick;
    return { floorUsd, capUsd, widthPct };
  });
}

function buildDeepBookUpDown(market: DbMarket): { rows: UpDownRow[]; spot: number; forward: number } | null {
  if (!market.svi || !market.forward || market.forward <= 0) return null;
  const F = market.forward / PRICE_SCALE;
  const spot = (market.spot || 0) / PRICE_SCALE;
  const T = Math.max(0, (market.expiryMs - Date.now()) / (365.25 * 24 * 3600 * 1000));
  if (T <= 0) return null;

  const strikes = generateStrikes(spot, N_STRIKES, TICK);
  const rows: UpDownRow[] = strikes.map((strikeUsd) => {
    const vol = sviVol(strikeUsd, F, T, market.svi!);
    return {
      strikeUsd,
      impliedProbUp: binaryUpProb(F, strikeUsd, T, vol),
      description: null,
      priceToBeatUsd: null,
    };
  });

  return { rows, spot, forward: F };
}

function buildDeepBookRange(market: DbMarket): { rows: RangeRow[]; spot: number } | null {
  if (!market.svi || !market.forward || market.forward <= 0) return null;
  const F = market.forward / PRICE_SCALE;
  const spot = (market.spot || 0) / PRICE_SCALE;
  const T = Math.max(0, (market.expiryMs - Date.now()) / (365.25 * 24 * 3600 * 1000));
  if (T <= 0) return null;

  const bands = generateRangeBands(spot, TICK);
  const rows: RangeRow[] = bands.map((b) => {
    const volFloor = sviVol(b.floorUsd, F, T, market.svi!);
    const volCap = sviVol(b.capUsd, F, T, market.svi!);
    const inProb = Math.max(
      0,
      binaryUpProb(F, b.floorUsd, T, volFloor) - binaryUpProb(F, b.capUsd, T, volCap),
    );
    return {
      floorStrikeUsd: b.floorUsd,
      capStrikeUsd: b.capUsd,
      rangeBandPct: b.widthPct,
      impliedProbUp: inProb,
      description: null,
    };
  });

  return { rows, spot };
}

interface LiveComparePanelProps {
  picked: {
    oracle: DbMarket;
    poly: PolymarketGroup | null;
    kalshi: KalshiGroup | null;
  } | null;
}

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

export default function LiveComparePanel({ picked }: LiveComparePanelProps) {
  const selected = picked?.oracle ?? null;
  const poly = picked?.poly ?? null;
  const kalshi = picked?.kalshi ?? null;

  const dbUpDown = useMemo(() => (selected ? buildDeepBookUpDown(selected) : null), [selected]);
  const dbRange = useMemo(() => (selected ? buildDeepBookRange(selected) : null), [selected]);

  if (!selected || !dbUpDown || !dbRange) {
    return (
      <div
        className="rounded-2xl border border-white/10 p-6 text-center"
        style={{
          background: 'rgba(26, 29, 46, 0.6)',
          backdropFilter: 'blur(20px)',
          minHeight: 220,
        }}
      >
        <div
          className="text-[10px] font-semibold uppercase tracking-wider mb-2"
          style={{ color: textSecondary }}
        >
          Live compare
        </div>
        <div className="text-sm" style={{ color: textSecondary }}>
          Pick a DeepBook Predict market on step 1 to see Polymarket and Kalshi matches here.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>
          Live odds · {selected.asset}
        </h3>
        <span className="text-[10px] font-mono" style={{ color: textSecondary }}>
          {formatExpiryLabel(selected.expiryMs)}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Column 1 — DeepBook Predict */}
        <div className="space-y-3">
          <UpDownCard
            asset={selected.asset}
            expiryMs={selected.expiryMs}
            spotUsd={dbUpDown.spot}
            forwardUsd={dbUpDown.forward}
            rows={dbUpDown.rows}
            eyebrow={
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent-primary)]">
                DeepBook Predict
              </div>
            }
          />
          <RangeCard
            asset={selected.asset}
            expiryMs={selected.expiryMs}
            spotUsd={dbRange.spot}
            forwardUsd={dbUpDown.forward}
            rows={dbRange.rows}
            eyebrow={
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent-primary)]">
                DeepBook Predict
              </div>
            }
          />
        </div>

        {/* Column 2 — Polymarket */}
        <div className="space-y-3">
          {poly ? (
            <>
              <UpDownCard
                asset={selected.asset}
                expiryMs={poly.expiryMs}
                spotUsd={dbUpDown.spot}
                forwardUsd={dbUpDown.forward}
                rows={poly.upDown}
                question={poly.question}
                eyebrow={
                  <div
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: '#3b82f6' }}
                  >
                    Polymarket
                  </div>
                }
              />
              {poly.range.length > 0 && (
                <RangeCard
                  asset={selected.asset}
                  expiryMs={poly.expiryMs}
                  spotUsd={dbUpDown.spot}
                  forwardUsd={dbUpDown.forward}
                  rows={poly.range}
                  question={poly.question}
                  eyebrow={
                    <div
                      className="text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: '#3b82f6' }}
                    >
                      Polymarket
                    </div>
                  }
                />
              )}
            </>
          ) : (
            <ComparePlaceholder
              platform="Polymarket"
              asset={selected.asset}
              expiryMs={selected.expiryMs}
            />
          )}
        </div>

        {/* Column 3 — Kalshi */}
        <div className="space-y-3">
          {kalshi ? (
            <>
              <UpDownCard
                asset={selected.asset}
                expiryMs={kalshi.expiryMs}
                spotUsd={dbUpDown.spot}
                forwardUsd={dbUpDown.forward}
                rows={kalshi.upDown}
                question={kalshi.question}
                eyebrow={
                  <div
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: '#a855f7' }}
                  >
                    Kalshi
                  </div>
                }
              />
              {kalshi.range.length > 0 && (
                <RangeCard
                  asset={selected.asset}
                  expiryMs={kalshi.expiryMs}
                  spotUsd={dbUpDown.spot}
                  forwardUsd={dbUpDown.forward}
                  rows={kalshi.range}
                  question={kalshi.question}
                  eyebrow={
                    <div
                      className="text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: '#a855f7' }}
                    >
                      Kalshi
                    </div>
                  }
                />
              )}
            </>
          ) : (
            <ComparePlaceholder
              platform="Kalshi"
              asset={selected.asset}
              expiryMs={selected.expiryMs}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ComparePlaceholder({
  platform,
  asset,
  expiryMs,
}: {
  platform: string;
  asset: string;
  expiryMs: number;
}) {
  return (
    <div
      className="rounded-2xl border border-white/10 p-6 text-center"
      style={{
        background: 'rgba(26, 29, 46, 0.6)',
        backdropFilter: 'blur(20px)',
        minHeight: 220,
      }}
    >
      <div
        className="text-[10px] font-semibold uppercase tracking-wider mb-2"
        style={{ color: textSecondary }}
      >
        {platform}
      </div>
      <div className="text-sm" style={{ color: textSecondary }}>
        No {platform} market within 1 hour of this expiry.
      </div>
      <div className="text-[10px] font-mono mt-2" style={{ color: textSecondary }}>
        {asset} · {formatExpiryLabel(expiryMs)}
      </div>
    </div>
  );
}
