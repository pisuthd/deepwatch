/**
 * Coin / amount utilities shared by the stake, borrow, and predict
 * panels. Centralises the small BigInt / listCoins dance that every
 * form-body was duplicating.
 *
 * - `parseUnits` / `fmtUnits` — string ↔ bigint at a given decimals
 *   precision. Pure, no React.
 * - `CoinBalance` / `fetchCoinBalance` — wallet coin lookup via the
 *   current Sui client. The "primary" coin is the largest object
 *   (largest balance first, used as the input to `tx.splitCoins`).
 *
 * These helpers are intentionally framework-light: no hooks, no
 * toasts. Callers wrap the async results in `useState` and surface
 * errors through whatever channel they prefer.
 *
 * The `SuiClient` parameter is typed as `ReturnType<typeof
 * useCurrentClient>` so callers can pass the hook's return value
 * directly without an `as` cast. This matches the pattern the
 * pre-extraction code used in `BorrowPanel` / `LpProvisionFormBody`.
 */

import { useCurrentClient } from '@mysten/dapp-kit-react';

export interface CoinBalance {
  /** Largest coin object (best `splitCoins` input), or null if none. */
  primaryCoinId: string | null;
  /** Sum of every coin's balance for this owner + type. */
  totalBalance: bigint;
}

/**
 * Parse a human-typed decimal string ("1.23") into a bigint at the
 * given decimals precision (e.g. 6 for DUSDC/PLP, 9 for SUI). Empty
 * or whitespace input → 0. Excess fractional digits are truncated.
 */
export function parseUnits(amount: string, decimals: number): bigint {
  const trimmed = (amount || '').trim();
  if (!trimmed) return BigInt(0);
  const [whole, frac = ''] = trimmed.split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole || '0') * BigInt(10 ** decimals) + BigInt(fracPadded || '0');
}

/**
 * Format a bigint amount (in `decimals`-precision units) as a decimal
 * string with at most `fracDigits` fractional digits. Defaults to 2
 * (e.g. "10.50"); pass 4 for SUI balances which need higher
 * precision.
 */
export function fmtUnits(
  units: bigint,
  decimals: number,
  fracDigits: number = 2,
): string {
  const whole = units / BigInt(10 ** decimals);
  const frac = units % BigInt(10 ** decimals);
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, fracDigits);
  return `${whole.toString()}.${fracStr}`;
}

/**
 * Fetch every coin of `coinType` owned by `owner` and return both the
 * total balance and the largest single object (a sensible default for
 * `tx.splitCoins`). Silent on failure — returns a zeroed balance so
 * the caller doesn't have to handle a third error path.
 */
export async function fetchCoinBalance(
  suiClient: ReturnType<typeof useCurrentClient>,
  owner: string,
  coinType: string,
): Promise<CoinBalance> {
  try {
    const res = await suiClient.core.listCoins({ owner, coinType, limit: 50 });
    const coins = res.objects ?? [];
    if (coins.length === 0) return { primaryCoinId: null, totalBalance: BigInt(0) };
    const sorted = [...coins].sort((a, b) => {
      const ab = BigInt(a.balance);
      const bb = BigInt(b.balance);
      return ab > bb ? -1 : ab < bb ? 1 : 0;
    });
    const totalBalance = coins.reduce(
      (acc: bigint, c: { balance: string }) => acc + BigInt(c.balance),
      BigInt(0),
    );
    return { primaryCoinId: sorted[0].objectId, totalBalance };
  } catch {
    return { primaryCoinId: null, totalBalance: BigInt(0) };
  }
}
