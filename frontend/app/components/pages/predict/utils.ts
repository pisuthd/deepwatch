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
