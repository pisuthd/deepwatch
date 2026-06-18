'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Loader2,
} from 'lucide-react';
import { useMarkets } from '../../../hooks/useMarkets';
import { useMarket } from '../../../hooks/useMarket';
import { calculateMintPrice } from '../../../hooks/useSVI';
import { getCoinIcon } from '../../../lib/coinIcons';
import Countdown from '../../common/Countdown';
import GlassCard from '../../common/GlassCard';
import BinaryTradeModal from './BinaryTradeModal';
import RangeTradeModal from './RangeTradeModal';
import PriceChart from './PriceChart';
import StrikeGrid from './StrikeGrid';
import { useSetCurrentMarket } from './CurrentMarketContext';
import {
  formatExpiryDate,
  formatPrice,
} from './utils';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const cyan = '#3EC4C0';

export default function PredictAdvancedMode() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [strike, setStrike] = useState(0);
  const [modal, setModal] = useState<{
    open: boolean;
    strike: number;
    direction: 'up' | 'down';
  }>({ open: false, strike: 0, direction: 'up' });
  const [showMarketDropdown, setShowMarketDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Range mode — local to Advanced. Defaults to `forward ± $1,000` per
  // market. The chart's two drag handles drive `lower`/`upper` directly.
  const [marketType, setMarketType] = useState<'binary' | 'range'>('binary');
  const [lower, setLower] = useState(0);
  const [upper, setUpper] = useState(0);
  const [triggerStrike, setTriggerStrike] = useState(0);
  const [rangeModalOpen, setRangeModalOpen] = useState(false);

  const { markets, loading: marketsLoading } = useMarkets(30_000);
  const activeMarkets = useMemo(
    () => (markets ?? []).filter((m) => m.status === 'active'),
    [markets]
  );

  useEffect(() => {
    if (activeMarkets.length === 0) {
      setSelectedIdx(0);
    } else if (selectedIdx >= activeMarkets.length) {
      setSelectedIdx(0);
    }
  }, [activeMarkets.length, selectedIdx]);

  const currentMarket = activeMarkets[selectedIdx] ?? null;
  const currentOracleId = currentMarket?.oracle_id ?? null;
  const { market, loading: marketLoading } = useMarket(currentOracleId, 30_000);

  // Publish current market to the popover/page context
  const setCurrentMarket = useSetCurrentMarket();
  useEffect(() => {
    setCurrentMarket({
      oracleId: currentMarket?.oracle_id ?? null,
      asset: currentMarket?.asset ?? null,
    });
  }, [currentMarket?.oracle_id, currentMarket?.asset, setCurrentMarket]);

  // Close market dropdown on outside click
  useEffect(() => {
    if (!showMarketDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowMarketDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMarketDropdown]);

  const spotUsd = market ? market.spot / 1e9 : 0;
  const expiryMs = market?.expiryMs ?? currentMarket?.expiryMs ?? 0;
  const svi = market?.svi ?? null;
  const asset = currentMarket?.asset ?? 'BTC';

  // Reset strike when market switches — rounded to 2dp, not snapped to tick.
  // We wait until spotUsd is available (not just oracle_id change), otherwise
  // the strike would be set to 0 on first load because useMarket resolves
  // after the oracle_id is first known.
  const strikeInitRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentMarket) {
      strikeInitRef.current = null;
      setStrike(0);
      return;
    }
    if (strikeInitRef.current === currentMarket.oracle_id) return;
    if (spotUsd > 0) {
      strikeInitRef.current = currentMarket.oracle_id;
      setStrike(parseFloat(spotUsd.toFixed(2)));
    } else {
      // Defer until spot resolves
      strikeInitRef.current = null;
      setStrike(0);
    }
  }, [currentMarket?.oracle_id, spotUsd]);

  // Default range bounds when entering range mode for the first time per
  // market: spot ± $250 (total width $500). Tight enough that both lines
  // visibly hug the current price on first render — the user can drag
  // wider from there.
  const rangeInitRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentMarket || marketType !== 'range') return;
    if (rangeInitRef.current === currentMarket.oracle_id) return;
    if (spotUsd <= 0) return;
    rangeInitRef.current = currentMarket.oracle_id;
    setLower(parseFloat((spotUsd - 250).toFixed(2)));
    setUpper(parseFloat((spotUsd + 250).toFixed(2)));
    setTriggerStrike(parseFloat(spotUsd.toFixed(2)));
  }, [currentMarket?.oracle_id, marketType, spotUsd]);

  // Live SVI probability for the currently-dragged strike (forward is RAW)
  const liveMint = useMemo(() => {
    if (!market || !spotUsd || !strike) return { up: 50, down: 50 };
    return calculateMintPrice(strike, market.forward, expiryMs, svi ?? undefined);
  }, [market, spotUsd, strike, expiryMs, svi]);

  const go = (delta: number) => {
    if (activeMarkets.length < 2) return;
    setSelectedIdx(
      (i) => (i + delta + activeMarkets.length) % activeMarkets.length
    );
    setShowMarketDropdown(false);
  };

  // ─── Render branches ────────────────────────────────────────────────────

  if (marketsLoading && activeMarkets.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div
          className="flex items-center gap-3 text-sm"
          style={{ color: textSecondary }}
        >
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
            <h2
              className="text-lg font-bold mb-2"
              style={{ color: textPrimary }}
            >
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

  const showSkeleton = marketLoading && !market;
  const question =
    marketType === 'range' && lower > 0 && upper > 0
      ? `Will ${asset} settle between ${formatPrice(lower)} and ${formatPrice(upper)}?`
      : `Will ${asset} be above or below ${formatPrice(spotUsd)}?`;

  return (
    <div
      className="flex flex-col gap-3 min-h-0"
      style={{ height: 'calc(100vh - 7rem)' }}
    >
      {/* ── Title ─────────────────────────────────────────────────────── */}
      <h1
        className="text-xl md:text-2xl font-bold leading-tight flex items-baseline gap-2 flex-wrap"
        style={{ color: textPrimary }}
      >
        <span>{showSkeleton ? '…' : question}</span>
        {!showSkeleton && expiryMs > 0 && (
          <span
            className="text-sm md:text-base font-mono font-normal"
            style={{ color: textSecondary }}
          >
            · <Countdown expiryMs={expiryMs} />
          </span>
        )}
      </h1>

      {/* ── Sub-row: market info + dropdown to switch + market carousel ── */}
      <div className="flex items-center gap-3 md:gap-4 flex-wrap">
        {/* Asset badge */}
        <div className="flex items-center gap-1.5">
          <Image
            src={getCoinIcon(asset)}
            alt={asset}
            width={18}
            height={18}
            className="rounded-full shrink-0"
          />
          <span
            className="text-sm font-semibold"
            style={{ color: textPrimary }}
          >
            {asset}
          </span>
          <span className="text-xs" style={{ color: textSecondary }}>
            /USD
          </span>
        </div>

        {/* Spot */}
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-[10px] uppercase tracking-wide"
            style={{ color: textSecondary }}
          >
            Spot
          </span>
          <span
            className="text-sm font-mono font-semibold"
            style={{ color: green }}
          >
            {showSkeleton ? '—' : formatPrice(spotUsd)}
          </span>
        </div>

        {/* Expiry with dropdown to switch markets */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowMarketDropdown((v) => !v)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors hover:bg-white/5"
            style={{
              background: 'rgba(40, 44, 60, 0.5)',
              color: textPrimary,
            }}
            aria-label="Switch market"
          >
            <span style={{ color: textSecondary }}>Expires</span>
            <span className="font-mono">{formatExpiryDate(expiryMs)}</span>
            <ChevronDown
              size={12}
              style={{
                color: textSecondary,
                transform: showMarketDropdown
                  ? 'rotate(180deg)'
                  : 'rotate(0deg)',
                transition: 'transform 150ms',
              }}
            />
          </button>

          {showMarketDropdown && (
            <div
              className="absolute top-full mt-2 left-0 z-30 w-72 max-h-80 overflow-y-auto rounded-xl border border-white/10 p-1.5"
              style={{
                background: 'rgba(26, 29, 46, 0.95)',
                backdropFilter: 'blur(20px)',
              }}
            >
              {activeMarkets.length === 0 ? (
                <div
                  className="text-xs text-center py-3"
                  style={{ color: textSecondary }}
                >
                  No active markets
                </div>
              ) : (
                activeMarkets.map((m, i) => {
                  const isActive = i === selectedIdx;
                  return (
                    <button
                      key={m.oracle_id}
                      onClick={() => {
                        setSelectedIdx(i);
                        setShowMarketDropdown(false);
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2 transition-colors hover:bg-white/5"
                      style={{
                        background: isActive
                          ? 'rgba(0, 230, 138, 0.08)'
                          : 'transparent',
                      }}
                    >
                      <Image
                        src={getCoinIcon(m.asset)}
                        alt={m.asset}
                        width={18}
                        height={18}
                        className="rounded-full shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div
                          className="text-sm font-semibold"
                          style={{ color: textPrimary }}
                        >
                          {m.asset}/USD
                        </div>
                        <div
                          className="text-[10px] font-mono flex items-center gap-1.5"
                          style={{ color: textSecondary }}
                        >
                          <span>{formatExpiryDate(m.expiryMs)}</span>
                          <span style={{ color: cyan }}>·</span>
                          <Countdown expiryMs={m.expiryMs} />
                        </div>
                      </div>
                      {isActive && (
                        <Check size={14} style={{ color: green }} />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Binary / Range segmented toggle */}
        <div
          className="inline-flex items-center rounded-lg p-0.5 gap-0.5"
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
                className="px-3 py-1 rounded-md text-[11px] font-semibold transition-colors"
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

        {/* Market carousel (prev/next + position) */}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => go(-1)}
            disabled={activeMarkets.length < 2}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: 'rgba(40, 44, 60, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
            aria-label="Previous market"
          >
            <ChevronLeft size={14} style={{ color: textSecondary }} />
          </button>
          <span
            className="text-[10px] font-mono px-2 tabular-nums"
            style={{ color: textSecondary }}
          >
            {selectedIdx + 1} / {activeMarkets.length}
          </span>
          <button
            onClick={() => go(1)}
            disabled={activeMarkets.length < 2}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: 'rgba(40, 44, 60, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
            aria-label="Next market"
          >
            <ChevronRight size={14} style={{ color: textSecondary }} />
          </button>
        </div>
      </div>

      {/* ── Chart + strike ladder ──────────────────────────────────────── */}
      <div className="flex items-stretch gap-2 flex-1 min-h-0">
        <GlassCard className="flex-1 min-h-0 overflow-hidden p-0">
          <div className="relative w-full">
            <PriceChart
              oracleId={currentOracleId}
              strike={strike}
              onStrikeChange={setStrike}
              {...(marketType === 'range' && {
                lower,
                upper,
                onRangeChange: (l: number, u: number) => {
                  setLower(l);
                  setUpper(u);
                },
              })}
            />

            {/* ── Overlay (bottom-right): UP/DOWN in binary, Range button in range ── */}
            <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2 pointer-events-none">
              {marketType === 'binary' ? (
                <>
                  <div
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-mono"
                    style={{
                      background: 'rgba(26, 29, 46, 0.6)',
                      backdropFilter: 'blur(20px)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                    }}
                  >
                    <span style={{ color: green }}>
                      UP {(liveMint.up / 100).toFixed(2)}
                    </span>
                    <span style={{ color: textSecondary }}>·</span>
                    <span style={{ color: red }}>
                      DOWN {(liveMint.down / 100).toFixed(2)}
                    </span>
                  </div>
                  <button
                    onClick={() => setModal({ open: true, strike, direction: 'up' })}
                    className="relative rounded-2xl px-4 py-2 overflow-hidden border border-white/10 pointer-events-auto"
                    style={{
                      background: 'rgba(26, 29, 46, 0.6)',
                      backdropFilter: 'blur(20px)',
                    }}
                  >
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
                    <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
                    <div
                      className="absolute -top-4 -right-4 w-12 h-12 rounded-full pointer-events-none"
                      style={{ background: green, filter: 'blur(30px)', opacity: 0.15 }}
                    />
                    <span
                      className="relative z-10 text-sm font-semibold"
                      style={{ color: green }}
                    >
                      ▲ UP
                    </span>
                  </button>
                  <button
                    onClick={() => setModal({ open: true, strike, direction: 'down' })}
                    className="relative rounded-2xl px-4 py-2 overflow-hidden border border-white/10 pointer-events-auto"
                    style={{
                      background: 'rgba(26, 29, 46, 0.6)',
                      backdropFilter: 'blur(20px)',
                    }}
                  >
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
                    <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
                    <div
                      className="absolute -top-4 -right-4 w-12 h-12 rounded-full pointer-events-none"
                      style={{ background: red, filter: 'blur(30px)', opacity: 0.15 }}
                    />
                    <span
                      className="relative z-10 text-sm font-semibold"
                      style={{ color: red }}
                    >
                      ▼ DOWN
                    </span>
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setRangeModalOpen(true)}
                  disabled={lower <= 0 || upper <= lower}
                  className="relative rounded-2xl px-4 py-2 overflow-hidden border border-white/10 pointer-events-auto"
                  style={{
                    background: 'rgba(26, 29, 46, 0.6)',
                    backdropFilter: 'blur(20px)',
                  }}
                >
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
                  <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
                  <div
                    className="absolute -top-4 -right-4 w-12 h-12 rounded-full pointer-events-none"
                    style={{ background: cyan, filter: 'blur(30px)', opacity: 0.15 }}
                  />
                  <span
                    className="relative z-10 text-sm font-semibold"
                    style={{ color: cyan }}
                  >
                    ⇋ Range {formatPrice(lower)}–{formatPrice(upper)}
                  </span>
                </button>
              )}
            </div>
          </div>
        </GlassCard>

        {/* Right-side strike ladder — hidden in range mode; the chart's two
            drag handles are the entire control surface there. */}
        {marketType === 'binary' && (
          <div className="w-80 shrink-0 min-h-0">
            <GlassCard className="  p-0 overflow-hidden">
              <StrikeGrid
                market={
                  market
                    ? {
                        spot: market.spot,
                        forward: market.forward,
                        svi: market.svi,
                        expiryMs: market.expiryMs,
                      }
                    : null
                }
                currentStrike={strike}
                onStrikeChange={setStrike}
              />
            </GlassCard>
          </div>
        )}
      </div>

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

      {currentMarket && marketType === 'range' && lower > 0 && upper > lower && (
        <RangeTradeModal
          open={rangeModalOpen}
          onClose={() => setRangeModalOpen(false)}
          market={{
            oracleId: currentMarket.oracle_id,
            asset,
            expiryMs,
            spotUsd,
          }}
          lower={lower}
          upper={upper}
          triggerStrike={triggerStrike}
          widthUsd={Math.round((upper - lower) / 2)}
        />
      )}
    </div>
  );
}
