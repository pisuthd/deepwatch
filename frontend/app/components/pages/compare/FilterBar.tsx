'use client';

/**
 * FilterBar — top-bar filters for the Compare page.
 *
 *   - Asset selector (BTC-only in v1; rendered as a GlassDropdown so
 *     adding more assets later is a 1-line options change).
 *   - Horizon chip group (1d / 3d / 7d / All) with per-horizon match
 *     counts computed from the full un-filtered `matches` list, so
 *     the chip badges stay stable as the user clicks around.
 *   - Sort selector (Expiry asc / Spread desc / Question).
 *
 * The horizon chip pattern is the same as the old MarketPicker — kept
 * inline rather than extracted into a new primitive because only this
 * page uses it.
 */

import GlassDropdown from '../../common/GlassDropdown';
import type { DeepBookMatch } from '@/app/lib/match';
import { getCoinIcon } from '@/app/lib/coinIcons';

const green = '#00E68A';
const textSecondary = '#9ca3af';

export type Horizon = '1d' | '3d' | '7d' | 'all';
export type SortKey = 'expiry' | 'spread' | 'question';

export const HORIZONS: { id: Horizon; label: string; days: number | null }[] = [
  { id: '1d', label: '1d', days: 1 },
  { id: '3d', label: '3d', days: 3 },
  { id: '7d', label: '7d', days: 7 },
  { id: 'all', label: 'All', days: null },
];

export const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'expiry', label: 'Expiry (soonest)' },
  { id: 'spread', label: 'Spread (largest)' },
  { id: 'question', label: 'Question (A→Z)' },
];

// Asset icon URLs come from the shared coin icon helper so the
// asset picker stays in sync with the rest of the app (and the
// CoinMarketCap icon endpoint, which is the only one we know works
// for Sui mainnet assets).
const ASSET_OPTIONS = [
  { value: 'BTC', label: 'BTC', icon: getCoinIcon('BTC') },
];

interface FilterBarProps {
  asset: string;
  onAssetChange: (next: string) => void;
  horizon: Horizon;
  onHorizonChange: (next: Horizon) => void;
  sort: SortKey;
  onSortChange: (next: SortKey) => void;
  /** Full un-filtered list — used to compute per-horizon counts. */
  allMatches: DeepBookMatch[];
  /**
   * Current BTC spot (USD). Used to render the "Spot price" indicator
   * at the top of the page. `null` while the markets feed is still
   * loading. Picked from the first DeepBook group's `spotUsd` —
   * DeepBook's SVI surface tracks spot closely across the ladder.
   */
  spotUsd: number | null;
}

function inHorizon(expiryMs: number, days: number | null, now: number): boolean {
  if (days === null) return true;
  const cutoff = days * 24 * 60 * 60 * 1000;
  return expiryMs - now <= cutoff;
}

export default function FilterBar({
  asset,
  onAssetChange,
  horizon,
  onHorizonChange,
  sort,
  onSortChange,
  allMatches,
  spotUsd,
}: FilterBarProps) {
  const now = Date.now();

  const horizonCounts = HORIZONS.reduce<Record<Horizon, number>>(
    (acc, h) => {
      acc[h.id] = allMatches.filter((m) => inHorizon(m.expiryMs, h.days, now)).length;
      return acc;
    },
    { '1d': 0, '3d': 0, '7d': 0, all: 0 },
  );

  return (
    <div
      className="relative z-50 rounded-2xl border border-white/10 p-3 flex items-center justify-between gap-3 flex-wrap"
      style={{ background: 'rgba(26, 29, 46, 0.6)', backdropFilter: 'blur(20px)' }}
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

      <div className="relative z-10 flex items-center gap-2 flex-wrap min-w-0">
        {/* Asset selector — narrow column */}
        <div className="w-32 shrink-0">
          <GlassDropdown
            options={ASSET_OPTIONS}
            value={asset}
            onChange={onAssetChange}
            showValue={false}
            placeholder="Asset"
          />
        </div>

        {/* Spot price indicator — shows the current DeepBook spot so the
            user has the ATM baseline visible at the top of the page.
            Hidden while the markets feed is still loading. */}
        {spotUsd != null && spotUsd > 0 && (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/10"
            style={{
              background: 'rgba(255,255,255,0.04)',
            }}
            title="Current BTC spot price (DeepBook oracle baseline)."
          >
            <span
              className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: textSecondary }}
            >
              Spot
            </span>
            <span
              className="font-mono font-bold"
              style={{ color: '#ffffff', fontSize: 12 }}
            >
              ${spotUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </span>
          </div>
        )}
        {/* Horizon chips */}
        <div
          className="inline-flex items-center rounded-lg p-0.5 gap-0.5"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {HORIZONS.map((h) => {
            const isActive = horizon === h.id;
            const isEmpty = horizonCounts[h.id] === 0;
            return (
              <button
                key={h.id}
                type="button"
                onClick={() => onHorizonChange(h.id)}
                className="px-3 py-1 rounded-md text-[11px] font-semibold transition-colors inline-flex items-center gap-1.5"
                style={{
                  background: isActive ? green : 'transparent',
                  color: isActive ? '#000' : isEmpty ? 'rgba(156,163,175,0.4)' : textSecondary,
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
      </div>

      {/* Sort selector — narrow column on the right */}
      <div className="relative z-10 w-56 shrink-0">
        <GlassDropdown
          options={SORT_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
          value={sort}
          onChange={(v) => onSortChange(v as SortKey)}
          showValue={false}
          placeholder="Sort"
        />
      </div>
    </div>
  );
}

// ─── helpers used by ComparePageClient to apply the bar's filters ────

export function applyHorizon(
  matches: DeepBookMatch[],
  horizon: Horizon,
  now: number = Date.now(),
): DeepBookMatch[] {
  const days = HORIZONS.find((h) => h.id === horizon)?.days ?? null;
  return matches.filter((m) => inHorizon(m.expiryMs, days, now));
}

export function applySort(matches: DeepBookMatch[], sort: SortKey): DeepBookMatch[] {
  const copy = [...matches];
  switch (sort) {
    case 'expiry':
      copy.sort((a, b) => a.expiryMs - b.expiryMs);
      break;
    case 'spread':
      copy.sort((a, b) => (b.spread ?? -1) - (a.spread ?? -1));
      break;
    case 'question':
      copy.sort((a, b) => a.question.localeCompare(b.question));
      break;
  }
  return copy;
}