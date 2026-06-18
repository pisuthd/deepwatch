'use client';

/**
 * DrilldownPanel — modal showing per-strike yes/no mint prices for a
 * single cross-venue match, in one comparison table.
 *
 *   Header: question + expiry + close button
 *   Body:
 *     - Up/Down ↔ Range segmented control (toggle which ladder to view)
 *     - Single comparison table:
 *         Strike/Range | DB YES | DB NO | Poly YES | Poly NO | Kalshi YES | Kalshi NO
 *       One row per strike/band per venue (union of strikes across the
 *       3 venues); missing-venue cells show "—".
 *
 *   Interactions:
 *     - ESC closes
 *     - Click on the backdrop closes
 *     - X button closes
 *     - Body scroll is locked while open (overflow-hidden on <html>)
 */

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { formatDetailedExpiry, formatExpiryDate, formatUsd } from '@/app/lib/format';
import type { DeepBookMatch } from '@/app/lib/match';
import {
  impliedProbUpForRange,
  impliedProbUpForStrike,
  type SVIParams,
} from '@/app/lib/svi';
import type { DeepBookGroup } from '@/app/lib/deepbook';
import type { DeepBookMarket } from '@/app/lib/types';

// DeepBook indexer on-chain price scale (1e9). forwardUsd on the
// frontend is already in dollars, so to feed the SVI function we
// multiply back up to raw units.
const PRICE_SCALE = 1e9;

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const cyan = '#3EC4C0';
const green = '#00E68A';
const red = '#ef4444';
const polyTint = '#3b82f6';
const kalshiTint = '#a855f7';

type LadderView = 'updown' | 'range';

interface DrilldownPanelProps {
  match: DeepBookMatch | null;
  spotUsd: number | null;
  onClose: () => void;
}

/** A single row in the comparison table. */
interface UpDownCompareRow {
  strikeUsd: number;
  db?: { yes: number; no: number };
  poly?: { yes: number; no: number };
  kalshi?: { yes: number; no: number };
}

interface RangeCompareRow {
  floorStrikeUsd: number;
  capStrikeUsd: number;
  rangeBandPct: number;
  db?: { yes: number; no: number };
  poly?: { yes: number; no: number };
  kalshi?: { yes: number; no: number };
}

const yesNo = (yes: number): { yes: number; no: number } => ({ yes, no: 1 - yes });

/**
 * Pull SVI parameters + forward price out of a DeepBook group. The
 * group's markets all share the same oracle/expiry, so any market's
 * SVI snapshot is representative. Returns `null` if no market has the
 * data we need — in which case callers should fall back to whatever
 * pre-computed rows the DB group already carries.
 */
function sviContextForGroup(group: DeepBookGroup | null):
  | { svi: SVIParams; forwardRaw: number }
  | null {
  if (!group) return null;
  // Prefer the up/down row (always present for an active oracle);
  // fall back to any range row if up/down is empty.
  const sample: DeepBookMarket | undefined =
    group.upDown[0] ?? group.range[0];
  if (!sample) return null;
  if (
    sample.sviA == null ||
    sample.sviB == null ||
    sample.sviRho == null ||
    sample.sviM == null ||
    sample.sviSigma == null ||
    sample.forwardUsd == null ||
    sample.forwardUsd <= 0
  ) {
    return null;
  }
  return {
    svi: {
      a: sample.sviA,
      b: sample.sviB,
      rho: sample.sviRho,
      m: sample.sviM,
      sigma: sample.sviSigma,
    },
    forwardRaw: sample.forwardUsd * PRICE_SCALE,
  };
}

/**
 * Union the strikes across all 3 venues into one sorted row list. A
 * row exists if at least one venue carries that strike. Missing-venue
 * cells show "—".
 *
 * DeepBook pre-generates a 5-strike ladder around spot, but Polymarket
 * and Kalshi can have many more strikes at finer granularity. For any
 * strike that DB doesn't pre-generate, we project DB's price via its
 * SVI surface — the same model that produced the pre-generated
 * ladder, evaluated at the new strike. This way the table shows all
 * three venues at every strike any of them carries.
 */
function buildUpDownRows(match: DeepBookMatch): UpDownCompareRow[] {
  const map = new Map<number, UpDownCompareRow>();
  const set = (
    strikeUsd: number,
    venue: 'db' | 'poly' | 'kalshi',
    yes: number,
  ) => {
    let row = map.get(strikeUsd);
    if (!row) {
      row = { strikeUsd };
      map.set(strikeUsd, row);
    }
    row[venue] = yesNo(yes);
  };

  // DB pre-generated strikes — use the value the indexer already
  // computed (it's the source of truth for the 5 strikes around spot).
  const dbStrikes = new Set<number>();
  for (const m of match.deepBook.upDown) {
    if (m.strikeUsd > 0 && m.impliedProbUp > 0) {
      dbStrikes.add(m.strikeUsd);
      set(m.strikeUsd, 'db', m.impliedProbUp);
    }
  }

  // SVI context for projecting DB onto Poly/Kalshi-only strikes.
  const sviCtx = sviContextForGroup(match.deepBook);

  // Poly + Kalshi strikes — use the full cross-venue surface that
  // `findMatchesForDeepBook` pre-computed (every Poly/Kalshi strike
  // across ALL groups that falls inside the DB oracle's strike range,
  // not just the closest-by-expiry group's strikes). The closest-by-expiry
  // group alone misses 90%+ of Polymarket's strike coverage since Poly
  // ladders are anchored to hourly expiries that often don't align
  // exactly with the DB oracle.
  const allPolyKalshiStrikes: { strikeUsd: number; venue: 'poly' | 'kalshi'; yes: number }[] = [];
  for (const m of match.polyStrikes ?? []) {
    if (m.strikeUsd > 0 && m.impliedProbUp > 0) {
      allPolyKalshiStrikes.push({ strikeUsd: m.strikeUsd, venue: 'poly', yes: m.impliedProbUp });
    }
  }
  for (const m of match.kalshiStrikes ?? []) {
    if (m.strikeUsd > 0 && m.impliedProbUp > 0) {
      allPolyKalshiStrikes.push({ strikeUsd: m.strikeUsd, venue: 'kalshi', yes: m.impliedProbUp });
    }
  }
  for (const { strikeUsd, venue, yes } of allPolyKalshiStrikes) {
    set(strikeUsd, venue, yes);
    if (!dbStrikes.has(strikeUsd) && sviCtx) {
      const dbYes = impliedProbUpForStrike(
        strikeUsd,
        sviCtx.forwardRaw,
        match.expiryMs,
        sviCtx.svi,
      );
      if (dbYes > 0) set(strikeUsd, 'db', dbYes);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.strikeUsd - b.strikeUsd);
}

function buildRangeRows(match: DeepBookMatch): RangeCompareRow[] {
  // Key each band by (floor, cap) so two bands that share a floor but
  // differ in width stay distinct.
  const key = (f: number, c: number) => `${f}::${c}`;
  const map = new Map<string, RangeCompareRow>();
  const set = (
    floorStrikeUsd: number,
    capStrikeUsd: number,
    rangeBandPct: number,
    venue: 'db' | 'poly' | 'kalshi',
    yes: number,
  ) => {
    const k = key(floorStrikeUsd, capStrikeUsd);
    let row = map.get(k);
    if (!row) {
      row = { floorStrikeUsd, capStrikeUsd, rangeBandPct };
      map.set(k, row);
    }
    row[venue] = yesNo(yes);
  };

  // DB pre-generated bands (±1%, ±3%, ±5% of spot) — use the values
  // the indexer already computed.
  const dbBandKeys = new Set<string>();
  for (const m of match.deepBook.range) {
    if (
      m.floorStrikeUsd !== null &&
      m.capStrikeUsd !== null &&
      m.floorStrikeUsd > 0 &&
      m.capStrikeUsd > 0
    ) {
      dbBandKeys.add(key(m.floorStrikeUsd, m.capStrikeUsd));
      set(m.floorStrikeUsd, m.capStrikeUsd, m.rangeBandPct, 'db', m.impliedProbUp);
    }
  }

  // SVI context for projecting DB onto Poly/Kalshi-only bands.
  const sviCtx = sviContextForGroup(match.deepBook);

  // Poly + Kalshi bands — compute DB price via SVI when not in the
  // pre-generated ladder.
  type PolyKalshiBand = {
    floor: number;
    cap: number;
    bandPct: number;
    venue: 'poly' | 'kalshi';
    yes: number;
  };
  const allPolyKalshiBands: PolyKalshiBand[] = [];
  for (const m of match.poly?.range ?? []) {
    if (m.floorStrikeUsd > 0 && m.capStrikeUsd > 0) {
      allPolyKalshiBands.push({
        floor: m.floorStrikeUsd,
        cap: m.capStrikeUsd,
        bandPct: m.rangeBandPct,
        venue: 'poly',
        yes: m.impliedProbUp,
      });
    }
  }
  for (const m of match.kalshi?.range ?? []) {
    if (m.floorStrikeUsd > 0 && m.capStrikeUsd > 0) {
      allPolyKalshiBands.push({
        floor: m.floorStrikeUsd,
        cap: m.capStrikeUsd,
        bandPct: m.rangeBandPct,
        venue: 'kalshi',
        yes: m.impliedProbUp,
      });
    }
  }
  for (const { floor, cap, bandPct, venue, yes } of allPolyKalshiBands) {
    set(floor, cap, bandPct, venue, yes);
    if (!dbBandKeys.has(key(floor, cap)) && sviCtx) {
      const dbYes = impliedProbUpForRange(
        floor,
        cap,
        sviCtx.forwardRaw,
        match.expiryMs,
        sviCtx.svi,
      );
      if (dbYes > 0) set(floor, cap, bandPct, 'db', dbYes);
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => a.floorStrikeUsd - b.floorStrikeUsd,
  );
}

function priceCell(yn: { yes: number; no: number } | undefined, tint: string) {
  // Always render two cells (YES, NO) so the column count matches
  // the header. A missing-venue pair renders both as "—".
  if (!yn) {
    return (
      <>
        <td
          className="px-3 py-2 text-right font-mono text-xs"
          style={{ color: textSecondary, opacity: 0.4 }}
        >
          —
        </td>
        <td
          className="px-3 py-2 text-right font-mono text-xs"
          style={{ color: textSecondary, opacity: 0.4 }}
        >
          —
        </td>
      </>
    );
  }
  return (
    <>
      <td
        className="px-3 py-2 text-right font-mono font-semibold text-xs"
        style={{ color: tint }}
      >
        {yn.yes.toFixed(2)}
      </td>
      <td
        className="px-3 py-2 text-right font-mono text-xs"
        style={{ color: textSecondary }}
      >
        {yn.no.toFixed(2)}
      </td>
    </>
  );
}

function PriceTableHeader() {
  return (
    <thead style={{ background: 'rgba(255,255,255,0.04)' }}>
      <tr
        className="text-left"
        style={{ color: textSecondary, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}
      >
        <th className="px-3 py-2 font-medium" rowSpan={2}>Strike / Range</th>
        <th className="px-3 py-2 font-medium text-center" colSpan={2} style={{ color: cyan }}>
          DeepBook
        </th>
        <th className="px-3 py-2 font-medium text-center" colSpan={2} style={{ color: polyTint }}>
          Polymarket
        </th>
        <th className="px-3 py-2 font-medium text-center" colSpan={2} style={{ color: kalshiTint }}>
          Kalshi
        </th>
      </tr>
      <tr
        style={{ color: textSecondary, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}
      >
        <th className="px-3 py-1 font-medium text-right" style={{ color: cyan }}>YES</th>
        <th className="px-3 py-1 font-medium text-right" style={{ color: textSecondary }}>NO</th>
        <th className="px-3 py-1 font-medium text-right" style={{ color: polyTint }}>YES</th>
        <th className="px-3 py-1 font-medium text-right" style={{ color: textSecondary }}>NO</th>
        <th className="px-3 py-1 font-medium text-right" style={{ color: kalshiTint }}>YES</th>
        <th className="px-3 py-1 font-medium text-right" style={{ color: textSecondary }}>NO</th>
      </tr>
    </thead>
  );
}

function UpDownTable({ rows }: { rows: UpDownCompareRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-8 text-sm" style={{ color: textSecondary }}>
        No Up/Down markets for this match.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-white/10" style={{ background: 'rgba(0,0,0,0.2)' }}>
      <table className="w-full text-xs">
        <PriceTableHeader />
        <tbody>
          {rows.map((r) => (
            <tr key={r.strikeUsd} className="border-t border-white/5">
              <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap" style={{ color: textPrimary }}>
                {formatUsd(r.strikeUsd)}
              </td>
              {priceCell(r.db, cyan)}
              {priceCell(r.poly, polyTint)}
              {priceCell(r.kalshi, kalshiTint)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RangeTable({ rows }: { rows: RangeCompareRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-8 text-sm" style={{ color: textSecondary }}>
        No range markets for this match.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-white/10" style={{ background: 'rgba(0,0,0,0.2)' }}>
      <table className="w-full text-xs">
        <PriceTableHeader />
        <tbody>
          {rows.map((r) => {
            const k = `${r.floorStrikeUsd}::${r.capStrikeUsd}`;
            return (
              <tr key={k} className="border-t border-white/5">
                <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap" style={{ color: textPrimary }}>
                  {formatUsd(r.floorStrikeUsd)}–{formatUsd(r.capStrikeUsd)}
                </td>
                {priceCell(r.db, cyan)}
                {priceCell(r.poly, polyTint)}
                {priceCell(r.kalshi, kalshiTint)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function DrilldownPanel({ match, spotUsd, onClose }: DrilldownPanelProps) {
  const [view, setView] = useState<LadderView>('updown');

  const upDownRows = useMemo(() => (match ? buildUpDownRows(match) : []), [match]);
  const rangeRows = useMemo(() => (match ? buildRangeRows(match) : []), [match]);

  // Lock body scroll while open + close on ESC.
  useEffect(() => {
    if (!match) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [match, onClose]);

  return (
    <AnimatePresence>
      {match && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center md:items-start md:justify-end p-3 md:p-6"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10"
            style={{
              background: 'rgba(26, 29, 46, 0.96)',
              backdropFilter: 'blur(20px)',
            }}
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Drilldown for ${match.dbQuestion}`}
          >
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

            <div className="relative z-10 p-5 space-y-4">
              {/* Header — anchored on the DeepBook oracle (the row's
                  identity). Poly/Kalshi questions are listed below the
                  metadata so the user can see what each venue is
                  actually answering at this expiry. */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2
                    className="text-base font-bold leading-snug truncate"
                    style={{ color: textPrimary }}
                    title={match.dbQuestion}
                  >
                    {match.dbQuestion}
                  </h2>
                  <div className="text-xs mt-1 font-mono" style={{ color: textSecondary }}>
                    {match.asset}/USD · {formatExpiryDate(match.expiryMs)} ·{' '}
                    expires in {formatDetailedExpiry(match.expiryMs)}
                    {spotUsd && spotUsd > 0 ? ` · ATM ${formatUsd(spotUsd)}` : ''}
                  </div>
                  {(match.polyQuestion || match.kalshiQuestion) && (
                    <div className="text-[11px] mt-1.5 space-y-0.5">
                      {match.polyQuestion && (
                        <div className="truncate" title={match.polyQuestion}>
                          <span style={{ color: polyTint }}>Poly:</span>{' '}
                          <span style={{ color: textSecondary }}>{match.polyQuestion}</span>
                        </div>
                      )}
                      {match.kalshiQuestion && (
                        <div className="truncate" title={match.kalshiQuestion}>
                          <span style={{ color: kalshiTint }}>Kalshi:</span>{' '}
                          <span style={{ color: textSecondary }}>{match.kalshiQuestion}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors hover:bg-white/10"
                  style={{ color: textSecondary }}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Up/Down ↔ Range segmented control */}
              <div
                className="inline-flex items-center rounded-lg p-0.5 gap-0.5"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                {(['updown', 'range'] as const).map((v) => {
                  const isActive = view === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setView(v)}
                      className="px-3 py-1 rounded-md text-[11px] font-semibold transition-colors"
                      style={{
                        background: isActive ? green : 'transparent',
                        color: isActive ? '#000' : textSecondary,
                      }}
                    >
                      {v === 'updown' ? 'Up / Down' : 'Range'}
                    </button>
                  );
                })}
              </div>

              {/* Single comparison table — same shape for both views */}
              {view === 'updown' ? (
                <UpDownTable rows={upDownRows} />
              ) : (
                <RangeTable rows={rangeRows} />
              )}

              {/* Tiny legend so users know what YES / NO means */}
              <div className="text-[10px] font-mono" style={{ color: textSecondary }}>
                Prices shown as 0–1 mint prices — YES is the cost to buy the
                UP outcome, NO is the cost to buy the DOWN outcome (YES + NO ≈ 1).
                Missing rows mean that venue has no market at this strike/band.
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
