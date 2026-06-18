'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMarkets } from '../../../hooks/useMarkets';
import { useMarket } from '../../../hooks/useMarket';
import { calculateStrikeProbabilities } from '../../../hooks/useSVI';
import { getCoinIcon } from '../../../lib/coinIcons';
import Countdown from '../../common/Countdown';
import GlassCard from '../../common/GlassCard';
import BinaryTradeModal from './BinaryTradeModal';
import RangeTradeModal from './RangeTradeModal';
import LeveragedBetModal from './LeveragedBetModal';
import { useSetCurrentMarket } from './CurrentMarketContext';
import { formatPct } from '@/lib/markets/format';
import {
  DISPLAY_TICK_USD,
  formatExpiryDate,
  formatPrice,
  generateStrikes,
  roundToTick,
  SIMPLE_RANGE_WIDTHS_USD,
} from './utils';

const green = '#00E68A';
const red = '#ef4444';
const cyan = '#3EC4C0';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

export default function PredictSimpleMode() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [modal, setModal] = useState<{
    open: boolean;
    strike: number;
    direction: 'up' | 'down';
  }>({ open: false, strike: 0, direction: 'up' });

  // Range mode — local to Simple. Range rows are always centered on the
  // spot (no trigger picker); picking a band opens RangeTradeModal with
  // those bounds. Binary keeps the existing UP/DOWN ladder.
  const [marketType, setMarketType] = useState<'binary' | 'range'>('binary');
  const [rangeModal, setRangeModal] = useState<{
    open: boolean;
    lower: number;
    upper: number;
    widthUsd: number;
  }>({ open: false, lower: 0, upper: 0, widthUsd: 0 });
  const [leveragedOpen, setLeveragedOpen] = useState(false);

  // Live markets list
  const { markets, loading: marketsLoading } = useMarkets(30_000);
  const activeMarkets = useMemo(
    () => (markets ?? []).filter((m) => m.status === 'active'),
    [markets]
  );

  // Clamp selectedIdx when list shrinks
  useEffect(() => {
    if (activeMarkets.length === 0) {
      setSelectedIdx(0);
    } else if (selectedIdx >= activeMarkets.length) {
      setSelectedIdx(0);
    }
  }, [activeMarkets.length, selectedIdx]);

  const currentMarket = activeMarkets[selectedIdx] ?? null;
  const currentOracleId = currentMarket?.oracle_id ?? null;

  const { market: marketDetail, loading: marketLoading } = useMarket(
    currentOracleId,
    30_000
  );

  // Publish current market to the popover/page context
  const setCurrentMarket = useSetCurrentMarket();
  useEffect(() => {
    setCurrentMarket({
      oracleId: currentMarket?.oracle_id ?? null,
      asset: currentMarket?.asset ?? null,
    });
  }, [currentMarket?.oracle_id, currentMarket?.asset, setCurrentMarket]);

  // Derived values
  const spotUsd = marketDetail ? marketDetail.spot / 1e9 : 0;
  const expiryMs =
    marketDetail?.expiryMs ?? currentMarket?.expiryMs ?? 0;
  const svi = marketDetail?.svi ?? null;
  const asset = currentMarket?.asset ?? 'BTC';

  const strikes = useMemo(
    () => (spotUsd > 0 ? generateStrikes(spotUsd, 5, DISPLAY_TICK_USD) : []),
    [spotUsd]
  );
  const centerStrike = spotUsd > 0 ? roundToTick(spotUsd, DISPLAY_TICK_USD) : 0;

  // Forward must be passed in RAW (scaled by 1e9) per useSVI contract
  const probs = useMemo(() => {
    if (!marketDetail || !spotUsd) return [];
    return calculateStrikeProbabilities(
      strikes,
      marketDetail.forward,
      expiryMs,
      svi ?? undefined
    );
  }, [marketDetail, strikes, expiryMs, svi, spotUsd]);

  // Range-mode odds: compute the implied probability that the final price
  // lands INSIDE each preset band. We reuse the same SVI distribution as
  // the binary ladder — insideProb(lo, hi) = downProb(hi) - downProb(lo).
  // Returns the band widths with their inside probabilities (0–1).
  const rangeOdds = useMemo(() => {
    if (!marketDetail || !centerStrike) {
      return SIMPLE_RANGE_WIDTHS_USD.map((w) => ({ width: w, insideProb: 0 }));
    }
    // 2 strikes per band (lo, hi). Guard lo > 0 to keep SVI happy.
    const boundaryStrikes: number[] = [];
    SIMPLE_RANGE_WIDTHS_USD.forEach((w) => {
      boundaryStrikes.push(Math.max(1, centerStrike - w));
      boundaryStrikes.push(centerStrike + w);
    });
    const boundaryProbs = calculateStrikeProbabilities(
      boundaryStrikes,
      marketDetail.forward,
      expiryMs,
      svi ?? undefined
    );
    return SIMPLE_RANGE_WIDTHS_USD.map((w, i) => {
      const loIdx = i * 2;
      const hiIdx = i * 2 + 1;
      const lo = boundaryProbs[loIdx]?.downProb ?? 0;
      const hi = boundaryProbs[hiIdx]?.downProb ?? 0;
      // downProb is 0–100; formatPct wants 0–1
      return { width: w, insideProb: Math.max(0, (hi - lo) / 100) };
    });
  }, [marketDetail, centerStrike, expiryMs, svi]);

  const go = (delta: number) => {
    if (activeMarkets.length < 2) return;
    setSelectedIdx((i) => (i + delta + activeMarkets.length) % activeMarkets.length);
  };

  // ─── Render branches ────────────────────────────────────────────────────

  if (marketsLoading && activeMarkets.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-sm" style={{ color: textSecondary }}>
          <Loader2 size={20} className="animate-spin" style={{ color: green }} />
          Loading markets…
        </div>
      </div>
    );
  }

  if (!currentMarket) {
    return (
      <div className="max-w-md mx-auto">
        <GlassCard>
          <div className="text-center py-8">
            <h2 className="text-lg font-bold mb-2" style={{ color: textPrimary }}>
              No active markets
            </h2>
            <p className="text-sm" style={{ color: textSecondary }}>
              Check back later — new markets open regularly.
            </p>
          </div>
        </GlassCard>
      </div>
    );
  }

  const showSkeleton = marketLoading && !marketDetail;
  const question = `Will ${asset} be above or below ${formatPrice(centerStrike)}?`;

  return (
    <div className="flex items-center justify-center gap-4">
      <button
        onClick={() => go(-1)}
        disabled={activeMarkets.length < 2}
        className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center transition-all hover:scale-105 disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ background: 'rgba(40, 44, 60, 0.5)' }}
        aria-label="Previous market"
      >
        <ChevronLeft size={18} style={{ color: textSecondary }} />
      </button>

      <div className="w-full max-w-md space-y-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentMarket.oracle_id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
          >
            <GlassCard>
              <div className="flex items-center justify-between mb-3 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Image
                    src={getCoinIcon(asset)}
                    alt={asset}
                    width={20}
                    height={20}
                    className="rounded-full shrink-0"
                  />
                  <span className="text-sm font-semibold" style={{ color: textPrimary }}>
                    {asset}
                  </span>
                  <span className="text-xs" style={{ color: textSecondary }}>
                    /USD
                  </span>
                </div>
                <span
                  className="text-xs px-2 py-1 rounded shrink-0 font-mono"
                  style={{ background: 'rgba(40, 44, 60, 0.5)', color: textSecondary }}
                >
                  <Countdown expiryMs={expiryMs} />
                </span>
              </div>

              <h2 className="text-base font-bold mb-3 leading-snug" style={{ color: textPrimary }}>
                {showSkeleton ? '…' : question}
              </h2>

              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: textSecondary }}>
                    Spot
                  </div>
                  <div className="text-2xl font-bold" style={{ color: green }}>
                    {showSkeleton ? '—' : formatPrice(spotUsd)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: textSecondary }}>
                    Expires
                  </div>
                  <div className="text-xs font-mono" style={{ color: textSecondary }}>
                    {showSkeleton ? '—' : formatExpiryDate(expiryMs)}
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </AnimatePresence>

        <div className="max-h-[450px] overflow-y-auto pr-1">
          {probs.length === 0 ? (
            <div
              className="text-center text-xs py-8"
              style={{ color: textSecondary }}
            >
              {marketLoading ? 'Loading odds…' : 'Awaiting oracle data…'}
            </div>
          ) : marketType === 'binary' ? (
            probs.map((p, i) => {
              const isCenter = strikes[i] === centerStrike;
              return (
                <div
                  key={strikes[i]}
                  className="w-full flex items-center justify-between rounded-xl px-3 py-2 mb-1 transition-all"
                  style={{
                    background: isCenter ? 'rgba(0, 230, 138, 0.06)' : 'transparent',
                  }}
                >
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className="text-base font-semibold"
                      style={{ color: isCenter ? green : textPrimary }}
                    >
                      {formatPrice(strikes[i])}
                    </span>
                    {isCenter && (
                      <span className="text-[10px]" style={{ color: textSecondary }}>
                        ATM
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setModal({ open: true, strike: strikes[i], direction: 'up' });
                      }}
                      className="relative rounded-2xl px-4 py-2.5 overflow-hidden border border-white/10"
                      style={{ background: 'rgba(26, 29, 46, 0.6)', backdropFilter: 'blur(20px)' }}
                    >
                      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent" />
                      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                      <div
                        className="absolute -top-4 -right-4 w-12 h-12 rounded-full"
                        style={{ background: green, filter: 'blur(30px)', opacity: 0.15 }}
                      />
                      <span
                        className="relative z-10 text-sm font-semibold"
                        style={{ color: green }}
                      >
                        ▲ UP {(p.upProb / 100).toFixed(2)}
                      </span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setModal({ open: true, strike: strikes[i], direction: 'down' });
                      }}
                      className="relative rounded-2xl px-4 py-2.5 overflow-hidden border border-white/10"
                      style={{ background: 'rgba(26, 29, 46, 0.6)', backdropFilter: 'blur(20px)' }}
                    >
                      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent" />
                      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                      <div
                        className="absolute -top-4 -right-4 w-12 h-12 rounded-full"
                        style={{ background: red, filter: 'blur(30px)', opacity: 0.15 }}
                      />
                      <span
                        className="relative z-10 text-sm font-semibold"
                        style={{ color: red }}
                      >
                        ▼ DOWN {(p.downProb / 100).toFixed(2)}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            // Range mode: 3 preset bands centered on the spot, each with
            // an IN button that opens RangeTradeModal directly. Matches
            // the RangeCard row layout (label + action button).
            SIMPLE_RANGE_WIDTHS_USD.map((w, i) => {
              const center = centerStrike > 0 ? centerStrike : Math.round(spotUsd);
              const lo = Math.max(0, center - w);
              const hi = center + w;
              const canTrade = center > 0 && lo > 0;
              const insideProb = rangeOdds[i]?.insideProb ?? 0;
              return (
                <div
                  key={w}
                  className="w-full flex items-center justify-between rounded-xl px-3 py-2 mb-1"
                >
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <span
                      className="text-base font-semibold truncate"
                      style={{ color: textPrimary }}
                    >
                      {formatPrice(lo)} – {formatPrice(hi)}
                    </span>
                    <span className="text-[10px] shrink-0" style={{ color: textSecondary }}>
                      ±${w.toLocaleString('en-US')}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={!canTrade}
                    onClick={() =>
                      setRangeModal({ open: true, lower: lo, upper: hi, widthUsd: w })
                    }
                    className="relative rounded-2xl px-3 py-2 overflow-hidden border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed min-w-[5.5rem]"
                    style={{ background: 'rgba(26, 29, 46, 0.6)', backdropFilter: 'blur(20px)' }}
                  >
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
                    <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
                    <div
                      className="absolute -top-4 -right-4 w-12 h-12 rounded-full pointer-events-none"
                      style={{ background: green, filter: 'blur(30px)', opacity: 0.15 }}
                    />
                    <span
                      className="relative z-10 text-sm font-semibold inline-flex items-center gap-1.5"
                      style={{ color: green }}
                    >
                      <Check size={14} strokeWidth={3} />
                      {formatPct(insideProb, 2)}
                    </span>
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Binary / Range segmented toggle — anchored at the bottom of
            the card so the user finishes choosing their position before
            deciding to flip modes. */}
        <div
          className="inline-flex items-center rounded-lg p-0.5 gap-0.5 mx-auto"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {(['binary', 'range'] as const).map((id) => {
            const isActive = marketType === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMarketType(id)}
                className="px-4 py-1.5 rounded-md text-xs font-semibold transition-colors"
                style={{
                  background: isActive ? green : 'transparent',
                  color: isActive ? '#000' : textSecondary,
                }}
              >
                {id === 'binary' ? 'Binary' : 'Range'}
              </button>
            );
          })}
        </div>

        {/* Leveraged Bet — opens the same LeveragedBetModal as Advanced mode
            using the currently displayed market + selected mode/strike. */}
        <button
          type="button"
          onClick={() => setLeveragedOpen(true)}
          className="mx-auto mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors"
          style={{
            background: 'rgba(62, 196, 192, 0.12)',
            color: cyan,
            border: '1px solid rgba(62, 196, 192, 0.35)',
          }}
          title="Open a leveraged bet on the current market (borrow DBUSDC from a Margin Manager)"
        >
          ⚡ Leveraged Bet
        </button>

        <div className="text-center text-xs" style={{ color: textSecondary }}>
          {selectedIdx + 1} / {activeMarkets.length}
        </div>
      </div>

      <button
        onClick={() => go(1)}
        disabled={activeMarkets.length < 2}
        className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center transition-all hover:scale-105 disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ background: 'rgba(40, 44, 60, 0.5)' }}
        aria-label="Next market"
      >
        <ChevronRight size={18} style={{ color: textSecondary }} />
      </button>

      {currentMarket && marketType === 'binary' && (
        <BinaryTradeModal
          open={modal.open}
          onClose={() => setModal((m) => ({ ...m, open: false }))}
          market={{
            oracleId: currentMarket.oracle_id,
            asset,
            expiryMs,
            spotUsd,
          }}
          strike={modal.strike}
          initialDirection={modal.direction}
        />
      )}

      {currentMarket && marketType === 'range' && rangeModal.lower > 0 && rangeModal.upper > rangeModal.lower && (
        <RangeTradeModal
          open={rangeModal.open}
          onClose={() => setRangeModal((m) => ({ ...m, open: false }))}
          market={{
            oracleId: currentMarket.oracle_id,
            asset,
            expiryMs,
            spotUsd,
          }}
          lower={rangeModal.lower}
          upper={rangeModal.upper}
          triggerStrike={centerStrike}
          widthUsd={rangeModal.widthUsd}
        />
      )}

      {currentMarket && leveragedOpen && (
        <LeveragedBetModal
          oracleId={currentMarket.oracle_id}
          expiryMs={expiryMs}
          spotUsd={spotUsd}
          mode={marketType}
          strike={marketType === 'binary' ? spotUsd : undefined}
          lower={
            marketType === 'range' && rangeModal.lower > 0
              ? rangeModal.lower
              : spotUsd > 0
                ? spotUsd * 0.99
                : undefined
          }
          higher={
            marketType === 'range' && rangeModal.upper > 0
              ? rangeModal.upper
              : spotUsd > 0
                ? spotUsd * 1.01
                : undefined
          }
          onClose={() => setLeveragedOpen(false)}
        />
      )}
    </div>
  );
}
