'use client';

import { ExternalLink } from 'lucide-react';
import { formatExpiryLabel, type PredictSnapshot, type PolymarketMarket } from '../../../lib/insights';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

/**
 * Three compact, read-only summary cards rendered inside the insight
 * detail view. They re-display the structured `includes.*` data the
 * AI used to generate the analysis — so a viewer can sanity-check the
 * underlying numbers without leaving the page. All three sub-components
 * share the same glass-card chrome and a 10px uppercase header.
 */

function CardChrome({ header, children }: { header: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div
        className="text-[10px] uppercase tracking-wide font-semibold mb-2"
        style={{ color: textSecondary }}
      >
        {header}
      </div>
      {children}
    </div>
  );
}

export function PredictSummary({ data }: { data: PredictSnapshot }) {
  return (
    <CardChrome header={`Predict snapshot · ${formatExpiryLabel(data.expiryMs)}`}>
      <div className="flex items-center gap-4 mb-3 text-xs font-mono" style={{ color: textPrimary }}>
        <span>Spot ${data.spot.toFixed(0)}</span>
        <span style={{ color: textSecondary }}>·</span>
        <span>Forward ${data.forward.toFixed(0)}</span>
      </div>
      <table className="w-full text-xs font-mono" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: textSecondary }}>
            <th className="text-left py-1 font-medium uppercase tracking-wide text-[10px]">Strike</th>
            <th className="text-right py-1 font-medium uppercase tracking-wide text-[10px]">UP%</th>
            <th className="text-right py-1 font-medium uppercase tracking-wide text-[10px]">DOWN%</th>
            <th className="text-right py-1 font-medium uppercase tracking-wide text-[10px]">IV%</th>
          </tr>
        </thead>
        <tbody>
          {data.standardStrikes.map((s) => (
            <tr key={s.strike} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <td className="py-1 text-left" style={{ color: textPrimary }}>${s.strike.toFixed(0)}</td>
              <td className="py-1 text-right" style={{ color: green }}>{(s.up * 100).toFixed(1)}</td>
              <td className="py-1 text-right" style={{ color: red }}>{(s.down * 100).toFixed(1)}</td>
              <td className="py-1 text-right" style={{ color: textPrimary }}>{(s.iv * 100).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.recentPrices.length > 0 && (
        <div className="mt-2 text-[10px]" style={{ color: textSecondary }}>
          {data.recentPrices.length} tick{data.recentPrices.length === 1 ? '' : 's'} captured
        </div>
      )}
    </CardChrome>
  );
}

export function PolymarketSummary({ data }: { data: { markets: PolymarketMarket[] } }) {
  const count = data.markets.length;
  const visible = data.markets.slice(0, 5);
  const up = (m: PolymarketMarket) =>
    m.outcomes.find((o) => /^(yes|up)$/i.test(o.name))?.price ?? m.outcomes[0]?.price ?? 0;
  const down = (m: PolymarketMarket) =>
    m.outcomes.find((o) => /^(no|down)$/i.test(o.name))?.price
      ?? m.outcomes[1]?.price
      ?? 1 - up(m);

  return (
    <CardChrome header={`Polymarket · ${count} market${count === 1 ? '' : 's'}`}>
      <div className="space-y-2">
        {visible.map((m) => (
          <a
            key={m.id}
            href={m.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-xs hover:bg-white/5 rounded px-1 py-1 -mx-1 transition-colors"
          >
            <span className="flex-1 min-w-0 truncate" style={{ color: textPrimary }}>
              {m.question}
            </span>
            <span
              className="px-1.5 py-px rounded text-[10px] font-mono font-semibold"
              style={{ background: 'rgba(0,230,138,0.15)', color: green }}
              title="UP"
            >
              {(up(m) * 100).toFixed(1)}%
            </span>
            <span
              className="px-1.5 py-px rounded text-[10px] font-mono font-semibold"
              style={{ background: 'rgba(239,68,68,0.15)', color: red }}
              title="DOWN"
            >
              {(down(m) * 100).toFixed(1)}%
            </span>
            <span className="font-mono text-[10px]" style={{ color: textSecondary }}>
              ${Math.round(m.volume / 1000)}K
            </span>
            <ExternalLink size={10} style={{ color: textSecondary }} className="flex-shrink-0" />
          </a>
        ))}
        {count > visible.length && (
          <div className="text-[10px]" style={{ color: textSecondary }}>
            +{count - visible.length} more not shown
          </div>
        )}
      </div>
    </CardChrome>
  );
}

export function KalshiSummary({ data }: { data: { tickers: string[] } }) {
  const count = data.tickers.length;
  return (
    <CardChrome header={`Kalshi · ${count} ticker${count === 1 ? '' : 's'}`}>
      <div className="flex flex-wrap gap-1.5">
        {data.tickers.map((t) => (
          <span
            key={t}
            className="font-mono text-[10px] px-1.5 py-px rounded"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: textPrimary,
            }}
          >
            {t}
          </span>
        ))}
      </div>
    </CardChrome>
  );
}
