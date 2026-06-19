// Copyright (c) DeepWatch
// SPDX-License-Identifier: Apache-2.0

/// `deepwatch::pool` — second-layer staking + lending pool that
/// sits on top of the Predict protocol's PLP LP token.
///
/// # What it does
///
/// Users stake PLP (the LP share token of the predict protocol)
/// into the pool and receive a non-transferable `Subscription` NFT
/// in return. The subscription grants time-bounded access to
/// Seal-decrypted AI insights (see `deepwatch::subscription`).
///
/// The pool also runs a simple collateralized lending market on
/// the staked PLP: borrowers post SUI as collateral and borrow PLP.
/// Interest paid by borrowers accrues to the pool's underlying
/// PLP balance, so existing stakers receive a pro-rata share of
/// the yield when they unstake.
///
/// # Hackathon scope
///
/// This is the v1 hackathon implementation. Known limitations:
///
///   1. **Single collateral type per pool** — accepted via the `C`
///      generic. SUI is the v1 choice (most liquid on Sui testnet).
///      Multi-collateral is v1.1.
///   2. **No price oracle** — LTV is enforced in raw coin units
///      (`borrow_amount ≤ collateral_amount * ltv_bps / 10_000`),
///      not in USD. Fine for hackathon demo; production needs an
///      oracle.
///   3. **`admin_seed_borrow` + `donate` exist for the demo** —
///      to bootstrap yield in the absence of real borrowers, the
///      admin can pull PLP out of the pool (`admin_seed_borrow`)
///      and put it back later (`donate`). These functions are
///      gated by `PoolCap` and clearly named — production should
///      remove or restrict them.
///   4. **No re-entrancy guards** — Sui's owned-object model
///      already prevents most re-entrancy; the remaining risk
///      (a `Coin<T>` passed in and the matching state update) is
///      bounded by Move's linear type system.
module deepwatch::pool;

use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::transfer;
use sui::tx_context::TxContext;
use deepwatch::subscription::{Self, Subscription};

// ─── Constants ─────────────────────────────────────────────────────────

const MS_PER_YEAR: u128 = 31_536_000_000; // 365 * 24 * 60 * 60 * 1000
const BPS_DENOM: u128 = 10_000;

// ─── Errors ────────────────────────────────────────────────────────────

const EZeroAmount: u64 = 0;
const EZeroDuration: u64 = 1;
const EInsufficientLiquidity: u64 = 2;
const ELtvExceeded: u64 = 3;
const EWrongPool: u64 = 4;
const ENotOverdue: u64 = 5;
const EUnderpayment: u64 = 6;
const EInvalidCap: u64 = 7;
const EInsufficientCollateral: u64 = 8;

// ─── Default parameters (overridable at init) ─────────────────────────

const DEFAULT_LTV_BPS: u64 = 7_000; // 70%
const DEFAULT_BORROW_RATE_BPS: u64 = 500; // 5% APR
const DEFAULT_LOAN_DURATION_MS: u64 = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_DURATION_MS: u64 = 1_000; // 1 second (sanity check)

// ─── Structs ───────────────────────────────────────────────────────────

/// The shared staking + lending pool. Generic over the underlying
/// asset type `T` (PLP in production) and the collateral type `C`
/// (SUI in production). Both type params are `phantom` — they
/// don't appear as fields, only as `Balance` type parameters.
public struct Pool<phantom T, phantom C> has key, store {
    id: UID,
    /// Staked PLP minus outstanding loans. Grows when stakers
    /// deposit and when borrowers repay; shrinks when stakers
    /// unstake and when borrowers draw.
    treasury: Balance<T>,
    /// Locked SUI collateral. Returned to borrowers on successful
    /// repay or to liquidators on overdue-claim.
    collateral_treasury: Balance<C>,
    /// Total outstanding shares. One share ≈ 1 unit of underlying
    /// at the moment of first stake.
    total_shares: u64,
    /// Loan-to-value in basis points (10_000 = 100%). Default 7_000.
    ltv_bps: u64,
    /// Borrow rate in basis points per year. Default 500 (5% APR).
    borrow_rate_per_year_bps: u64,
    /// Default loan duration in ms. Default 30 days.
    default_loan_duration_ms: u64,
    /// Pool admin. Holds the `PoolCap` and can change params.
    admin: address,
}

/// Admin capability for a specific `Pool` instance.
public struct PoolCap has key, store {
    id: UID,
    pool_id: ID,
}

/// Per-borrower debt position. Burns on repay or claim.
public struct Debt<phantom T, phantom C> has key, store {
    id: UID,
    pool_id: ID,
    borrower: address,
    principal: u64,
    collateral_amount: u64,
    borrowed_at_ms: u64,
    due_at_ms: u64,
}

// ─── Constructor ───────────────────────────────────────────────────────

/// Create a new pool with default parameters (LTV 70%, rate 5% APR,
/// loan duration 30 days) and return the admin `PoolCap`. The pool
/// itself is shared immediately so anyone can interact with it.
public fun create_pool<T, C>(ctx: &mut TxContext): PoolCap {
    create_pool_with_params<T, C>(
        DEFAULT_LTV_BPS,
        DEFAULT_BORROW_RATE_BPS,
        DEFAULT_LOAN_DURATION_MS,
        ctx,
    )
}

/// Same as `create_pool` but with explicit parameters. Useful for
/// tests and for the admin to spin up specialized pools later.
public fun create_pool_with_params<T, C>(
    ltv_bps: u64,
    borrow_rate_per_year_bps: u64,
    default_loan_duration_ms: u64,
    ctx: &mut TxContext,
): PoolCap {
    let pool = Pool<T, C> {
        id: object::new(ctx),
        treasury: balance::zero<T>(),
        collateral_treasury: balance::zero<C>(),
        total_shares: 0,
        ltv_bps,
        borrow_rate_per_year_bps,
        default_loan_duration_ms,
        admin: ctx.sender(),
    };
    let cap = PoolCap {
        id: object::new(ctx),
        pool_id: object::id(&pool),
    };
    transfer::share_object(pool);
    cap
}

/// Entry wrapper around `create_pool` so the admin can initialize a
/// pool via a single `sui client call` tx (no PTB needed). The pool
/// is shared inside `create_pool`; this function additionally transfers
/// the admin `PoolCap` to the sender's wallet. Default parameters
/// (LTV 70%, rate 5% APR, 30-day loans) — use `init_pool_with_params`
/// for custom values.
public entry fun init_pool<T, C>(ctx: &mut TxContext) {
    let cap = create_pool<T, C>(ctx);
    transfer::public_transfer(cap, ctx.sender());
}

/// Entry wrapper around `create_pool_with_params`. Same as `init_pool`
/// but with explicit LTV / rate / loan-duration overrides.
public entry fun init_pool_with_params<T, C>(
    ltv_bps: u64,
    borrow_rate_per_year_bps: u64,
    default_loan_duration_ms: u64,
    ctx: &mut TxContext,
) {
    let cap = create_pool_with_params<T, C>(
        ltv_bps,
        borrow_rate_per_year_bps,
        default_loan_duration_ms,
        ctx,
    );
    transfer::public_transfer(cap, ctx.sender());
}

// ─── Staking ───────────────────────────────────────────────────────────

/// Stake `plp_coin` into the pool for `duration_ms` and receive a
/// `Subscription` NFT granting access to encrypted AI insights for
/// that window. The staker's pro-rata claim on the pool is tracked
/// via the NFT's `shares` field.
///
/// First staker: shares = `plp_coin.value()` (1:1, since
/// `total_shares = 0`). Subsequent stakers: shares = `plp_coin *
/// total_shares / total_plp_underlying` (proportional).
public fun stake<T, C>(
    pool: &mut Pool<T, C>,
    plp_coin: Coin<T>,
    duration_ms: u64,
    c: &Clock,
    ctx: &mut TxContext,
): Subscription {
    let amount = plp_coin.value();
    assert!(amount > 0, EZeroAmount);
    assert!(duration_ms >= MIN_DURATION_MS, EZeroDuration);

    let underlying = pool.treasury.value();
    let new_shares = if (pool.total_shares == 0 || underlying == 0) {
        amount
    } else {
        // Math is safe: amount * total_shares, both u64, max ≈ 1.8e19
        // (amount capped by tx context size, total_shares capped by
        // total PLP ever staked which is bounded by Sui supply).
        ((((amount as u128) * (pool.total_shares as u128)) / (underlying as u128)) as u64)
    };

    coin::put(&mut pool.treasury, plp_coin);
    pool.total_shares = pool.total_shares + new_shares;

    let now = c.timestamp_ms();
    subscription::new(
        object::id(pool),
        ctx.sender(),
        new_shares,
        now,
        now + duration_ms,
        ctx,
    )
}

/// Unstake: burn the subscription, return the user's pro-rata
/// PLP. PLP returned = `shares * total_underlying / total_shares`.
///
/// The user can unstake at any time (even before `expires_at_ms`)
/// — the subscription dies either way. The seal access is
/// automatically revoked because the `Subscription` object is gone.
public fun unstake<T, C>(
    pool: &mut Pool<T, C>,
    sub: Subscription,
    ctx: &mut TxContext,
): Coin<T> {
    // Sanity: subscription must belong to this pool.
    assert!(subscription::pool_id(&sub) == object::id(pool), EWrongPool);

    let (shares, _) = subscription::destroy(sub);

    let underlying = pool.treasury.value();
    let payout = if (pool.total_shares == 0) {
        0
    } else {
        // Same safe-math reasoning as `stake`.
        ((((shares as u128) * (underlying as u128)) / (pool.total_shares as u128)) as u64)
    };
    pool.total_shares = pool.total_shares - shares;

    coin::take(&mut pool.treasury, payout, ctx)
}

// ─── Lending ───────────────────────────────────────────────────────────

/// Borrow `borrow_amount` of `T` (PLP) from the pool against
/// `collateral_coin` of type `C` (SUI). LTV is enforced in raw
/// coin units: `borrow_amount <= collateral_amount * ltv_bps / 10_000`.
///
/// Returns a `Debt` NFT. The borrower must call `repay` before
/// `debt.due_at_ms` to get their collateral back; after that, any
/// wallet can call `claim_collateral` to liquidate.
public fun borrow<T, C>(
    pool: &mut Pool<T, C>,
    collateral_coin: Coin<C>,
    borrow_amount: u64,
    c: &Clock,
    ctx: &mut TxContext,
): Debt<T, C> {
    assert!(borrow_amount > 0, EZeroAmount);
    let collateral_amount = collateral_coin.value();
    assert!(collateral_amount > 0, EInsufficientCollateral);

    // LTV check: borrow_amount <= collateral_amount * ltv_bps / 10_000
    let max_borrow = ((((collateral_amount as u128) * (pool.ltv_bps as u128)) / BPS_DENOM) as u64);
    assert!(borrow_amount <= max_borrow, ELtvExceeded);

    // Move collateral into the pool's collateral_treasury.
    coin::put(&mut pool.collateral_treasury, collateral_coin);

    // Pull PLP out of the pool's treasury.
    assert!(pool.treasury.value() >= borrow_amount, EInsufficientLiquidity);
    let plp_coin = coin::take(&mut pool.treasury, borrow_amount, ctx);
    transfer::public_transfer(plp_coin, ctx.sender());

    Debt<T, C> {
        id: object::new(ctx),
        pool_id: object::id(pool),
        borrower: ctx.sender(),
        principal: borrow_amount,
        collateral_amount,
        borrowed_at_ms: c.timestamp_ms(),
        due_at_ms: c.timestamp_ms() + pool.default_loan_duration_ms,
    }
}

/// Repay a debt. `payment_coin` must cover `principal + interest`;
/// any excess is returned to the caller as a separate `Coin<T>`.
/// Burns the debt NFT and returns the locked collateral.
public fun repay<T, C>(
    pool: &mut Pool<T, C>,
    debt: Debt<T, C>,
    mut payment_coin: Coin<T>,
    c: &Clock,
    ctx: &mut TxContext,
): Coin<C> {
    assert!(object::id(pool) == debt.pool_id, EWrongPool);

    let interest = compute_interest(
        debt.principal,
        pool.borrow_rate_per_year_bps,
        c.timestamp_ms() - debt.borrowed_at_ms,
    );
    let total_owed = debt.principal + interest;
    let payment_amount = payment_coin.value();
    assert!(payment_amount >= total_owed, EUnderpayment);

    // Burn the debt.
    let Debt { id, pool_id: _, borrower: _, principal: _, collateral_amount, borrowed_at_ms: _, due_at_ms: _ } = debt;
    object::delete(id);

    // Take owed from payment, return excess to the caller.
    let owed_coin = coin::split(&mut payment_coin, total_owed, ctx);
    if (payment_coin.value() > 0) {
        transfer::public_transfer(payment_coin, ctx.sender());
    } else {
        coin::destroy_zero(payment_coin);
    };
    // Add owed (principal + interest) back into the pool's treasury.
    coin::put(&mut pool.treasury, owed_coin);

    // Return collateral.
    coin::take(&mut pool.collateral_treasury, collateral_amount, ctx)
}

/// Liquidate an overdue debt. Anyone can call this once
/// `debt.due_at_ms < now`. The collateral is transferred to the
/// liquidator (caller); the principal (without interest) is taken
/// from the liquidator's `repayment_coin` and returned to the pool.
/// The collateral covers the unpaid principal in this simplified
/// design — no auction, no bonus. (v1 hackathon simplification.)
public fun claim_collateral<T, C>(
    pool: &mut Pool<T, C>,
    debt: Debt<T, C>,
    mut repayment_coin: Coin<T>,
    c: &Clock,
    ctx: &mut TxContext,
): Coin<C> {
    assert!(object::id(pool) == debt.pool_id, EWrongPool);
    assert!(c.timestamp_ms() > debt.due_at_ms, ENotOverdue);

    let Debt { id, pool_id: _, borrower: _, principal, collateral_amount, borrowed_at_ms: _, due_at_ms: _ } = debt;
    object::delete(id);

    // Liquidator pays the original principal back to the pool.
    assert!(repayment_coin.value() >= principal, EUnderpayment);
    let principal_coin = coin::split(&mut repayment_coin, principal, ctx);
    if (repayment_coin.value() > 0) {
        transfer::public_transfer(repayment_coin, ctx.sender());
    } else {
        coin::destroy_zero(repayment_coin);
    };
    coin::put(&mut pool.treasury, principal_coin);

    // Liquidator gets the full collateral.
    coin::take(&mut pool.collateral_treasury, collateral_amount, ctx)
}

// ─── Admin-only functions ─────────────────────────────────────────────

/// Hackathon demo: pull `amount` of `T` out of the pool's
/// treasury and send it to the admin. Used to seed yield by
/// letting the admin later `donate` it back (with simulated
/// interest). Gated by `PoolCap`. Should be removed (or
/// restricted to a multisig) for production.
public fun admin_seed_borrow<T, C>(
    cap: &PoolCap,
    pool: &mut Pool<T, C>,
    amount: u64,
    ctx: &mut TxContext,
) {
    assert!(cap.pool_id == object::id(pool), EInvalidCap);
    assert!(amount > 0, EZeroAmount);
    assert!(pool.treasury.value() >= amount, EInsufficientLiquidity);
    let coin = coin::take(&mut pool.treasury, amount, ctx);
    transfer::public_transfer(coin, ctx.sender());
}

/// Anyone can donate `T` to the pool (no cap). Used by the admin
/// to "repay" their `admin_seed_borrow` with interest.
public fun donate<T, C>(pool: &mut Pool<T, C>, coin: Coin<T>) {
    coin::put(&mut pool.treasury, coin);
}

public fun set_ltv_bps<T, C>(cap: &PoolCap, pool: &mut Pool<T, C>, ltv_bps: u64) {
    assert!(cap.pool_id == object::id(pool), EInvalidCap);
    pool.ltv_bps = ltv_bps;
}

public fun set_borrow_rate_bps<T, C>(cap: &PoolCap, pool: &mut Pool<T, C>, rate_bps: u64) {
    assert!(cap.pool_id == object::id(pool), EInvalidCap);
    pool.borrow_rate_per_year_bps = rate_bps;
}

// ─── Public accessors (for frontend reads) ─────────────────────────────

public fun pool_id<T, C>(pool: &Pool<T, C>): ID { object::id(pool) }
public fun total_shares<T, C>(pool: &Pool<T, C>): u64 { pool.total_shares }
public fun treasury_value<T, C>(pool: &Pool<T, C>): u64 { pool.treasury.value() }
public fun collateral_value<T, C>(pool: &Pool<T, C>): u64 { pool.collateral_treasury.value() }
public fun ltv_bps<T, C>(pool: &Pool<T, C>): u64 { pool.ltv_bps }
public fun borrow_rate_bps<T, C>(pool: &Pool<T, C>): u64 { pool.borrow_rate_per_year_bps }
public fun default_loan_duration_ms<T, C>(pool: &Pool<T, C>): u64 { pool.default_loan_duration_ms }

public fun debt_borrower<T, C>(debt: &Debt<T, C>): address { debt.borrower }
public fun debt_principal<T, C>(debt: &Debt<T, C>): u64 { debt.principal }
public fun debt_collateral_amount<T, C>(debt: &Debt<T, C>): u64 { debt.collateral_amount }
public fun debt_borrowed_at_ms<T, C>(debt: &Debt<T, C>): u64 { debt.borrowed_at_ms }
public fun debt_due_at_ms<T, C>(debt: &Debt<T, C>): u64 { debt.due_at_ms }
public fun debt_pool_id<T, C>(debt: &Debt<T, C>): ID { debt.pool_id }

// ─── Internal helpers ──────────────────────────────────────────────────

/// Linear interest: `principal * rate_bps * elapsed_ms / (10_000 * ms_per_year)`.
/// Uses u128 for the intermediate product to avoid u64 overflow on
/// large principals or long durations.
fun compute_interest(principal: u64, rate_bps: u64, elapsed_ms: u64): u64 {
    let p = principal as u128;
    let r = rate_bps as u128;
    let e = elapsed_ms as u128;
    let owed = (p * r * e) / (BPS_DENOM * MS_PER_YEAR);
    (owed as u64)
}

// ─── Test-only helpers ─────────────────────────────────────────────────

#[test_only]
public fun new_debt_for_testing<T, C>(
    pool_id: ID,
    borrower: address,
    principal: u64,
    collateral_amount: u64,
    borrowed_at_ms: u64,
    due_at_ms: u64,
    ctx: &mut TxContext,
): Debt<T, C> {
    Debt<T, C> {
        id: object::new(ctx),
        pool_id,
        borrower,
        principal,
        collateral_amount,
        borrowed_at_ms,
        due_at_ms,
    }
}

#[test_only]
public fun destroy_debt_for_testing<T, C>(debt: Debt<T, C>) {
    let Debt { id, .. } = debt;
    object::delete(id);
}

#[test_only]
public fun destroy_cap_for_testing(cap: PoolCap) {
    let PoolCap { id, .. } = cap;
    object::delete(id);
}
