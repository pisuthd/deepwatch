'use client';

/**
 * Three compact, read-only summary cards rendered inside the insight
 * detail view. They re-display the structured `includes.*` data the
 * AI used to generate the analysis — so a viewer can sanity-check the
 * underlying numbers without leaving the page.
 *
 * Each card shares the same chrome (glass background, 10px uppercase
 * header). Polymarket and Kalshi cards render directly from the
 * `PolymarketGroup` / `KalshiGroup` shape captured at publish time
 * (no Tatum round-trip — the data was already saved inline).
 */

import { formatExpiryLabel, type PredictSnapshot } from '../../../lib/insights';
import type { PolymarketGroup } from '@/app/lib/polymarket';
import type { KalshiGroup } from '@/app/lib/kalshi';
import { formatUsd, formatPct } from '@/app/lib/format';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

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

export function PolymarketSummary({ data }: { data: PolymarketGroup }) {
  return (
    <CardChrome header={`Polymarket · ${data.upDown.length} strike${data.upDown.length === 1 ? '' : 's'} · ${data.range.length} range${data.range.length === 1 ? '' : 's'}`}>
      {data.question && (
        <div className="text-xs mb-2 truncate" style={{ color: textPrimary }} title={data.question}>
          {data.question}
        </div>
      )}
      {data.upDown.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: textSecondary }}>
            UP/DOWN
          </div>
          <div className="space-y-1 mb-2">
            {data.upDown.slice(0, 4).map((r, i) => (
              <div
                key={`pm-ud-${i}`}
                className="flex items-center justify-between text-xs font-mono"
              >
                <span className="truncate" style={{ color: textPrimary }}>
                  {r.description?.trim() || formatUsd(r.strikeUsd)}
                </span>
                <span style={{ color: green }}>{formatPct(r.impliedProbUp, 2)}</span>
              </div>
            ))}
            {data.upDown.length > 4 && (
              <div className="text-[10px]" style={{ color: textSecondary }}>
                +{data.upDown.length - 4} more
              </div>
            )}
          </div>
        </>
      )}
      {data.range.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: textSecondary }}>
            RANGE
          </div>
          <div className="space-y-1">
            {data.range.slice(0, 3).map((r, i) => (
              <div
                key={`pm-r-${i}`}
                className="flex items-center justify-between text-xs font-mono"
              >
                <span className="truncate" style={{ color: textPrimary }}>
                  {formatUsd(r.floorStrikeUsd)}–{formatUsd(r.capStrikeUsd)}
                  <span style={{ color: textSecondary }}> ±{r.rangeBandPct.toFixed(1)}%</span>
                </span>
                <span style={{ color: green }}>{formatPct(r.impliedProbUp, 2)}</span>
              </div>
            ))}
            {data.range.length > 3 && (
              <div className="text-[10px]" style={{ color: textSecondary }}>
                +{data.range.length - 3} more
              </div>
            )}
          </div>
        </>
      )}
    </CardChrome>
  );
}

export function KalshiSummary({ data }: { data: KalshiGroup }) {
  return (
    <CardChrome header={`Kalshi · ${data.upDown.length} strike${data.upDown.length === 1 ? '' : 's'} · ${data.range.length} range${data.range.length === 1 ? '' : 's'}`}>
      {data.question && (
        <div className="text-xs mb-2 truncate" style={{ color: textPrimary }} title={data.question}>
          {data.question}
        </div>
      )}
      {data.upDown.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: textSecondary }}>
            UP/DOWN
          </div>
          <div className="space-y-1 mb-2">
            {data.upDown.slice(0, 4).map((r, i) => (
              <div
                key={`kx-ud-${i}`}
                className="flex items-center justify-between text-xs font-mono"
              >
                <span className="truncate" style={{ color: textPrimary }}>
                  {r.description?.trim() || formatUsd(r.strikeUsd)}
                </span>
                <span style={{ color: green }}>{formatPct(r.impliedProbUp, 2)}</span>
              </div>
            ))}
            {data.upDown.length > 4 && (
              <div className="text-[10px]" style={{ color: textSecondary }}>
                +{data.upDown.length - 4} more
              </div>
            )}
          </div>
        </>
      )}
      {data.range.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: textSecondary }}>
            RANGE
          </div>
          <div className="space-y-1">
            {data.range.slice(0, 3).map((r, i) => (
              <div
                key={`kx-r-${i}`}
                className="flex items-center justify-between text-xs font-mono"
              >
                <span className="truncate" style={{ color: textPrimary }}>
                  {formatUsd(r.floorStrikeUsd)}–{formatUsd(r.capStrikeUsd)}
                  <span style={{ color: textSecondary }}> ±{r.rangeBandPct.toFixed(1)}%</span>
                </span>
                <span style={{ color: green }}>{formatPct(r.impliedProbUp, 2)}</span>
              </div>
            ))}
            {data.range.length > 3 && (
              <div className="text-[10px]" style={{ color: textSecondary }}>
                +{data.range.length - 3} more
              </div>
            )}
          </div>
        </>
      )}
    </CardChrome>
  );
}