// Copyright (c) DeepWatch
// SPDX-License-Identifier: Apache-2.0

/// `deepwatch::subscription` — non-transferable access NFT for the
/// DeepWatch pool. Minted by `deepwatch::pool::stake` when a user
/// deposits PLP into the second-layer pool; burned by
/// `deepwatch::pool::unstake` when the user withdraws.
///
/// The struct is `key + store` (not `key + store + drop`) so that it
/// cannot be silently discarded — the only way to get rid of one is
/// to call `pool::unstake` and return the underlying PLP. There is
/// **no** `public fun transfer` (unlike `walrus::subscription`) — the
/// NFT dies with the stake. This is a deliberate design choice for
/// the staking use case: we don't want users to sell access rights
/// separately from the underlying PLP at risk.
///
/// # Seal access
///
/// `seal_approve` is the entry function called by Seal key servers
/// when a user attempts to decrypt a blob that was encrypted under
/// this subscription's pool namespace. It asserts three things:
///
///   1. **Namespace** — the Seal key-id (`vector<u8>`) starts with
///      the `pool_id` bytes. This means the blob was encrypted with
///      a key derived from the pool the subscription belongs to.
///   2. **Ownership** — `ctx.sender()` matches `sub.owner`. The
///      subscription can only be used by the wallet that staked.
///   3. **Freshness** — `clock::now_ms()` is strictly before
///      `sub.expires_at_ms`. Once the time window has passed, the
///      subscription can no longer decrypt; the user must re-stake
///      to renew.
///
/// The `is_prefix` helper is a private byte-comparison utility,
/// copied from the seal_examples pattern (`walrus::utils::is_prefix`)
/// so this module is self-contained — no external Move deps beyond
/// Sui framework.
module deepwatch::subscription;

use sui::clock::Clock;

const ENoAccess: u64 = 0;
const EExpired: u64 = 1;
const EWrongOwner: u64 = 2;

// ─── Struct ────────────────────────────────────────────────────────────

/// A non-transferable access right issued by the DeepWatch pool.
///
/// Lifetime: minted on `pool::stake`, burned on `pool::unstake`.
/// The `owner` field is set at mint time and never changes.
public struct Subscription has key, store {
    id: UID,
    /// The `Pool` this subscription grants access to. Used as the
    /// Seal namespace — only blobs encrypted under this pool's
    /// key-id can be decrypted by this subscription.
    pool_id: ID,
    /// The wallet address that staked the PLP. Compared against
    /// `ctx.sender()` in `seal_approve`.
    owner: address,
    /// Proportional claim on the pool's underlying PLP. Burned on
    /// unstake. Staker receives
    /// `shares * pool.total_plp_underlying / pool.total_shares` PLP
    /// back (plus accrued interest, baked into the same ratio).
    shares: u64,
    /// Unix ms timestamp of the mint.
    deposited_at_ms: u64,
    /// Unix ms timestamp after which `seal_approve` will reject. Set
    /// to `deposited_at_ms + duration_ms` at mint time.
    expires_at_ms: u64,
}

// ─── Public accessors ──────────────────────────────────────────────────

public fun pool_id(sub: &Subscription): ID { sub.pool_id }
public fun owner(sub: &Subscription): address { sub.owner }
public fun shares(sub: &Subscription): u64 { sub.shares }
public fun deposited_at_ms(sub: &Subscription): u64 { sub.deposited_at_ms }
public fun expires_at_ms(sub: &Subscription): u64 { sub.expires_at_ms }

/// True iff `now_ms` is strictly before `sub.expires_at_ms`.
public fun is_valid(sub: &Subscription, now_ms: u64): bool {
    now_ms < sub.expires_at_ms
}

// ─── Seal access check ─────────────────────────────────────────────────

/// Seal access gate. Called by the Seal key server as part of
/// `sealClient.fetchKeys({ ids, txBytes, sessionKey, threshold })`
/// — the key server simulates this PTB and refuses to release its
/// key share if it aborts.
///
/// Aborts (in priority order):
///   - `ENoAccess` if the key-id does not start with the pool's
///     namespace bytes (blob was encrypted under a different pool
///     or no pool at all).
///   - `EWrongOwner` if `ctx.sender()` is not the subscription
///     owner.
///   - `EExpired` if the subscription's time window has elapsed.
entry fun seal_approve(
    id: vector<u8>,
    sub: &Subscription,
    c: &Clock,
    ctx: &TxContext,
) {
    // Order: namespace → expiry → owner. Cheapest checks first; also
    // means a stale-but-owned subscription is rejected before we leak
    // ownership info.
    let pool_bytes = object::id_to_bytes(&sub.pool_id);
    assert!(is_prefix(pool_bytes, id), ENoAccess);
    assert!(c.timestamp_ms() < sub.expires_at_ms, EExpired);
    assert!(sub.owner == ctx.sender(), EWrongOwner);
}

// ─── Friend-module constructors / destructors ──────────────────────────

/// Mint a new `Subscription`. Restricted to the `deepwatch` package
/// so only `pool::stake` can mint — the rest of the world must go
/// through `pool::stake` (which enforces the share math and the
/// expiry window). Returns the freshly-minted NFT; the caller is
/// responsible for transferring it to the staker.
public(package) fun new(
    pool_id: ID,
    owner: address,
    shares: u64,
    deposited_at_ms: u64,
    expires_at_ms: u64,
    ctx: &mut TxContext,
): Subscription {
    Subscription {
        id: object::new(ctx),
        pool_id,
        owner,
        shares,
        deposited_at_ms,
        expires_at_ms,
    }
}

/// Burn a `Subscription` and return its `shares` and `pool_id`. Used
/// by `pool::unstake` — the only legitimate way to destroy a
/// subscription. The `object::delete` is performed here (in the
/// defining module) so the `Subscription`'s `UID` can be safely
/// unpacked.
public(package) fun destroy(sub: Subscription): (u64, ID) {
    let Subscription { id, pool_id, owner: _, shares, deposited_at_ms: _, expires_at_ms: _ } = sub;
    object::delete(id);
    (shares, pool_id)
}

// ─── Internal helpers ──────────────────────────────────────────────────

/// True iff `prefix` is a byte-prefix of `word`. Same algorithm
/// as `walrus::utils::is_prefix` (seal_examples reference). Copied
/// here to keep this module self-contained.
fun is_prefix(prefix: vector<u8>, word: vector<u8>): bool {
    let n = prefix.length();
    if (n > word.length()) return false;
    let mut i = 0;
    while (i < n) {
        if (prefix[i] != word[i]) return false;
        i = i + 1;
    };
    true
}

// ─── Test-only constructors ───────────────────────────────────────────

#[test_only]
public fun new_for_testing(
    pool_id: ID,
    owner: address,
    shares: u64,
    deposited_at_ms: u64,
    expires_at_ms: u64,
    ctx: &mut TxContext,
): Subscription {
    Subscription {
        id: object::new(ctx),
        pool_id,
        owner,
        shares,
        deposited_at_ms,
        expires_at_ms,
    }
}

#[test_only]
public fun destroy_for_testing(sub: Subscription) {
    let Subscription { id, .. } = sub;
    object::delete(id);
}

#[test_only]
public fun new_id_for_testing(addr: address): ID {
    object::id_from_address(addr)
}

/// Test-only wrapper around the `entry fun seal_approve` so unit
/// tests can call it directly (entry funs can only be invoked from
/// a transaction context, not from another Move fun). The
/// production code path is the entry fun; this wrapper just
/// forwards.
#[test_only]
public fun seal_approve_for_testing(
    id: vector<u8>,
    sub: &Subscription,
    c: &Clock,
    ctx: &TxContext,
) {
    seal_approve(id, sub, c, ctx)
}
