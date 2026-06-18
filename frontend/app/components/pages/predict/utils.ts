/**
 * Predict page utilities — formatters and strike generator.
 */

export const DISPLAY_TICK_USD = 1000

export function formatPrice(usd: number): string {
  if (!usd || usd <= 0) return '—'
  return `$${Math.round(usd).toLocaleString('en-US')}`
}

/**
 * Format expiry as a human-readable countdown.
 * Returns "4d 2h", "1h 15m", "12m", or "soon".
 */
export function formatDetailedExpiry(ms: number, now: number = Date.now()): string {
  const diff = ms - now
  if (diff <= 0) return 'soon'

  const m = Math.floor(diff / 60_000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)

  if (d > 0) {
    const remainingH = h % 24
    return remainingH > 0 ? `${d}d ${remainingH}h` : `${d}d`
  }
  if (h > 0) {
    const remainingM = m % 60
    return remainingM > 0 ? `${h}h ${remainingM}m` : `${h}h`
  }
  return `${m}m`
}

/**
 * Format expiry as an absolute date/time string.
 * Example: "Jun 5, 14:00 UTC"
 */
export function formatExpiryDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  const day = d.getUTCDate()
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${month} ${day}, ${hh}:${mm} UTC`
}

/**
 * Format expiry as "<Weekday> at <HH:MM> UTC" for the predict question
 * copy (e.g. "Thursday at 11:45 UTC"). Used by the Simple mode header
 * where the absolute date is less important than the day/time.
 */
export function formatExpiryDayTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const weekday = d.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' })
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${weekday} at ${hh}:${mm} UTC`
}

/**
 * Ticker → full name for human-readable question copy. Falls back to the
 * ticker itself if the asset is unknown so we never end up with "X price
 * on …" in the UI.
 */
export const ASSET_FULL_NAME: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SUI: 'Sui',
  SOL: 'Solana',
  WAL: 'Walrus',
}

export function assetFullName(ticker: string): string {
  return ASSET_FULL_NAME[ticker.toUpperCase()] ?? ticker
}

/**
 * Round a USD value to the nearest display tick.
 */
export function roundToTick(spotUsd: number, tick: number): number {
  if (!spotUsd || tick <= 0) return 0
  return Math.round(spotUsd / tick) * tick
}

/**
 * Generate `count` strikes centered on the rounded spot price.
 * For count=5, tick=1000, spot=70123 → [68000, 69000, 70000, 71000, 72000]
 */
export function generateStrikes(spotUsd: number, count: number, tick: number): number[] {
  if (!spotUsd || count <= 0 || tick <= 0) return []
  const center = roundToTick(spotUsd, tick)
  const half = Math.floor(count / 2)
  return Array.from({ length: count }, (_, i) => center + (i - half) * tick)
}

/**
 * Three symmetric range widths centered on a trigger strike (USD).
 * Used by Simple mode range choices. Advanced mode accepts any width
 * (dragged), so the constant lives here but the Advanced range-mode UI
 * does not consume it directly.
 */
export const SIMPLE_RANGE_WIDTHS_USD = [500, 1000, 2500] as const

/**
 * Generate `widths.length` symmetric range choices around a trigger.
 * Caller decides whether to snap each bound to a tick — this helper
 * returns the raw symmetric bands.
 */
export function generateRangeChoices(
  triggerUsd: number,
  widths: readonly number[] = SIMPLE_RANGE_WIDTHS_USD
): { lower: number; upper: number; label: string }[] {
  if (!triggerUsd || triggerUsd <= 0) return []
  return widths.map((w) => ({
    lower: triggerUsd - w,
    upper: triggerUsd + w,
    label: `±$${w.toLocaleString('en-US')}`,
  }))
}
