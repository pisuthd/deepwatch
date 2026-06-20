'use client';

/**
 * VaultStats — read-only header for the /app/stake page.
 *
 * # Sources
 *
 * One source today: the Predict indexer's
 * `GET /predicts/:predict_id/vault/summary` endpoint, surfaced via
 * `useMarkets().vault` (30 s poll). The endpoint returns 13 numeric
 * fields; we group them into 3 thematic cards so the header reads
 * as a snapshot, not a list of raw numbers.
 *
 * # Layout (3 cards)
 *
 *   1. **Vault** — capital & liquidity headline.
 *      `vault_value` (headline) + `available_liquidity`,
 *      `vault_balance`, `utilization`.
 *   2. **PLP Token** — the LP share token.
 *      `plp_share_price` (headline) + `plp_total_supply`,
 *      `net_deposits`.
 *   3. **Risk & Flows** — what could go wrong + cumulative activity.
 *      `max_payout_utilization` (headline) + `total_mtm`,
 *      `total_supplied`, `total_withdrawn`.
 *
 * The previous DeepWatch second-layer pool card is intentionally
 * dropped from the header — the pool is not deployed yet and a
 * "Pool not deployed" card was visual noise. The pool's stats will
 * reappear inline inside `PoolStakePanel` once `packageId` /
 * `poolObjectId` go non-null in `networkConfig.ts`.
 *
 * # Number formatting
 *
 * The Predict indexer reports every USD-denominated field
 * (vault_value, vault_balance, available_liquidity, total_mtm,
 * total_max_payout, total_supplied, total_withdrawn, net_deposits,
 * plp_total_supply) in **raw 6-decimal DUSDC units** — i.e. the
 * `Balance<T>.value()` of the on-chain Balance object. Display
 * helpers therefore divide by `DUSDC_SCALE = 1_000_000` before
 * formatting, so `1_016_299_409_110` renders as `$1.02M`, not
 * `$1.02T`.
 *
 * Ratios (`plp_share_price`, `utilization`, `max_payout_utilization`)
 * are already in human form and skip the scale conversion.
 *
 * `fmtUsd` collapses to K/M/B once the value passes $1M so the
 * cards stay readable at all pool sizes. Utilization ratios are
 * shown as percentages with 2 decimals.
 */

import { Wallet, Coins, Activity } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMarkets } from '../../../hooks/useMarkets';

/** 6-decimal scale for DUSDC and PLP — matches `usePredict.ts::DUSDC_SCALE`. */
const DUSDC_SCALE = 1_000_000;

/**
 * Format a raw 6-decimal DUSDC value as a human-readable USD string.
 * `null`/`undefined` render as "—".
 */
function fmtUsd(raw: number | null | undefined): string {
  if (raw == null) return '—';
  const human = raw / DUSDC_SCALE;
  if (human >= 1e9) return `$${(human / 1e9).toFixed(2)}B`;
  if (human >= 1e6) return `$${(human / 1e6).toFixed(2)}M`;
  if (human >= 1e3) return `$${(human / 1e3).toFixed(1)}K`;
  return `$${human.toFixed(2)}`;
}

/** Format a 0…1 ratio as a percentage with `decimals` decimal places. */
function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  return `${(n * 100).toFixed(decimals)}%`;
}

/** Format a unitless ratio (e.g. PLP share price ≈ 1.0…) as USD with 4 dp. */
function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${n.toFixed(4)}`;
}

interface MetricRowProps {
  label: string;
  value: string;
  /** Optional tone for the value (e.g. red when utilization is hot). */
  tone?: 'default' | 'green' | 'red' | 'amber';
}

function MetricRow({ label, value, tone = 'default' }: MetricRowProps) {
  const toneClass =
    tone === 'green'
      ? 'text-emerald-400'
      : tone === 'red'
        ? 'text-red-400'
        : tone === 'amber'
          ? 'text-amber-400'
          : 'text-white';
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="text-[11px] uppercase tracking-wide text-white/50">
        {label}
      </span>
      <span className={`text-sm font-mono font-semibold ${toneClass}`}>
        {value}
      </span>
    </div>
  );
}

interface VaultCardProps {
  title: string;
  icon: LucideIcon;
  accent: 'green' | 'blue' | 'purple' | 'amber';
  headlineLabel: string;
  headlineValue: string;
  metrics: MetricRowProps[];
}

function VaultCard({
  title,
  icon: Icon,
  accent,
  headlineLabel,
  headlineValue,
  metrics,
}: VaultCardProps) {
  const accentBg: Record<VaultCardProps['accent'], string> = {
    green: 'bg-emerald-500/20 text-emerald-400',
    blue: 'bg-blue-500/20 text-blue-400',
    purple: 'bg-purple-500/20 text-purple-400',
    amber: 'bg-amber-500/20 text-amber-400',
  };
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/10 p-5"
      style={{ background: 'rgba(26, 29, 46, 0.6)', backdropFilter: 'blur(20px)' }}
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      <div className="flex items-center justify-between mb-3 relative z-10">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${accentBg[accent]}`}>
            <Icon size={16} />
          </div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
      </div>

      <div className="mb-3 relative z-10">
        <p className="text-[10px] uppercase tracking-wide text-white/50">
          {headlineLabel}
        </p>
        <p className="text-2xl font-mono font-bold text-white mt-0.5">
          {headlineValue}
        </p>
      </div>

      <div className="border-t border-white/5 pt-2 relative z-10">
        {metrics.map((m) => (
          <MetricRow key={m.label} {...m} />
        ))}
      </div>
    </div>
  );
}

/**
 * Tone the utilization / max-payout-utilization numbers. Anything
 * above 80% is a red flag (no headroom for new positions); 50-80%
 * is amber (getting tight); below is the green zone.
 */
function utilizationTone(pct: number | null | undefined): 'green' | 'amber' | 'red' | 'default' {
  if (pct == null) return 'default';
  if (pct >= 0.8) return 'red';
  if (pct >= 0.5) return 'amber';
  return 'green';
}

export default function VaultStats() {
  const { vault } = useMarkets();

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* ─── Card 1: Vault — capital & liquidity ─────────────────── */}
      <VaultCard
        title="Vault"
        icon={Wallet}
        accent="blue"
        headlineLabel="Total value"
        headlineValue={fmtUsd(vault?.vault_value ?? null)}
        metrics={[
          {
            label: 'Available liquidity',
            value: fmtUsd(vault?.available_liquidity ?? null),
          },
          {
            label: 'On-chain balance',
            value: fmtUsd(vault?.vault_balance ?? null),
          },
          {
            label: 'Utilization',
            value: fmtPct(vault?.utilization),
            tone: utilizationTone(vault?.utilization),
          },
        ]}
      />

      {/* ─── Card 2: PLP Token — share token economics ────────────── */}
      <VaultCard
        title="PLP Token"
        icon={Coins}
        accent="green"
        headlineLabel="Share price"
        headlineValue={fmtPrice(vault?.plp_share_price ?? null)}
        metrics={[
          {
            label: 'Total supply',
            value: vault?.plp_total_supply != null
              ? fmtUsd(vault.plp_total_supply)
              : '—',
          },
          {
            label: 'Net deposits',
            value: fmtUsd(vault?.net_deposits ?? null),
          },
        ]}
      />

      {/* ─── Card 3: Risk & Flows — tail risk + cumulative activity ── */}
      <VaultCard
        title="Risk & Flows"
        icon={Activity}
        accent="amber"
        headlineLabel="Max payout utilization"
        headlineValue={fmtPct(vault?.max_payout_utilization)}
        metrics={[
          {
            label: 'Open exposure (MTM)',
            value: fmtUsd(vault?.total_mtm ?? null),
          },
          {
            label: 'Max payout',
            value: fmtUsd(vault?.total_max_payout ?? null),
          },
          {
            label: 'Supplied (cumulative)',
            value: fmtUsd(vault?.total_supplied ?? null),
          },
          {
            label: 'Withdrawn (cumulative)',
            value: fmtUsd(vault?.total_withdrawn ?? null),
          },
        ]}
      />
    </div>
  );
}
