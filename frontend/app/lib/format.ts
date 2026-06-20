/**
 * Display + strike/band generators.
 *
 * Ported from /lib/markets/format.ts so the frontend can run without
 * depending on the root app's lib/. Pure, no React/Next dependencies.
 */

export const DISPLAY_TICK_USD = 1000;

/** "$1,234" or "—" for non-positive. */
export function formatUsd(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd) || usd <= 0) {
    return "—";
  }
  return `$${Math.round(usd).toLocaleString("en-US")}`;
}

/** Probability 0–1 → "62%". */
export function formatPct(p: number | null | undefined, digits = 0): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  return `${(p * 100).toFixed(digits)}%`;
}

/**
 * Scale factor for raw 6-decimal DUSDC and PLP values reported by the
 * Predict indexer and the DeepWatch pool. Divide first, then pass to
 * `formatCompactUsd` / `formatUnitPrice` so `$1_016_299_409_110` renders
 * as `$1.02M`, not `$1.02T`.
 */
export const DUSDC_SCALE = 1_000_000;

/**
 * Format a raw 6-decimal DUSDC value as a human-readable USD string
 * that collapses to K / M / B once the value passes $1k. `null` /
 * `undefined` render as "—". The input is treated as a raw 6-decimal
 * integer — divide by `DUSDC_SCALE` first if the source is human-scale.
 */
export function formatCompactUsd(raw: number | null | undefined): string {
  if (raw == null) return '—';
  const human = raw / DUSDC_SCALE;
  if (human >= 1e9) return `$${(human / 1e9).toFixed(2)}B`;
  if (human >= 1e6) return `$${(human / 1e6).toFixed(2)}M`;
  if (human >= 1e3) return `$${(human / 1e3).toFixed(1)}K`;
  return `$${human.toFixed(2)}`;
}

/**
 * Format a unitless ratio (e.g. PLP share price ≈ 1.0…) as USD with
 * 4 dp. `null` / `undefined` render as "—". Use for prices that are
 * already in human form — do NOT pass raw 6-decimal DUSDC integers
 * here; use `formatCompactUsd` for those.
 */
export function formatUnitPrice(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${n.toFixed(4)}`;
}

/** Short countdown: "4d 2h", "1h 15m", "12m", "soon". */
export function formatDetailedExpiry(ms: number, now: number = Date.now()): string {
  const diff = ms - now;
  if (diff <= 0) return "soon";
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) {
    const remainingH = h % 24;
    return remainingH > 0 ? `${d}d ${remainingH}h` : `${d}d`;
  }
  if (h > 0) {
    const remainingM = m % 60;
    return remainingM > 0 ? `${h}h ${remainingM}m` : `${h}h`;
  }
  return `${m}m`;
}

/** Absolute expiry: "Jun 5, 14:00 UTC". */
export function formatExpiryDate(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day}, ${hh}:${mm} UTC`;
}

/**
 * Compact expiry for question text: "Friday at 06:45 UTC".
 * Used to fold the absolute date into the market question so we don't
 * need a separate "Expires …" line on the card.
 */
export function formatExpiryQuestion(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const dayName = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${dayName} at ${time} UTC`;
}

/** Round a USD value to the nearest display tick. */
export function roundToTick(spotUsd: number, tick: number): number {
  if (!spotUsd || tick <= 0) return 0;
  return Math.round(spotUsd / tick) * tick;
}

/**
 * Generate `count` strikes centered on the rounded spot price.
 * For count=5, tick=1000, spot=70123 → [68000, 69000, 70000, 71000, 72000].
 */
export function generateStrikes(spotUsd: number, count: number, tick: number): number[] {
  if (!spotUsd || count <= 0 || tick <= 0) return [];
  const center = roundToTick(spotUsd, tick);
  const half = Math.floor(count / 2);
  return Array.from({ length: count }, (_, i) => center + (i - half) * tick);
}

/**
 * A range market over [floorUsd, capUsd] with band width as a percentage
 * of spot. We use three pre-picked bands: ±1% (narrow), ±3% (medium),
 * ±5% (wide) — the actual DeepBook Predict market is a continuous spectrum
 * (any (lower, higher) tuple is mintable), so we pre-pick representative
 * widths to populate the search index.
 */
export interface RangeBand {
  floorUsd: number;
  capUsd: number;
  widthPct: number; // 2, 6, or 10
}

const RANGE_BAND_WIDTHS_PCT = [2, 6, 10] as const;

/**
 * Three range bands centered on the (unrounded) spot price, snapped to the
 * nearest tick: floor snaps DOWN, cap snaps UP. The band is always ≥ the
 * requested width after snapping, so we never under-report a market.
 *
 *   spot=$70,000, tick=$1,000 →
 *     narrow  (±1%):  [69,000, 71,000]  width 2
 *     medium  (±3%):  [68,000, 72,000]  width 6
 *     wide    (±5%):  [67,000, 74,000]  width 10
 */
export function generateRangeBands(spotUsd: number, tick: number): RangeBand[] {
  if (!spotUsd || spotUsd <= 0 || tick <= 0) return [];
  return RANGE_BAND_WIDTHS_PCT.map((widthPct) => {
    const half = (spotUsd * widthPct) / 200; // pct is "total width"
    const rawFloor = spotUsd - half;
    const rawCap = spotUsd + half;
    const floorUsd = Math.floor(rawFloor / tick) * tick;
    const capUsd = Math.ceil(rawCap / tick) * tick;
    return { floorUsd, capUsd, widthPct };
  });
}