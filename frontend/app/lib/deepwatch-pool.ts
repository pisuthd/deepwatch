/**
 * `deepwatch-pool` — Move tx builders + on-chain read helpers for the
 * DeepWatch second-layer staking pool (see `contracts/sources/pool.move`).
 *
 * # Two layers, two sets of txs
 *
 * **Layer 1 — LP provision (existing on-chain, no new code):**
 *   `predict::supply<DUSDC>(predict, payment, clock)` → `Coin<PLP>`
 *   `predict::withdraw<DUSDC>(predict, lp, clock)` → `Coin<DUSDC>`
 *
 * **Layer 2 — DeepWatch pool (this contract):**
 *   `pool::stake<T, C>(pool, plp_coin, duration_ms, clock)` → `Subscription`
 *   `pool::unstake<T, C>(pool, sub)` → `Coin<T>` (PLP)
 *   `pool::borrow<T, C>(pool, collateral_coin, amount, clock)` → `Debt<T, C>`
 *   `pool::repay<T, C>(pool, debt, payment, clock)` → `Coin<C>` (collateral back)
 *   `pool::claim_collateral<T, C>(pool, debt, repay, clock)` → `Coin<C>` (liquidator)
 *   `pool::donate<T, C>(pool, coin)` → () (anyone can donate yield)
 *
 * # Tx shape
 *
 * All Layer-2 txs are single-PTB calls — no coin-merging tricks needed
 * because the user's PLP/SUI lives in a known number of objects (we
 * merge + split in the same PTB so the user can specify a partial
 * amount). For `stake`, `borrow`, `donate` we also pass the `Clock`
 * shared object (`0x6`).
 *
 * # Read helpers
 *
 * `fetchPoolSnapshot(rpc, poolId)` reads the live `Pool` shared
 * object via `sui_getObject` and returns `{ totalShares,
 * treasuryValue, collateralValue, ltvBps, borrowRateBps,
 * defaultLoanDurationMs }`. Cached and polled by `useDeepWatchPool`.
 *
 * `fetchUserSubscriptions(rpc, owner, packageId)` lists the user's
 * `Subscription` NFTs by querying owned objects filtered by struct
 * type. Returns the most-recently-minted valid one (if any).
 */

import type { Transaction, TransactionArgument } from '@mysten/sui/transactions';
import { SUI_TYPE } from './networkConfig';

// ─── Constants ──────────────────────────────────────────────────────────

/** Sui framework `Clock` shared object — pass-by-value in every entry call. */
export const CLOCK_ID = '0x6';

// ─── Errors surfaced to the UI ──────────────────────────────────────────

export const PoolErrors = {
  EZeroAmount: 0,
  EZeroDuration: 1,
  EInsufficientLiquidity: 2,
  ELtvExceeded: 3,
  EWrongPool: 4,
  ENotOverdue: 5,
  EUnderpayment: 6,
  EInvalidCap: 7,
  EInsufficientCollateral: 8,
} as const;

// ─── Layer 1 — LP provision (predict::supply / predict::withdraw) ──────

/**
 * Build a PTB that calls `predict::supply<DUSDC>(predict, payment, clock)`
 * to mint PLP against DUSDC. The returned `Coin<PLP>` is auto-
 * transferred to `recipient` — without this the PTB aborts with
 * `UnusedValueWithoutDrop` (Coin has no `drop` ability).
 *
 * `recipient` MUST be an address string (e.g. the connected
 * `account.address`). Passing `tx.gas` as the recipient throws
 * `CommandArgumentError { arg_idx: 1, kind: TypeMismatch }` at PTB
 * resolution — `tx.gas` is a `GasCoin` object reference, not an
 * address.
 *
 * The user has to confirm the Layer-2 stake separately so the two
 * PTBs each get their own wallet signature — the produced PLP sits
 * in the wallet after this tx, NOT auto-staked.
 *
 * `paymentCoinInput` is the result of `tx.object(coinId)` (or a
 * `splitCoins` result) — the caller picks a DUSDC coin object that
 * covers `amount`. Merging is the caller's responsibility (use
 * `mergeCoins` if the wallet has multiple DUSDC objects).
 */
export function buildPredictSupplyTx(args: {
  tx: Transaction;
  predictPackageId: string;
  predictObjectId: string;
  dusdcType: string;
  paymentCoinInput: TransactionArgument;
  recipient: string;
}): void {
  const [plpCoin] = args.tx.moveCall({
    target: `${args.predictPackageId}::predict::supply`,
    typeArguments: [args.dusdcType],
    arguments: [
      args.tx.object(args.predictObjectId),
      args.paymentCoinInput,
      args.tx.object(CLOCK_ID),
    ],
  });
  args.tx.transferObjects([plpCoin], args.recipient);
}

/**
 * Build a PTB that calls `predict::withdraw<DUSDC>(predict, lp, clock)`
 * to burn PLP for DUSDC. The returned `Coin<DUSDC>` is auto-
 * transferred to `recipient` (same UnusedValueWithoutDrop reason as
 * supply above; see `buildPredictSupplyTx` for the `tx.gas` vs
 * address-string distinction).
 */
export function buildPredictWithdrawTx(args: {
  tx: Transaction;
  predictPackageId: string;
  predictObjectId: string;
  dusdcType: string;
  plpCoinInput: TransactionArgument;
  recipient: string;
}): void {
  const [dusdcCoin] = args.tx.moveCall({
    target: `${args.predictPackageId}::predict::withdraw`,
    typeArguments: [args.dusdcType],
    arguments: [
      args.tx.object(args.predictObjectId),
      args.plpCoinInput,
      args.tx.object(CLOCK_ID),
    ],
  });
  args.tx.transferObjects([dusdcCoin], args.recipient);
}

// ─── Layer 2 — DeepWatch pool ───────────────────────────────────────────

/**
 * Build a PTB that calls `pool::stake<T, C>(pool, plp_coin,
 * duration_ms, clock)` and returns the `Subscription` NFT to the
 * sender. `plpCoinInput` is the result of `tx.object(coinId)` for the
 * user's PLP coin.
 *
 * Note: for partial-amount stakes, the caller must `splitCoins` first
 * (the wallet often holds PLP in a single big coin).
 */
export function buildStakeTx(args: {
  tx: Transaction;
  deepwatchPackageId: string;
  poolObjectId: string;
  plpType: string;
  collateralType: string; // type parameter C of Pool<T, C> — kept in the signature even though stake doesn't use it
  plpCoinInput: TransactionArgument;
  durationMs: bigint | number;
  recipient: string;
}): void {
   const [lpCoin] = args.tx.moveCall({
    target: `${args.deepwatchPackageId}::pool::stake`,
    typeArguments: [args.plpType, args.collateralType],
    arguments: [
      args.tx.object(args.poolObjectId),
      args.plpCoinInput,
      args.tx.pure.u64(args.durationMs),
      args.tx.object(CLOCK_ID),
    ],
  });
   args.tx.transferObjects([lpCoin], args.recipient);
}

/**
 * Build a PTB that calls `pool::unstake<T, C>(pool, sub)`. The
 * returned `Coin<T>` (PLP) is auto-transferred to the sender.
 */
export function buildUnstakeTx(args: {
  tx: Transaction;
  deepwatchPackageId: string;
  poolObjectId: string;
  plpType: string;
  collateralType: string;
  subscriptionObjectInput: TransactionArgument;
}): void {
  args.tx.moveCall({
    target: `${args.deepwatchPackageId}::pool::unstake`,
    typeArguments: [args.plpType, args.collateralType],
    arguments: [args.tx.object(args.poolObjectId), args.subscriptionObjectInput],
  });
}

/**
 * Build a PTB that calls `pool::borrow<T, C>(pool, collateral_coin,
 * amount, clock)`. Returns the `Debt` NFT to the sender; the borrowed
 * PLP is auto-transferred to the sender.
 */
export function buildBorrowTx(args: {
  tx: Transaction;
  deepwatchPackageId: string;
  poolObjectId: string;
  plpType: string;
  collateralType: string;
  collateralCoinInput: TransactionArgument;
  borrowAmount: bigint | number;
}): void {
  args.tx.moveCall({
    target: `${args.deepwatchPackageId}::pool::borrow`,
    typeArguments: [args.plpType, args.collateralType],
    arguments: [
      args.tx.object(args.poolObjectId),
      args.collateralCoinInput,
      args.tx.pure.u64(args.borrowAmount),
      args.tx.object(CLOCK_ID),
    ],
  });
}

/**
 * Build a PTB that calls `pool::repay<T, C>(pool, debt, payment,
 * clock)`. Returns the collateral `Coin<C>` (SUI) to the sender.
 */
export function buildRepayTx(args: {
  tx: Transaction;
  deepwatchPackageId: string;
  poolObjectId: string;
  plpType: string;
  collateralType: string;
  debtObjectInput: TransactionArgument;
  paymentCoinInput: TransactionArgument;
}): void {
  args.tx.moveCall({
    target: `${args.deepwatchPackageId}::pool::repay`,
    typeArguments: [args.plpType, args.collateralType],
    arguments: [
      args.tx.object(args.poolObjectId),
      args.debtObjectInput,
      args.paymentCoinInput,
      args.tx.object(CLOCK_ID),
    ],
  });
}

// ─── Read helpers ───────────────────────────────────────────────────────

/**
 * Snapshot of a `Pool<T, C>` shared object as a flat shape the UI
 * can render. Numeric fields are `bigint` (matching Sui RPC
 * conventions for u64 coin amounts); percentages are bps.
 */
export interface PoolSnapshot {
  poolId: string;
  totalShares: bigint;
  treasuryValue: bigint; // PLP available to lend
  collateralValue: bigint; // SUI locked as collateral
  ltvBps: number;
  borrowRateBps: number;
  defaultLoanDurationMs: number;
}

/**
 * Fetch a `Pool<T, C>` shared object via `sui_getObject`. Returns
 * `null` if the object doesn't exist or the RPC payload is
 * malformed. Caller is responsible for the polling interval (see
 * `useDeepWatchPool`).
 */
export async function fetchPoolSnapshot(rpcUrl: string, poolId: string): Promise<PoolSnapshot | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sui_getObject',
        params: [poolId, { showContent: true }],
      }),
    });
    const json = (await res.json()) as {
      result?: { data?: { content?: { dataType?: string; fields?: Record<string, unknown> } } };
      error?: { message?: string };
    };
    const fields = json.result?.data?.content?.fields;
    if (!fields) return null;
    // u64 fields come back as strings ("12345") per Sui RPC; parse safely.
    const u64 = (v: unknown): bigint => {
      if (typeof v === 'string') return BigInt(v);
      if (typeof v === 'number') return BigInt(Math.trunc(v));
      return BigInt(0);
    };
    const u32 = (v: unknown): number => {
      if (typeof v === 'string') return parseInt(v, 10);
      if (typeof v === 'number') return v;
      return 0;
    };
    return {
      poolId,
      totalShares: u64(fields.total_shares),
      treasuryValue: u64(fields.treasury),
      collateralValue: u64(fields.collateral_treasury),
      ltvBps: u32(fields.ltv_bps),
      borrowRateBps: u32(fields.borrow_rate_per_year_bps),
      defaultLoanDurationMs: u32(fields.default_loan_duration_ms),
    };
  } catch (err) {
    console.warn('[deepwatch-pool] fetchPoolSnapshot failed:', err);
    return null;
  }
}

/**
 * List the user's `Subscription` NFTs. We query owned objects and
 * filter by struct type client-side (the RPC type filter is brittle
 * across Sui SDK versions — explicit `nextCursor` paging + filter
 * is the safest).
 */
export async function fetchUserSubscriptions(
  rpcUrl: string,
  owner: string,
  deepwatchPackageId: string,
): Promise<UserSubscription[]> {
  const structType = `${deepwatchPackageId}::subscription::Subscription`;
  const out: UserSubscription[] = [];
  let cursor: string | null = null;
  // Hard cap on pages so a stale `cursor` doesn't loop forever.
  for (let page = 0; page < 10; page++) {
    // `suix_getOwnedObjects` is positional: [address, query, cursor].
    // The first arg MUST be a string (the owner address); the second
    // is the `{ filter, options }` object. Sending them merged as
    // `[{ owner, filter, options }]` makes the first arg a map and
    // the RPC rejects it with `Invalid params: expected a string`.
    // Same pattern as `usePredict.ts:141` for `suix_getCoins`.
    const params: unknown[] = [
      owner,
      { filter: { StructType: structType }, options: { showContent: true } },
    ];
    if (cursor) params.push(cursor);
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'suix_getOwnedObjects',
          params,
        }),
      }); 
      const json = (await res.json()) as {
        result?: {
          data?: Array<{
            objectId: string;
            content?: { dataType?: string; fields?: Record<string, unknown> };
          }>;
          nextCursor?: string | null;
          hasNextPage?: boolean;
        };
      };
  
      const data = json.result?.data ?? [];
       
      
      for (const item of data) {
        // The Sui indexer returns each owned object wrapped in a
        // `{ data: ObjectData }` envelope (the `ObjectResponse::Exists`
        // variant from `sui-core`'s indexer). Older SDKs / RPCs
        // unwrap it; we handle both shapes defensively so a server-side
        // change doesn't break the UI silently.
        const obj = (item as { data?: Record<string, unknown> }).data ?? (item as Record<string, unknown>);
        const fields = (obj.content as { dataType?: string; fields?: Record<string, unknown> } | undefined)?.fields;
        if (!fields) continue;
        const u64 = (v: unknown): bigint =>
          typeof v === 'string' ? BigInt(v) : typeof v === 'number' ? BigInt(Math.trunc(v)) : BigInt(0);
        out.push({
          objectId: typeof obj.objectId === 'string' ? obj.objectId : '',
          poolId: typeof fields.pool_id === 'string' ? fields.pool_id : '',
          owner: typeof fields.owner === 'string' ? fields.owner : '',
          shares: u64(fields.shares),
          depositedAtMs: Number(u64(fields.deposited_at_ms)),
          expiresAtMs: Number(u64(fields.expires_at_ms)),
        });
      }
      cursor = json.result?.nextCursor ?? null;
      if (!cursor || !json.result?.hasNextPage) break;
    } catch (err) {
      console.warn('[deepwatch-pool] fetchUserSubscriptions failed:', err);
      break;
    }
  }
  return out;
}

/** Plain shape used by `useUserPool` to expose the user's stake. */
export interface UserSubscription {
  objectId: string;
  poolId: string;
  owner: string;
  shares: bigint;
  depositedAtMs: number;
  expiresAtMs: number;
}

/** True iff `sub` is non-null and `now < sub.expiresAtMs`. */
export function isSubscriptionValid(sub: UserSubscription | null, nowMs: number): boolean {
  return sub != null && nowMs < sub.expiresAtMs;
}

// ─── Misc ───────────────────────────────────────────────────────────────

/** SUI coin type re-export so consumers don't need to import `networkConfig` twice. */
export { SUI_TYPE };
