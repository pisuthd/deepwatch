// Copyright (c) DeepWatch
// SPDX-License-Identifier: Apache-2.0

/// Unit tests for `deepwatch::pool` and `deepwatch::subscription`.
///
/// Uses two phantom test coin types — `TEST_PLP` for the
/// underlying (where PLP is the real production asset) and
/// `TEST_SUI` for the collateral (where SUI is the real production
/// asset). `coin::create_treasury_cap_for_testing` + `mint_for_testing`
/// produce coins without a real `TreasuryCap` so the tests are
/// hermetic.
///
/// Run with `sui move test` from the `contracts/` directory.
#[test_only]
module deepwatch::pool_tests;

use std::vector;
use sui::clock;
use sui::coin;
use sui::object;
use sui::test_scenario as ts;
use sui::transfer;
use deepwatch::pool::{Self, Pool, PoolCap, Debt};
use deepwatch::subscription::{Self, Subscription};

// ─── Test fixtures ─────────────────────────────────────────────────────

public struct TEST_PLP has drop {}
public struct TEST_SUI has drop {}

const ALICE: address = @0xA;
const BOB: address = @0xB;
const CHARLIE: address = @0xC;
const DAVE: address = @0xD;
const POOL_ADDR: address = @0xCAFE; // address-as-namespace for the test pool

const ONE_PLP: u64 = 1_000_000; // 6 decimals
const ONE_SUI: u64 = 1_000_000_000; // 9 decimals
const DAY_MS: u64 = 24 * 60 * 60 * 1000;
const YEAR_MS: u64 = 365 * DAY_MS;

// ─── Helper: mint a test coin of any type ──────────────────────────────

fun mint_plp(amount: u64, ctx: &mut TxContext): coin::Coin<TEST_PLP> {
    coin::mint_for_testing<TEST_PLP>(amount, ctx)
}

fun mint_sui(amount: u64, ctx: &mut TxContext): coin::Coin<TEST_SUI> {
    coin::mint_for_testing<TEST_SUI>(amount, ctx)
}

// ─── Test 1: Stake and unstake round-trip ──────────────────────────────

#[test]
fun test_stake_unstake_round_trip() {
    let mut scenario = ts::begin(ALICE);
    let cap = pool::create_pool<TEST_PLP, TEST_SUI>(ts::ctx(&mut scenario));
    transfer::public_transfer(cap, ALICE);

    ts::next_tx(&mut scenario, BOB);
    {
        let mut pool = ts::take_shared<Pool<TEST_PLP, TEST_SUI>>(&scenario);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let plp = mint_plp(100 * ONE_PLP, ts::ctx(&mut scenario));
        let sub = pool::stake(&mut pool, plp, 30 * DAY_MS, &clock, ts::ctx(&mut scenario));
        // First staker gets 1:1 shares.
        assert!(subscription::shares(&sub) == 100 * ONE_PLP, 0);
        assert!(subscription::owner(&sub) == BOB, 1);
        assert!(pool::total_shares(&pool) == 100 * ONE_PLP, 2);
        assert!(pool::treasury_value(&pool) == 100 * ONE_PLP, 3);
        // Unstake right away — round-trip works.
        let plp_back = pool::unstake(&mut pool, sub, ts::ctx(&mut scenario));
        assert!(plp_back.value() == 100 * ONE_PLP, 4);
        assert!(pool::total_shares(&pool) == 0, 5);
        assert!(pool::treasury_value(&pool) == 0, 6);
        coin::burn_for_testing(plp_back);
        clock::destroy_for_testing(clock);
        ts::return_shared(pool);
    };
    ts::end(scenario);
}

// ─── Test 2: Two stakers, pro-rata shares ──────────────────────────────

#[test]
fun test_two_stakers_pro_rata() {
    let mut scenario = ts::begin(ALICE);
    let cap = pool::create_pool<TEST_PLP, TEST_SUI>(ts::ctx(&mut scenario));
    transfer::public_transfer(cap, ALICE);

    // BOB stakes 100 PLP first.
    ts::next_tx(&mut scenario, BOB);
    {
        let mut pool = ts::take_shared<Pool<TEST_PLP, TEST_SUI>>(&scenario);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let plp = mint_plp(100 * ONE_PLP, ts::ctx(&mut scenario));
        let sub = pool::stake(&mut pool, plp, 30 * DAY_MS, &clock, ts::ctx(&mut scenario));
        subscription::destroy_for_testing(sub);
        clock::destroy_for_testing(clock);
        ts::return_shared(pool);
    };

    // CHARLIE stakes 50 PLP — should get 50 shares (proportional to 100 underlying, 100 shares).
    ts::next_tx(&mut scenario, CHARLIE);
    {
        let mut pool = ts::take_shared<Pool<TEST_PLP, TEST_SUI>>(&scenario);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let plp = mint_plp(50 * ONE_PLP, ts::ctx(&mut scenario));
        let sub = pool::stake(&mut pool, plp, 30 * DAY_MS, &clock, ts::ctx(&mut scenario));
        assert!(subscription::shares(&sub) == 50 * ONE_PLP, 0);
        assert!(pool::total_shares(&pool) == 150 * ONE_PLP, 1);
        clock::destroy_for_testing(clock);
        // Destroy the subscription we don't need to keep.
        subscription::destroy_for_testing(sub);
        ts::return_shared(pool);
    };
    ts::end(scenario);
}

// ─── Test 3: Borrow happy path + LTV enforcement ──────────────────────

#[test]
fun test_borrow_happy_path() {
    let mut scenario = ts::begin(ALICE);
    let cap = pool::create_pool<TEST_PLP, TEST_SUI>(ts::ctx(&mut scenario));
    transfer::public_transfer(cap, ALICE);

    // BOB stakes 1000 PLP so the pool has liquidity to lend.
    ts::next_tx(&mut scenario, BOB);
    {
        let mut pool = ts::take_shared<Pool<TEST_PLP, TEST_SUI>>(&scenario);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let plp = mint_plp(1_000 * ONE_PLP, ts::ctx(&mut scenario));
        let sub = pool::stake(&mut pool, plp, 30 * DAY_MS, &clock, ts::ctx(&mut scenario));
        subscription::destroy_for_testing(sub);
        clock::destroy_for_testing(clock);
        ts::return_shared(pool);
    };

    // CHARLIE borrows 50 PLP against 100 SUI (LTV 70% allows 70 PLP).
    ts::next_tx(&mut scenario, CHARLIE);
    let debt_id: ID;
    {
        let mut pool = ts::take_shared<Pool<TEST_PLP, TEST_SUI>>(&scenario);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let sui = mint_sui(100 * ONE_SUI, ts::ctx(&mut scenario));
        let debt = pool::borrow(&mut pool, sui, 50 * ONE_PLP, &clock, ts::ctx(&mut scenario));
        assert!(pool::treasury_value(&pool) == 950 * ONE_PLP, 0);
        assert!(pool::collateral_value(&pool) == 100 * ONE_SUI, 1);
        assert!(pool::debt_borrower(&debt) == CHARLIE, 2);
        debt_id = object::id(&debt);
        pool::destroy_debt_for_testing<TEST_PLP, TEST_SUI>(debt);
        clock::destroy_for_testing(clock);
        ts::return_shared(pool);
    };
    // Silence unused-variable warning.
    let _ = debt_id;
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = pool::ELtvExceeded)]
fun test_borrow_ltv_exceeded() {
    let mut scenario = ts::begin(ALICE);
    let cap = pool::create_pool<TEST_PLP, TEST_SUI>(ts::ctx(&mut scenario));
    transfer::public_transfer(cap, ALICE);

    // Stake 1000 PLP so there's liquidity.
    ts::next_tx(&mut scenario, BOB);
    {
        let mut pool = ts::take_shared<Pool<TEST_PLP, TEST_SUI>>(&scenario);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let plp = mint_plp(1_000 * ONE_PLP, ts::ctx(&mut scenario));
        let sub = pool::stake(&mut pool, plp, 30 * DAY_MS, &clock, ts::ctx(&mut scenario));
        subscription::destroy_for_testing(sub);
        clock::destroy_for_testing(clock);
        ts::return_shared(pool);
    };

    // Try to borrow 80_000 PLP against 100 SUI. LTV 70% in raw units
    // → max 70_000_000_000 (= 70 * ONE_SUI). 80_000 PLP = 80_000_000_000
    // raw units → exceeds max → should abort with ELtvExceeded.
    ts::next_tx(&mut scenario, CHARLIE);
    {
        let mut pool = ts::take_shared<Pool<TEST_PLP, TEST_SUI>>(&scenario);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let sui = mint_sui(100 * ONE_SUI, ts::ctx(&mut scenario));
        let debt = pool::borrow(&mut pool, sui, 80_000 * ONE_PLP, &clock, ts::ctx(&mut scenario));
        pool::destroy_debt_for_testing<TEST_PLP, TEST_SUI>(debt);
        clock::destroy_for_testing(clock);
        ts::return_shared(pool);
    };
    ts::end(scenario);
}

// ─── Test 4: Repay with interest ───────────────────────────────────────

#[test]
fun test_repay_with_interest() {
    let mut scenario = ts::begin(ALICE);
    let cap = pool::create_pool<TEST_PLP, TEST_SUI>(ts::ctx(&mut scenario));
    transfer::public_transfer(cap, ALICE);

    // BOB stakes 1000 PLP.
    ts::next_tx(&mut scenario, BOB);
    {
        let mut pool = ts::take_shared<Pool<TEST_PLP, TEST_SUI>>(&scenario);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let plp = mint_plp(1_000 * ONE_PLP, ts::ctx(&mut scenario));
        let sub = pool::stake(&mut pool, plp, 30 * DAY_MS, &clock, ts::ctx(&mut scenario));
        subscription::destroy_for_testing(sub);
        clock::destroy_for_testing(clock);
        ts::return_shared(pool);
    };

    // CHARLIE borrows 100 PLP against 200 SUI (LTV 70% allows 140 PLP, so 100 is fine).
    ts::next_tx(&mut scenario, CHARLIE);
    {
        let mut pool = ts::take_shared<Pool<TEST_PLP, TEST_SUI>>(&scenario);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let sui = mint_sui(200 * ONE_SUI, ts::ctx(&mut scenario));
        let debt = pool::borrow(&mut pool, sui, 100 * ONE_PLP, &clock, ts::ctx(&mut scenario));
        // Advance time by 1 year (the clock here is at 0 ms initially).
        clock::increment_for_testing(&mut clock, YEAR_MS);
        // Repay — interest at 5% APR on 100 PLP for 1 year = 5 PLP.
        let payment = mint_plp(110 * ONE_PLP, ts::ctx(&mut scenario));
        let collateral = pool::repay(&mut pool, debt, payment, &clock, ts::ctx(&mut scenario));
        assert!(collateral.value() == 200 * ONE_SUI, 0);
        // Pool treasury should have 1_000 + 5 = 1_005 PLP (1000 - 100 borrowed + 100 + 5 repaid).
        // Allow a small rounding tolerance on the interest.
        let tv = pool::treasury_value(&pool);
        assert!(tv >= 1_004 * ONE_PLP && tv <= 1_006 * ONE_PLP, 1);
        assert!(pool::collateral_value(&pool) == 0, 2);
        coin::burn_for_testing(collateral);
        clock::destroy_for_testing(clock);
        ts::return_shared(pool);
    };
    ts::end(scenario);
}

// ─── Test 5: Liquidation after due date ────────────────────────────────

#[test]
fun test_liquidation_after_due() {
    let mut scenario = ts::begin(ALICE);
    let cap = pool::create_pool<TEST_PLP, TEST_SUI>(ts::ctx(&mut scenario));
    transfer::public_transfer(cap, ALICE);

    // BOB stakes 1000 PLP.
    ts::next_tx(&mut scenario, BOB);
    {
        let mut pool = ts::take_shared<Pool<TEST_PLP, TEST_SUI>>(&scenario);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let plp = mint_plp(1_000 * ONE_PLP, ts::ctx(&mut scenario));
        let sub = pool::stake(&mut pool, plp, 30 * DAY_MS, &clock, ts::ctx(&mut scenario));
        subscription::destroy_for_testing(sub);
        clock::destroy_for_testing(clock);
        ts::return_shared(pool);
    };

    // CHARLIE borrows 50 PLP against 100 SUI. Default loan duration 30 days.
    ts::next_tx(&mut scenario, CHARLIE);
    let debt_id: ID;
    {
        let mut pool = ts::take_shared<Pool<TEST_PLP, TEST_SUI>>(&scenario);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let sui = mint_sui(100 * ONE_SUI, ts::ctx(&mut scenario));
        let debt = pool::borrow(&mut pool, sui, 50 * ONE_PLP, &clock, ts::ctx(&mut scenario));
        debt_id = object::id(&debt);
        // We can't repay or claim yet — but the debt will go stale. Move it
        // out for the next test step.
        transfer::public_transfer(debt, CHARLIE);
        clock::destroy_for_testing(clock);
        ts::return_shared(pool);
    };
    let _ = debt_id;

    // DAVE liquidates CHARLIE's debt after 31 days. The debt is
    // currently owned by CHARLIE (transferred above), so DAVE can't
    // take_from_sender — we switch to CHARLIE to pull it out of
    // their inventory, then DAVE provides the repayment + receives
    // the collateral as the tx sender.
    ts::next_tx(&mut scenario, CHARLIE);
    {
        let debt = ts::take_from_sender<Debt<TEST_PLP, TEST_SUI>>(&scenario);
        transfer::public_transfer(debt, DAVE);
    };
    ts::next_tx(&mut scenario, DAVE);
    {
        let mut pool = ts::take_shared<Pool<TEST_PLP, TEST_SUI>>(&scenario);
        let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
        clock::increment_for_testing(&mut clock, 31 * DAY_MS);
        let debt = ts::take_from_sender<Debt<TEST_PLP, TEST_SUI>>(&scenario);
        // DAVE pays back the 50 PLP principal.
        let payment = mint_plp(50 * ONE_PLP, ts::ctx(&mut scenario));
        let collateral = pool::claim_collateral(&mut pool, debt, payment, &clock, ts::ctx(&mut scenario));
        assert!(collateral.value() == 100 * ONE_SUI, 0);
        // Pool treasury should be back to ~1000 PLP (50 borrowed + 50 repaid).
        assert!(pool::treasury_value(&pool) == 1_000 * ONE_PLP, 1);
        assert!(pool::collateral_value(&pool) == 0, 2);
        coin::burn_for_testing(collateral);
        clock::destroy_for_testing(clock);
        ts::return_shared(pool);
    };
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = pool::ENotOverdue)]
fun test_liquidation_before_due_fails() {
    let mut scenario = ts::begin(ALICE);
    let cap = pool::create_pool<TEST_PLP, TEST_SUI>(ts::ctx(&mut scenario));
    transfer::public_transfer(cap, ALICE);

    // BOB stakes 1000 PLP.
    ts::next_tx(&mut scenario, BOB);
    {
        let mut pool = ts::take_shared<Pool<TEST_PLP, TEST_SUI>>(&scenario);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let plp = mint_plp(1_000 * ONE_PLP, ts::ctx(&mut scenario));
        let sub = pool::stake(&mut pool, plp, 30 * DAY_MS, &clock, ts::ctx(&mut scenario));
        subscription::destroy_for_testing(sub);
        clock::destroy_for_testing(clock);
        ts::return_shared(pool);
    };

    // CHARLIE borrows.
    ts::next_tx(&mut scenario, CHARLIE);
    {
        let mut pool = ts::take_shared<Pool<TEST_PLP, TEST_SUI>>(&scenario);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let sui = mint_sui(100 * ONE_SUI, ts::ctx(&mut scenario));
        let debt = pool::borrow(&mut pool, sui, 50 * ONE_PLP, &clock, ts::ctx(&mut scenario));
        // Try to liquidate immediately — should fail with ENotOverdue.
        let payment = mint_plp(50 * ONE_PLP, ts::ctx(&mut scenario));
        let collateral = pool::claim_collateral(&mut pool, debt, payment, &clock, ts::ctx(&mut scenario));
        coin::burn_for_testing(collateral);
        clock::destroy_for_testing(clock);
        ts::return_shared(pool);
    };
    ts::end(scenario);
}

// ─── Test 6: admin_seed_borrow + donate (yield bootstrap) ──────────────

#[test]
fun test_admin_seed_borrow_and_donate() {
    let mut scenario = ts::begin(ALICE);
    let cap = pool::create_pool<TEST_PLP, TEST_SUI>(ts::ctx(&mut scenario));

    // BOB stakes 1000 PLP.
    ts::next_tx(&mut scenario, BOB);
    {
        let mut pool = ts::take_shared<Pool<TEST_PLP, TEST_SUI>>(&scenario);
        let clock = clock::create_for_testing(ts::ctx(&mut scenario));
        let plp = mint_plp(1_000 * ONE_PLP, ts::ctx(&mut scenario));
        let sub = pool::stake(&mut pool, plp, 30 * DAY_MS, &clock, ts::ctx(&mut scenario));
        subscription::destroy_for_testing(sub);
        clock::destroy_for_testing(clock);
        ts::return_shared(pool);
    };

    // ALICE (admin) seeds a borrow of 100 PLP, then donates 110 PLP
    // back to simulate 10% yield.
    ts::next_tx(&mut scenario, ALICE);
    {
        let mut pool = ts::take_shared<Pool<TEST_PLP, TEST_SUI>>(&scenario);
        pool::admin_seed_borrow<TEST_PLP, TEST_SUI>(&cap, &mut pool, 100 * ONE_PLP, ts::ctx(&mut scenario));
        assert!(pool::treasury_value(&pool) == 900 * ONE_PLP, 0);

        // Now donate 110 PLP (simulating 10% yield from the seeded position).
        let yield_coin = mint_plp(110 * ONE_PLP, ts::ctx(&mut scenario));
        pool::donate<TEST_PLP, TEST_SUI>(&mut pool, yield_coin);
        assert!(pool::treasury_value(&pool) == 1_010 * ONE_PLP, 1);
        ts::return_shared(pool);
    };

    pool::destroy_cap_for_testing(cap);
    ts::end(scenario);
}

// ─── Test 7: seal_approve success / wrong owner / expired / wrong ns ─

#[test]
fun test_seal_approve_success() {
    let mut scenario = ts::begin(ALICE);
    let pool_id = subscription::new_id_for_testing(POOL_ADDR);
    let sub = subscription::new_for_testing(
        pool_id,
        BOB,
        100 * ONE_PLP,
        0,
        DAY_MS,
        ts::ctx(&mut scenario),
    );
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));
    // Build a key-id that starts with the pool's namespace bytes.
    let pool_bytes = object::id_to_bytes(&pool_id);
    let mut key_id = pool_bytes;
    vector::append(&mut key_id, b"random-nonce");
    // Switch sender to BOB (the owner) so the owner check passes.
    ts::next_tx(&mut scenario, BOB);
    // Call as BOB (the owner). Should NOT abort.
    subscription::seal_approve_for_testing(key_id, &sub, &clock, ts::ctx(&mut scenario));
    clock::destroy_for_testing(clock);
    subscription::destroy_for_testing(sub);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = subscription::EWrongOwner)]
fun test_seal_approve_wrong_owner() {
    let mut scenario = ts::begin(ALICE);
    let pool_id = subscription::new_id_for_testing(POOL_ADDR);
    let sub = subscription::new_for_testing(
        pool_id,
        BOB, // owner
        100 * ONE_PLP,
        0,
        DAY_MS,
        ts::ctx(&mut scenario),
    );
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));
    let pool_bytes = object::id_to_bytes(&pool_id);
    let mut key_id = pool_bytes;
    vector::append(&mut key_id, b"random-nonce");
    // Call as CHARLIE (not the owner) — should abort with EWrongOwner.
    ts::next_tx(&mut scenario, CHARLIE);
    subscription::seal_approve_for_testing(key_id, &sub, &clock, ts::ctx(&mut scenario));
    clock::destroy_for_testing(clock);
    subscription::destroy_for_testing(sub);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = subscription::EExpired)]
fun test_seal_approve_expired() {
    let mut scenario = ts::begin(ALICE);
    let pool_id = subscription::new_id_for_testing(POOL_ADDR);
    let sub = subscription::new_for_testing(
        pool_id,
        BOB,
        100 * ONE_PLP,
        0,
        DAY_MS, // expires after 1 day
        ts::ctx(&mut scenario),
    );
    let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
    clock::increment_for_testing(&mut clock, 2 * DAY_MS); // advance past expiry
    let pool_bytes = object::id_to_bytes(&pool_id);
    let mut key_id = pool_bytes;
    vector::append(&mut key_id, b"random-nonce");
    subscription::seal_approve_for_testing(key_id, &sub, &clock, ts::ctx(&mut scenario));
    clock::destroy_for_testing(clock);
    subscription::destroy_for_testing(sub);
    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = subscription::ENoAccess)]
fun test_seal_approve_wrong_namespace() {
    let mut scenario = ts::begin(ALICE);
    let pool_id = subscription::new_id_for_testing(POOL_ADDR);
    let sub = subscription::new_for_testing(
        pool_id,
        BOB,
        100 * ONE_PLP,
        0,
        DAY_MS,
        ts::ctx(&mut scenario),
    );
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));
    // Use a key-id that does NOT start with the pool's bytes.
    let bad_key_id: vector<u8> = b"some-other-namespace";
    subscription::seal_approve_for_testing(bad_key_id, &sub, &clock, ts::ctx(&mut scenario));
    clock::destroy_for_testing(clock);
    subscription::destroy_for_testing(sub);
    ts::end(scenario);
}
