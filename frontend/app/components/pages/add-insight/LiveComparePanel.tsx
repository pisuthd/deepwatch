'use client';

/**
 * LiveComparePanel — the 3-column cross-venue compare (DeepBook Predict,
 * Polymarket, Kalshi) used on the single-screen Add Insight page.
 *
 * Renders the same strike/band ladder across all three venues so the
 * user can read off the implied probability difference directly. The
 * DeepBook ladder is synthesized from the oracle's SVI surface via
 * `lib/markets/deepbook` (Black-76 + SVI). The Polymarket + Kalshi
 * ladders come straight from the matched groups; missing matches
 * render a `ComparePlaceholder` so the user can see why one venue
 * dropped out.
 *
 * The Up/Down ↔ Range segmented control at the top swaps which ladder
 * is shown — a single row of three cards is easier to scan than a
 * 3×2 grid of stacked pairs.
 */

import { useMemo, useState } from 'react';
import { formatExpiryLabel } from '../../../lib/insights';
import type { PolymarketGroup } from '@/lib/markets/polymarket';
import type { KalshiGroup } from '@/lib/markets/kalshi';
import type { Market as DbMarket } from '../../../hooks/useMarkets';
import { computeDeepBookLadder } from '@/lib/markets/deepbook';
import UpDownCard from '@/components/compare/UpDownCard';
import RangeCard from '@/components/compare/RangeCard';

interface LiveComparePanelProps {
  picked: {
    oracle: DbMarket;
    poly: PolymarketGroup | null;
    kalshi: KalshiGroup | null;
  } | null;
}

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const green = '#00E68A';

type LadderView = 'updown' | 'range';

const VIEW_OPTIONS: { id: LadderView; label: string }[] = [
  { id: 'updown', label: 'Up / Down' },
  { id: 'range', label: 'Range' },
];

export default function LiveComparePanel({ picked }: LiveComparePanelProps) {
  const selected = picked?.oracle ?? null;
  const poly = picked?.poly ?? null;
  const kalshi = picked?.kalshi ?? null;
  const [view, setView] = useState<LadderView>('updown');

  const dbLadder = useMemo(
    () => (selected ? computeDeepBookLadder(selected) : null),
    [selected],
  );

  if (!selected || !dbLadder) {
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>
            Live odds · {selected.asset}
          </h3>
          <span className="text-[10px] font-mono" style={{ color: textSecondary }}>
            {formatExpiryLabel(selected.expiryMs)}
          </span>
        </div>

        {/* Up/Down ↔ Range segmented control */}
        <div
          className="inline-flex items-center rounded-lg p-0.5 gap-0.5"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {VIEW_OPTIONS.map((opt) => {
            const isActive = view === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setView(opt.id)}
                className="px-3 py-1 rounded-md text-[11px] font-semibold transition-colors"
                style={{
                  background: isActive ? green : 'transparent',
                  color: isActive ? '#000' : textSecondary,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Column 1 — DeepBook Predict */}
        <div>
          {view === 'updown' ? (
            <UpDownCard
              asset={selected.asset}
              expiryMs={selected.expiryMs}
              spotUsd={dbLadder.spotUsd}
              forwardUsd={dbLadder.forwardUsd}
              rows={dbLadder.upDown}
              eyebrow={<VenueEyebrow color="accent" label="DeepBook Predict" />}
            />
          ) : (
            <RangeCard
              asset={selected.asset}
              expiryMs={selected.expiryMs}
              spotUsd={dbLadder.spotUsd}
              forwardUsd={dbLadder.forwardUsd}
              rows={dbLadder.range}
              eyebrow={<VenueEyebrow color="accent" label="DeepBook Predict" />}
            />
          )}
        </div>

        {/* Column 2 — Polymarket */}
        <div>
          {poly ? (
            view === 'updown' ? (
              <UpDownCard
                asset={selected.asset}
                expiryMs={poly.expiryMs}
                spotUsd={dbLadder.spotUsd}
                forwardUsd={dbLadder.forwardUsd}
                rows={poly.upDown}
                question={poly.question}
                eyebrow={<VenueEyebrow color="#3b82f6" label="Polymarket" />}
              />
            ) : poly.range.length > 0 ? (
              <RangeCard
                asset={selected.asset}
                expiryMs={poly.expiryMs}
                spotUsd={dbLadder.spotUsd}
                forwardUsd={dbLadder.forwardUsd}
                rows={poly.range}
                question={poly.question}
                eyebrow={<VenueEyebrow color="#3b82f6" label="Polymarket" />}
              />
            ) : (
              <ComparePlaceholder
                platform="Polymarket"
                asset={selected.asset}
                expiryMs={selected.expiryMs}
                kind="no-range"
              />
            )
          ) : (
            <ComparePlaceholder
              platform="Polymarket"
              asset={selected.asset}
              expiryMs={selected.expiryMs}
            />
          )}
        </div>

        {/* Column 3 — Kalshi */}
        <div>
          {kalshi ? (
            view === 'updown' ? (
              <UpDownCard
                asset={selected.asset}
                expiryMs={kalshi.expiryMs}
                spotUsd={dbLadder.spotUsd}
                forwardUsd={dbLadder.forwardUsd}
                rows={kalshi.upDown}
                question={kalshi.question}
                eyebrow={<VenueEyebrow color="#a855f7" label="Kalshi" />}
              />
            ) : kalshi.range.length > 0 ? (
              <RangeCard
                asset={selected.asset}
                expiryMs={kalshi.expiryMs}
                spotUsd={dbLadder.spotUsd}
                forwardUsd={dbLadder.forwardUsd}
                rows={kalshi.range}
                question={kalshi.question}
                eyebrow={<VenueEyebrow color="#a855f7" label="Kalshi" />}
              />
            ) : (
              <ComparePlaceholder
                platform="Kalshi"
                asset={selected.asset}
                expiryMs={selected.expiryMs}
                kind="no-range"
              />
            )
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

function VenueEyebrow({ color, label }: { color: string; label: string }) {
  return (
    <div
      className="text-[10px] font-semibold uppercase tracking-wider"
      style={color === 'accent' ? { color: 'var(--color-accent-primary)' } : { color }}
    >
      {label}
    </div>
  );
}

function ComparePlaceholder({
  platform,
  asset,
  expiryMs,
  kind = 'no-match',
}: {
  platform: string;
  asset: string;
  expiryMs: number;
  kind?: 'no-match' | 'no-range';
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
        {kind === 'no-range'
          ? `No range markets on ${platform} at this expiry.`
          : `No ${platform} market within 1 hour of this expiry.`}
      </div>
      <div className="text-[10px] font-mono mt-2" style={{ color: textSecondary }}>
        {asset} · {formatExpiryLabel(expiryMs)}
      </div>
    </div>
  );
}
