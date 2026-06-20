'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUp, ChevronDown, Globe } from 'lucide-react';
import StatCard from '../common/StatCard';
import WelcomeCard from '../common/WelcomeCard';
import PageWrapper from '../common/PageWrapper';
import PredictManagerPanel from './overview/PredictManagerPanel';
import PositionsPanel from './overview/PositionsPanel';
import RecentBatchesPanel from './overview/RecentBatchesPanel';

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const textMuted = '#6b7280';
const green = '#00E68A';

export default function OverviewPage() {
  return (
    <PageWrapper title="Overview">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <WelcomeCard />
        <StatCard
          title="Live on"
          value="Sui"
          subtitle="Mainnet + Testnet"
          icon={Globe}
          accentColor="blue"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PredictManagerPanel />

        {/* Example AI insight — static mock modeled on
            MatchInsightPopover. Positive case (Bet UP, 80% confidence)
            so users can see the "happy path" without running their
            own analysis. The full RecentBatchesPanel below shows
            real data. */}
        <div
          className="relative overflow-hidden rounded-2xl p-6 border border-white/10"
          style={{
            background: 'rgba(26, 29, 46, 0.6)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

          <div className="relative z-10">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-lg font-bold" style={{ color: textPrimary }}>
                AI Insight
              </h3>
              <Link
                href="/app/add-insight"
                className="text-[11px] font-mono font-semibold inline-flex items-center gap-1"
                style={{ color: green }}
              >
                Run your own →
              </Link>
            </div> 

            <ExampleInsight />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <PositionsPanel />
      </div>

      <div className="mt-6">
        <RecentBatchesPanel />
      </div>
    </PageWrapper>
  );
}

/**
 * Static "happy path" AI insight — what a UP / 80% confidence call
 * looks like once decrypted. Mirrors `MatchInsightPopover`'s layout
 * (direction → suggested position → blurb → confidence → collapsible
 * details with Prediction Market Comparison + CoinMarketCap API).
 *
 * No data dependency: pure mock so the Overview page renders even
 * with no batches yet. Real data lives in the full
 * `RecentBatchesPanel` below.
 */
function ExampleInsight() {
  const [showDetails, setShowDetails] = useState(true);

  const pct = 80;

  return (
    <div className="mt-4 space-y-2.5">
      {/* Direction — large, bold, green for UP */}
      <div
        className="font-bold flex items-center gap-2"
        style={{ color: green, fontSize: 16 }}
      >
        <ArrowUp size={16} />
        Bet UP
      </div>

      {/* Suggested Position */}
      <div className="space-y-0.5">
        <div
          className="text-[9px] uppercase tracking-wider font-semibold"
          style={{ color: textSecondary }}
        >
          Suggested Position
        </div>
        <div
          className="font-mono"
          style={{ color: textPrimary, fontSize: 12 }}
        >
          3% of your trading budget
        </div>
      </div>

      {/* Plain-language blurb */}
      <p
        className="text-[11px] leading-relaxed"
        style={{ color: textSecondary }}
      >
        Win if the price finishes above the strike. DB 52% vs consensus
        48% — DB undervalues UP, BUY_UP edge.
      </p>

      {/* Confidence bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span
            className="text-[10px] uppercase tracking-wider font-semibold"
            style={{ color: textSecondary }}
          >
            Confidence
          </span>
          <span
            className="font-mono font-semibold"
            style={{ color: textPrimary, fontSize: 11 }}
            title="How sure the AI is in this call"
          >
            {pct}% <span style={{ color: green }}>· solid</span>
          </span>
        </div>
        <div
          className="h-1.5 rounded-full overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.06)' }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Confidence ${pct}%`}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: green,
              transition: 'width 0.2s ease',
            }}
          />
        </div>
      </div>

      {/* Collapsible details */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold transition-colors hover:opacity-80"
          style={{ color: green }}
          aria-expanded={showDetails}
        >
          <ChevronDown
            size={11}
            style={{
              transition: 'transform 0.15s',
              transform: showDetails ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
          {showDetails ? 'Hide details' : 'Show details'}
        </button>

        {showDetails && (
          <div className="mt-2 space-y-2 pt-2 border-t border-white/5">
            <div>
              <div
                className="text-[9px] uppercase tracking-wider font-semibold mb-1"
                style={{ color: textSecondary }}
              >
                Prediction Market Comparison
              </div>
              <div
                className="text-[11px] leading-relaxed"
                style={{ color: textPrimary }}
              >
                DB 52% vs consensus 48% — DB undervalues UP, BUY_UP edge.
              </div>
              <div
                className="mt-1 text-[10px]"
                style={{ color: textSecondary }}
              >
                Compared with Kalshi & Polymarket prices
              </div>
            </div>
            <div
              className="text-[10px] leading-relaxed italic"
              style={{ color: green, opacity: 0.9 }}
              title="CoinMarketCap backdrop — affects position size, NOT direction"
            >
              <div
                className="text-[9px] uppercase tracking-wider font-semibold mb-1 not-italic"
                style={{ color: textSecondary }}
              >
                CoinMarketCap API
              </div>
              📊 Fear 24, DeFi/derivatives +12/+18% — mild fear rebound,
              supports UP
              <div
                className="mt-1 not-italic text-[9px]"
                style={{ color: textSecondary }}
              >
                Fear & Greed index · sector sentiment · 24h macro trend
              </div>
            </div>
          </div>
        )}
      </div>

      <p
        className="pt-2 mt-1 border-t border-white/5 text-[10px] font-mono"
        style={{ color: textMuted }}
      >
        This is an example · Last analysed: 1h ago
      </p>
    </div>
  );
}
