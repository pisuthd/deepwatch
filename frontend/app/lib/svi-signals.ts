/**
 * SVI-derived trading signals + prompt formatter + server-side consistency
 * guard for the AI insight pipeline.
 *
 * Lives alongside `lib/svi.ts` (which holds the canonical SVI math). This
 * module adds the *signal* layer: it turns the raw 5-param SVI surface into
 * a small set of typed fields the AI route (and the per-market popover) can
 * consume. Pure functions, no React/Next dependencies. Isomorphic (Node +
 * browser) so the same helpers run server-side in the route handler and
 * client-side if we ever need to render them.
 *
 * The new AI decision framework (`BATCH_SYSTEM_PROMPT` in
 * `app/api/insights/generate/route.ts`) treats the SVI surface as the
 * PRIMARY directional signal and Polymarket/Kalshi as a secondary sanity
 * check. The framework is enforced:
 *   1. Mechanically in the prompt's decision rules.
 *   2. Defensively in `sviDirectionConsistentWithSignal`, which the route
 *      calls before emitting each result SSE frame. If a model misfire
 *      contradicts a hard SVI invariant, the route downgrades the signal
 *      to NEUTRAL with a visible `[SVI guard: ...]` suffix on the
 *      reasoning string and a `console.warn` for ops visibility.
 *
 * Never throws. Degenerate inputs (null SVI, zero tau, non-finite prices)
 * fall through to the fallback path so the AI still gets a coherent prompt
 * block.
 */

import { binaryUpProb, sviVol, type SVIParams } from './svi';

const SVI_SCALE = 1e8;
const RHO_SCALE = 1e9;
const PRICE_SCALE = 1e9;

const DAY_MS = 24 * 3600 * 1000;
const YEAR_MS = 365.25 * DAY_MS;

/** Default SVI used when the oracle hasn't published one. Mirrors the
 *  fallback in `lib/svi.ts`. */
const FALLBACK_SVI: SVIParams = {
  a: 80887,
  b: 9328786,
  rho: 102029829,
  m: 7561599,
  sigma: 9522806,
};

export type VolRegime = 'low' | 'normal' | 'high' | 'extreme';
export type SkewDirection = 'call_skew' | 'put_skew' | 'flat';

export interface SviSignals {
  /** (forward - spot) / spot * 100. Positive = drift favours UP. */
  forwardSpotBasisPct: number;
  /** Annualised ATM implied vol (sqrt((svi.a / SVI_SCALE) / tau)). */
  atmVol: number;
  /** Vol regime bucket. */
  volRegime: VolRegime;
  /** Sign of b*rho. */
  skewDirection: SkewDirection;
  /** |b*rho|. Roughly [0..2]. */
  skewMagnitude: number;
  /** SVI-implied UP prob at the ATM strike (Black-76, sviVol at strike). */
  sviUpProbAtm: number;
  /** (sviUpProbAtm - dbProb) * 100. Positive = DB undervalues UP. */
  sviVsDbPp: number;
  /** 1-sigma implied move at expiry in USD. low = spot - mid, high = spot + mid. */
  impliedMove: { low: number; mid: number; high: number };
  /** True when the oracle published a real SVI (not the fallback). */
  hasSvi: boolean;
}

export interface ComputeSviSignalsInput {
  spotUsd: number;
  forwardUsd: number;
  expiryMs: number;
  svi: SVIParams | null;
  atmStrikeUsd: number;
  dbProb: number;
  nowMs?: number;
}

function bucketVolRegime(annualised: number): VolRegime {
  if (!Number.isFinite(annualised) || annualised <= 0) return 'extreme';
  if (annualised < 0.2) return 'low';
  if (annualised < 0.5) return 'normal';
  if (annualised < 1.0) return 'high';
  return 'extreme';
}

function skewFromBr(br: number): { direction: SkewDirection; magnitude: number } {
  if (!Number.isFinite(br)) return { direction: 'flat', magnitude: 0 };
  const magnitude = Math.abs(br);
  if (br < -0.05) return { direction: 'put_skew', magnitude };
  if (br > 0.05) return { direction: 'call_skew', magnitude };
  return { direction: 'flat', magnitude };
}

export function computeSviSignals(input: ComputeSviSignalsInput): SviSignals {
  const {
    spotUsd,
    forwardUsd,
    expiryMs,
    svi,
    atmStrikeUsd,
    dbProb,
    nowMs = Date.now(),
  } = input;

  const tau = Math.max(0, (expiryMs - nowMs) / YEAR_MS);
  const spot = Number.isFinite(spotUsd) && spotUsd > 0 ? spotUsd : 0;
  const forward = Number.isFinite(forwardUsd) && forwardUsd > 0 ? forwardUsd : 0;

  // Forward-spot basis. NaN-safe.
  let basisPct = 0;
  if (spot > 0 && forward > 0) {
    basisPct = ((forward - spot) / spot) * 100;
  }

  const hasSvi = !!svi;
  const params: SVIParams = svi ?? FALLBACK_SVI;

  // ATM annualised vol. Sqrt(a/tau) with the canonical SVI scale.
  let atmVol = 0;
  if (tau > 0 && params.a > 0) {
    atmVol = Math.sqrt(params.a / SVI_SCALE / tau);
  } else if (params.sigma > 0) {
    atmVol = params.sigma / SVI_SCALE;
  }
  if (!Number.isFinite(atmVol)) atmVol = 0;

  // Skew via b*rho.
  const b = params.b / SVI_SCALE;
  const rho = params.rho / RHO_SCALE;
  const br = b * rho;
  const { direction: skewDirection, magnitude: skewMagnitude } = skewFromBr(br);

  // SVI-implied UP prob at the ATM strike.
  let sviUpProbAtm = 0.5;
  if (tau > 0 && atmStrikeUsd > 0 && forward > 0) {
    const K = atmStrikeUsd; // already in dollars
    const F = forward; // already in dollars
    const vol = sviVol(K * PRICE_SCALE, F * PRICE_SCALE, tau, params);
    sviUpProbAtm = binaryUpProb(F, K, tau, vol);
  } else if (tau <= 0) {
    // Past expiry: SVI can't speak. Use the orderbook UP prob as a sane
    // placeholder so the consistency check still has a number to compare.
    sviUpProbAtm = Number.isFinite(dbProb) ? dbProb : 0.5;
  }

  // SVI-vs-DB gap. Positive = SVI says UP is more likely than DB → DB
  // undervalues UP (cheap).
  const safeDb = Number.isFinite(dbProb) ? dbProb : 0.5;
  const sviVsDbPp = (sviUpProbAtm - safeDb) * 100;

  // 1-sigma implied move at expiry.
  const moveMid =
    spot > 0 && atmVol > 0 && tau > 0 ? spot * atmVol * Math.sqrt(tau) : 0;
  const impliedMove = {
    low: Math.max(0, spot - moveMid),
    mid: moveMid,
    high: spot + moveMid,
  };

  return {
    forwardSpotBasisPct: basisPct,
    atmVol,
    volRegime: bucketVolRegime(atmVol),
    skewDirection,
    skewMagnitude,
    sviUpProbAtm,
    sviVsDbPp,
    impliedMove,
    hasSvi,
  };
}

// ─── Per-market prompt formatter ─────────────────────────────────────────

export interface FormatSviInputsArgs {
  spotUsd: number;
  forwardUsd: number;
  expiryMs: number;
  svi: SVIParams | null;
  atmStrikeUsd: number;
  dbProb: number;
  polyProb?: number;
  kalshiProb?: number;
  spread?: number;
  nowMs?: number;
}

const fmtUsd = (n: number): string => {
  if (!Number.isFinite(n) || n <= 0) return 'n/a';
  return `$${Math.round(n).toLocaleString('en-US')}`;
};

const fmtPct = (n: number, digits = 1): string => {
  if (!Number.isFinite(n)) return 'n/a';
  return `${n.toFixed(digits)}%`;
};

const fmtSignedPct = (n: number, digits = 2): string => {
  if (!Number.isFinite(n)) return 'n/a';
  const sign = n > 0 ? '+' : n < 0 ? '' : '';
  return `${sign}${n.toFixed(digits)}%`;
};

const fmtPctOrNa = (p: number | undefined): string => {
  if (typeof p !== 'number' || !Number.isFinite(p)) return 'no match';
  return `${(p * 100).toFixed(1)}%`;
};

const driftPhrase = (basisPct: number): string => {
  if (basisPct > 0.5) return 'drift favors UP';
  if (basisPct < -0.5) return 'drift favors DOWN';
  return 'drift neutral';
};

function median(nums: number[]): number {
  if (nums.length === 0) return NaN;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function crossVenueLine(args: {
  dbProb: number;
  polyProb?: number;
  kalshiProb?: number;
  spread?: number;
}): string {
  const present: number[] = [args.dbProb];
  const lines: string[] = [];
  lines.push(`Cross-venue: Poly ${fmtPctOrNa(args.polyProb)}, Kalshi ${fmtPctOrNa(args.kalshiProb)}`);
  const poly = args.polyProb;
  const kalshi = args.kalshiProb;
  if (typeof poly === 'number' && Number.isFinite(poly)) present.push(poly);
  if (typeof kalshi === 'number' && Number.isFinite(kalshi)) present.push(kalshi);
  const cons = median(present);
  const dbPct = args.dbProb * 100;
  if (Number.isFinite(cons)) {
    const consPct = cons * 100;
    const dev = (args.dbProb - cons) * 100;
    lines.push(
      `(consensus ${consPct.toFixed(1)}%, DB ${dbPct.toFixed(1)}%, DB vs consensus ${dev >= 0 ? '+' : ''}${dev.toFixed(2)}pp)`,
    );
  } else {
    lines.push(`(consensus n/a)`);
  }
  if (typeof args.spread === 'number' && Number.isFinite(args.spread)) {
    lines.push(`Spread: ${(args.spread * 100).toFixed(1)}%`);
  }
  return lines.join(' ');
}

/**
 * Build the per-market SVI/cross-venue markdown block injected by
 * `buildBatchUserPrompt`. Pure formatting — no LLM input. When the oracle
 * didn't publish an SVI, emits a one-line fallback so the prompt is still
 * self-consistent and the model can fall through to cross-venue only.
 */
export function formatSviInputs(args: FormatSviInputsArgs): string {
  const signals = computeSviSignals(args);

  const spot = fmtUsd(args.spotUsd);
  const forward = fmtUsd(args.forwardUsd);

  // Cross-venue line is always appended.
  const crossVenue = crossVenueLine({
    dbProb: args.dbProb,
    polyProb: args.polyProb,
    kalshiProb: args.kalshiProb,
    spread: args.spread,
  });

  if (!signals.hasSvi) {
    return [
      `Spot: ${spot}`,
      `Forward: ${forward}`,
      'SVI: n/a — decision must rely on cross-venue only.',
      crossVenue,
    ].join('\n');
  }

  const params = args.svi as SVIParams;
  const sviLine = `SVI: a=${params.a} b=${params.b} rho=${params.rho} m=${params.m} sigma=${params.sigma}`;

  const atmVolPct = signals.atmVol * 100;
  const skewLine = `skew: ${signals.skewDirection} (magnitude ${signals.skewMagnitude.toFixed(2)})`;

  const richOrCheap = signals.sviVsDbPp >= 0 ? 'cheap' : 'rich';
  const absGap = Math.abs(signals.sviVsDbPp);
  const gapLine = `DB ${richOrCheap} vs SVI by ${absGap.toFixed(1)}pp`;

  const sviUpPct = signals.sviUpProbAtm * 100;
  const dbPct = args.dbProb * 100;
  const strikeStr = args.atmStrikeUsd > 0 ? fmtUsd(args.atmStrikeUsd) : 'n/a';

  const move = signals.impliedMove;
  const moveLine =
    move.mid > 0
      ? `Implied 1σ move at expiry: ${fmtUsd(move.low)} – ${fmtUsd(move.mid)} – ${fmtUsd(move.high)}`
      : 'Implied 1σ move at expiry: n/a';

  return [
    `Spot: ${spot}`,
    `Forward: ${forward}  →  Forward-spot basis: ${fmtSignedPct(signals.forwardSpotBasisPct)} (${driftPhrase(signals.forwardSpotBasisPct)})`,
    `${sviLine}  →  ATM vol: ${fmtPct(atmVolPct)} (${signals.volRegime}), ${skewLine}`,
    `SVI-implied UP prob (ATM @ ${strikeStr}): ${fmtPct(sviUpPct)}`,
    `DB orderbook UP prob (ATM): ${fmtPct(dbPct)}  →  ${gapLine}`,
    moveLine,
    crossVenue,
  ].join('\n');
}

// ─── Server-side consistency guard ───────────────────────────────────────

export interface SviGuardArgs {
  signal: 'UP' | 'DOWN' | 'NEUTRAL';
  signals: SviSignals;
}

export interface SviGuardResult {
  consistent: boolean;
  reason?: string;
}

/**
 * Defensive backstop. Returns `{ consistent: false, reason }` when the
 * model's directional call contradicts a hard SVI invariant. The route's
 * `flushTool` demotes such calls to NEUTRAL (with the reason appended to
 * `reasoning`) and logs a `console.warn` for ops visibility. The guard
 * never FLIPS direction — it only neutralises — because flipping the
 * model's intent mid-stream creates downstream trust issues (the popover
 * would show a different direction than the user just watched stream in).
 */
export function sviDirectionConsistentWithSignal(
  args: SviGuardArgs,
): SviGuardResult {
  const { signal, signals } = args;

  if (!signals.hasSvi) {
    // SVI null is degraded input; we don't guard against it. The prompt's
    // B/C rules already say "SVI null → fall through to cross-venue only".
    return { consistent: true };
  }

  // Core invariant: put_skew + negative basis + DB rich on UP → never UP.
  if (
    signal === 'UP' &&
    signals.skewDirection === 'put_skew' &&
    signals.forwardSpotBasisPct < -0.2 &&
    signals.sviVsDbPp > 5
  ) {
    return {
      consistent: false,
      reason:
        'put_skew + negative basis + SVI-vs-DB gap > 5pp — SVI says DOWN, model said UP',
    };
  }

  // Mirror: call_skew + positive basis + DB cheap on UP → never DOWN.
  if (
    signal === 'DOWN' &&
    signals.skewDirection === 'call_skew' &&
    signals.forwardSpotBasisPct > 0.2 &&
    signals.sviVsDbPp < -5
  ) {
    return {
      consistent: false,
      reason:
        'call_skew + positive basis + SVI-vs-DB gap < -5pp — SVI says UP, model said DOWN',
    };
  }

  // Should-have-been-NEUTRAL: tiny basis AND tiny SVI-vs-DB gap. A
  // non-NEUTRAL signal here is an overconfident read; the prompt's
  // section B already specifies this branch.
  if (signal !== 'NEUTRAL') {
    if (
      Math.abs(signals.forwardSpotBasisPct) < 0.2 &&
      Math.abs(signals.sviVsDbPp) < 2
    ) {
      return {
        consistent: false,
        reason:
          '|basis| < 0.2% AND |SVI-vs-DB gap| < 2pp — should have been NEUTRAL',
      };
    }
  }

  return { consistent: true };
}
