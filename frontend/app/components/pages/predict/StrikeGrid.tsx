'use client';

import { useMemo } from 'react';
import { calculateMintPrice, type SVIParams } from '../../../hooks/useSVI';
import { formatPrice } from './utils';

const TEXT_PRIMARY = '#ffffff';
const TEXT_SECONDARY = '#9ca3af';
const TEXT_MUTED = '#6b7280';
const GREEN_BAR = 'rgba(34,197,94,0.12)';
const GREEN_HI = 'rgba(34,197,94,0.9)';
const GREEN_MID = 'rgba(34,197,94,0.7)';
const RED_BAR = 'rgba(239,68,68,0.12)';
const RED_HI = 'rgba(239,68,68,0.9)';
const RED_MID = 'rgba(239,68,68,0.7)';

const TICK_SIZE = 1000;
const NUM_ABOVE = 5;
const NUM_BELOW = 5;
const PRICE_SCALE = 1e9;

interface MarketLike {
  spot: number; // raw ×1e9
  forward: number; // raw ×1e9
  svi: SVIParams | null;
  expiryMs: number;
}

interface StrikeGridProps {
  market: MarketLike | null;
  currentStrike: number;
  onStrikeChange: (strike: number) => void;
}

interface StrikeEntry {
  strike: number;
  upProb: number;
  downProb: number;
}

interface Signal {
  indicator: string;
  color: string;
}

export default function StrikeGrid({
  market,
  currentStrike,
  onStrikeChange,
}: StrikeGridProps) {
  const forwardPrice = market ? market.forward / PRICE_SCALE : 0;
  const spotPrice = market ? market.spot / PRICE_SCALE : 0;
  const expiryMs = market?.expiryMs ?? 0;

  const strikes: StrikeEntry[] = useMemo(() => {
    if (!market || !forwardPrice) return [];
    const T = Math.max(
      0,
      (expiryMs - Date.now()) / (365.25 * 24 * 3600 * 1000)
    );
    const sviParams: SVIParams =
      market.svi ?? {
        a: 80887,
        b: 9328786,
        rho: 102029829,
        m: 7561599,
        sigma: 9522806,
      };

    const entries: StrikeEntry[] = [];
    const baseStrike = Math.round(forwardPrice / TICK_SIZE) * TICK_SIZE;

    for (let i = 1; i <= NUM_ABOVE; i++) {
      const strike = baseStrike + i * TICK_SIZE;
      const { up, down } = calculateMintPrice(
        strike,
        market.forward,
        expiryMs,
        sviParams
      );
      entries.push({
        strike,
        upProb: Math.round(up),
        downProb: Math.round(down),
      });
    }

    for (let i = 0; i <= NUM_BELOW; i++) {
      const strike = baseStrike - i * TICK_SIZE;
      if (strike <= 0) continue;
      const { up, down } = calculateMintPrice(
        strike,
        market.forward,
        expiryMs,
        sviParams
      );
      entries.push({
        strike,
        upProb: Math.round(up),
        downProb: Math.round(down),
      });
    }

    entries.sort((a, b) => b.strike - a.strike);
    return entries;
  }, [market, forwardPrice, expiryMs]);

  const aboveStrikes = strikes.filter((s) => s.strike > forwardPrice);
  const belowStrikes = strikes.filter((s) => s.strike <= forwardPrice);

  const getAboveSignal = (entry: StrikeEntry, index: number): Signal => {
    const nextProb =
      index < aboveStrikes.length - 1
        ? aboveStrikes[index + 1].upProb
        : entry.upProb;
    const diff = entry.upProb - nextProb;
    if (entry.upProb >= 60) {
      return {
        indicator: diff >= 0 ? '▲▲' : '▼▼',
        color: GREEN_HI,
      };
    } else if (entry.upProb >= 40) {
      return {
        indicator: diff >= 0 ? '▲' : '▼',
        color: GREEN_MID,
      };
    }
    return { indicator: '●', color: TEXT_MUTED };
  };

  const getBelowSignal = (entry: StrikeEntry, index: number): Signal => {
    const nextProb =
      index < belowStrikes.length - 1
        ? belowStrikes[index + 1].downProb
        : entry.downProb;
    const diff = entry.downProb - nextProb;
    if (entry.downProb >= 60) {
      return {
        indicator: diff >= 0 ? '▼▼' : '▲▲',
        color: RED_HI,
      };
    } else if (entry.downProb >= 40) {
      return {
        indicator: diff >= 0 ? '▼' : '▲',
        color: RED_MID,
      };
    }
    return { indicator: '●', color: TEXT_MUTED };
  };

  const handleSelectSpot = () => {
    onStrikeChange(parseFloat(spotPrice.toFixed(2)));
  };

  if (!market) return null;

  return (
    <div
      className="flex flex-col h-full overflow-hidden font-mono"
      style={{
        background: 'rgba(26, 29, 46, 0.6)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Column headers */}
      <div
        className="grid grid-cols-[1fr_2fr_1fr] gap-2 px-3 py-2 text-[10px] uppercase tracking-wide border-b border-white/5"
        style={{ color: TEXT_SECONDARY }}
      >
        <span>Strike</span>
        <span className="text-center">Skew</span>
        <span className="text-right">%</span>
      </div>

      {/* Strikes list */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {/* Above spot — UP bets (green bars) */}
        <div className="flex-1 overflow-auto flex flex-col justify-end min-h-0">
          {aboveStrikes.map((entry, index) => {
            const signal = getAboveSignal(entry, index);
            const isSelected = Math.abs(currentStrike - entry.strike) < 0.5;
            return (
              <button
                key={entry.strike}
                onClick={() => onStrikeChange(entry.strike)}
                className="grid grid-cols-[1fr_2fr_1fr] gap-2 px-3 py-1 text-[11px] relative transition-colors hover:bg-white/5 text-left"
                style={{
                  background: isSelected
                    ? 'rgba(34,197,94,0.15)'
                    : 'transparent',
                }}
              >
                {/* Depth bar */}
                <div
                  className="absolute inset-y-0 right-0 pointer-events-none"
                  style={{
                    width: `${entry.upProb}%`,
                    background: GREEN_BAR,
                  }}
                />
                <span
                  className="relative z-10 font-semibold"
                  style={{ color: TEXT_PRIMARY }}
                >
                  {formatPrice(entry.strike)}
                </span>
                <span
                  className="relative z-10 text-center text-xs"
                  style={{ color: signal.color }}
                >
                  {signal.indicator}
                </span>
                <span
                  className="relative z-10 text-right"
                  style={{ color: TEXT_SECONDARY }}
                >
                  {entry.upProb}%
                </span>
              </button>
            );
          })}
        </div>

        {/* SPOT divider — clickable */}
        <button
          onClick={handleSelectSpot}
          className="px-3 py-2 flex items-center justify-center gap-3 cursor-pointer transition-colors"
          style={{
            background: 'rgba(62,196,192,0.1)',
            borderTop: '1px solid rgba(62,196,192,0.2)',
            borderBottom: '1px solid rgba(62,196,192,0.2)',
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = 'rgba(62,196,192,0.2)')
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = 'rgba(62,196,192,0.1)')
          }
        >
          <span
            className="text-sm font-bold"
            style={{ color: TEXT_PRIMARY }}
          >
            {formatPrice(spotPrice)}
          </span>
        </button>

        {/* Below spot — DOWN bets (red bars) */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {belowStrikes.map((entry, index) => {
            const signal = getBelowSignal(entry, index);
            const isSelected = Math.abs(currentStrike - entry.strike) < 0.5;
            return (
              <button
                key={entry.strike}
                onClick={() => onStrikeChange(entry.strike)}
                className="grid grid-cols-[1fr_2fr_1fr] gap-2 px-3 py-1 text-[11px] relative transition-colors hover:bg-white/5 text-left"
                style={{
                  background: isSelected
                    ? 'rgba(239,68,68,0.15)'
                    : 'transparent',
                }}
              >
                {/* Depth bar */}
                <div
                  className="absolute inset-y-0 right-0 pointer-events-none"
                  style={{
                    width: `${entry.downProb}%`,
                    background: RED_BAR,
                  }}
                />
                <span
                  className="relative z-10 font-semibold"
                  style={{ color: TEXT_PRIMARY }}
                >
                  {formatPrice(entry.strike)}
                </span>
                <span
                  className="relative z-10 text-center text-xs"
                  style={{ color: signal.color }}
                >
                  {signal.indicator}
                </span>
                <span
                  className="relative z-10 text-right"
                  style={{ color: TEXT_SECONDARY }}
                >
                  {entry.downProb}%
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
