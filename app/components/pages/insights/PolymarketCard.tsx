'use client';

import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import GlassCard from '../../common/GlassCard';
import {
  searchPredictionMarkets,
  type PolymarketMarketRaw,
} from '../../../lib/polymarket';
import type { PolymarketMarket } from '../../../lib/insights';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

const TOP_N = 5;

interface Props {
  apiKey: string;
  value: PolymarketMarket[];
  onChange: (markets: PolymarketMarket[]) => void;
}

/** Map the raw Tatum response into the compact `PolymarketMarket` we embed. */
function toInsightMarket(m: PolymarketMarketRaw): PolymarketMarket {
  return {
    id: m.id,
    question: m.question,
    outcomes: m.outcomes.map((o) => ({ name: o.name, price: o.price })),
    volume: m.volume,
    liquidity: m.liquidity,
    closeTime: m.closeTime ?? '',
    sourceUrl: m.source?.url ?? `https://polymarket.com/event/${m.id}`,
  };
}

/**
 * Pick the top N markets most worth embedding in an insight blob.
 *
 *  - drop 5-minute markets: too granular for a daily/weekly insight;
 *    their pricing is mostly noise relative to the candle resolution
 *  - rank by: (1) total $ volume desc, (2) |0.5 - up_price| desc as
 *    tie-breaker — markets that have actually been traded *and* have
 *    a clear favourite are the most "meaningful"
 *
 * The upstream is sorted by `sort=newest` (Tatum's prediction-markets
 * endpoint rejects other sort keys with 400), so the meaningfulness
 * ranking is computed client-side. The tie-breaker handles markets
 * that share a $0 volume (e.g. unopened 1H markets with 0.5/0.5 mid
 * pricing).
 */
function pickMeaningful(markets: PolymarketMarketRaw[], n: number): PolymarketMarketRaw[] {
  return markets
    .filter((m) => !(m.tags ?? []).includes('5M'))
    .slice() // don't mutate the upstream array
    .sort((a, b) => {
      const volDiff = (b.volume ?? 0) - (a.volume ?? 0);
      if (volDiff !== 0) return volDiff;
      const aUp = a.outcomes.find((o) => o.name === 'UP')?.price ?? 0.5;
      const bUp = b.outcomes.find((o) => o.name === 'UP')?.price ?? 0.5;
      return Math.abs(0.5 - bUp) - Math.abs(0.5 - aUp);
    })
    .slice(0, n);
}

/**
 * PolymarketCard — auto-picks the top 5 most meaningful BTC markets.
 *
 * Runs a single `search=bitcoin, tag=up-or-down, sort=volume` query on
 * mount, then surfaces the highest-volume markets that aren't 5-minute
 * coin flips. The user can drop any pick via a small × button; there
 * is no search/filter UI — keeps the wizard focused and noise-free.
 */
export default function PolymarketCard({ apiKey, value, onChange }: Props) {
  const [enabled, setEnabled] = useState(value.length > 0);
  const [picks, setPicks] = useState<PolymarketMarketRaw[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !apiKey) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    searchPredictionMarkets(apiKey, {
      search: 'bitcoin',
      tag: 'up-or-down',
      status: 'active',
      sort: 'newest',
      limit: 100,
    })
      .then((r) => {
        if (cancelled) return;
        const top = pickMeaningful(r, TOP_N);
        setPicks(top);
        onChange(top.map(toInsightMarket));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Search failed');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, apiKey, onChange]);

  function drop(id: string) {
    const next = picks.filter((p) => p.id !== id);
    setPicks(next);
    onChange(next.map(toInsightMarket));
  }

  return (
    <GlassCard>
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              if (!e.target.checked) {
                setPicks([]);
                onChange([]);
              }
            }}
            className="mt-1"
          />
          <div className="flex-1">
            <div className="flex items-center gap-1.5"> 
              <div className="text-sm font-semibold" style={{ color: textPrimary }}>
                Polymarket BTC
              </div>
            </div>
            <div className="text-xs mt-0.5" style={{ color: textSecondary }}>
              Top {TOP_N} BTC markets by trading volume, refreshing live from Polymarket.
            </div>
          </div>
        </div>

        {enabled && (
          <div className="space-y-2 pl-7">
            {loading && picks.length === 0 && (
              <div
                className="flex items-center gap-2 text-xs"
                style={{ color: textSecondary }}
              >
                <Loader2 size={12} className="animate-spin" /> Picking the {TOP_N} most meaningful markets…
              </div>
            )}
            {error && (
              <p className="text-xs" style={{ color: red }}>
                {error}
              </p>
            )}
            {picks.length > 0 && (
              <div
                className="rounded-lg overflow-auto"
                style={{
                  border: '1px solid rgba(255,255,255,0.08)',
                  maxHeight: 320,
                }}
              >
                {picks.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-start gap-2 p-2"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-xs font-semibold truncate"
                        style={{ color: textPrimary }}
                      >
                        {m.question}
                      </div>
                      <div
                        className="text-[10px] font-mono mt-0.5 truncate"
                        style={{ color: textSecondary }}
                      >
                        {m.outcomes
                          .map((o) => `${o.name} ${(o.price * 100).toFixed(0)}¢`)
                          .join(' · ')}
                        {' · '}vol $
                        {Math.round(m.volume).toLocaleString()} · liq $
                        {Math.round(m.liquidity).toLocaleString()}
                        {m.closeTime
                          ? ` · closes ${new Date(m.closeTime).toUTCString().slice(0, 16)}`
                          : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => drop(m.id)}
                      className="flex-shrink-0 p-1 rounded transition-colors hover:bg-white/5"
                      title="Drop this market"
                    >
                      <X size={12} style={{ color: textSecondary }} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {picks.length > 0 && (
              <p
                className="text-[10px] font-mono"
                style={{ color: textSecondary }}
              >
                {picks.length} of {TOP_N} kept
              </p>
            )}
          </div>
        )}
      </div>
    </GlassCard>
  );
}
