/**
 * Smoke-test the Mysten Predict server (DeepBook Predict) from your local
 * machine. Mirrors the call the fetch-markets Lambda makes, so you can
 * verify network reachability and response shape before deploying.
 *
 *   npx tsx scripts/test-deepbook.ts
 */

import { generateRangeBands } from "../lib/markets/format";
import { impliedProbUpForRange, impliedProbUpForStrike, type SVIParams } from "../lib/markets/svi";

const BASE = "https://predict-server.testnet.mystenlabs.com";
const TIMEOUT_MS = 20_000;

// 24h from now — pick a near-dated oracle-like expiry to get non-degenerate T.
const NEAR_EXPIRY_MS = Date.now() + 24 * 60 * 60 * 1000;
const FAR_EXPIRY_MS = Date.now() + 7 * 24 * 60 * 60 * 1000;

// Default SVI (mirrors the fallback in lib/markets/svi.ts).
const DEFAULT_SVI: SVIParams = {
  a: 80887,
  b: 9328786,
  rho: 102029829,
  m: 7561599,
  sigma: 9522806,
};

async function main() {
  // Step 1: list all oracles (lightweight)
  const oraclesUrl = `${BASE}/oracles`;
  console.log(`[deepbook] GET ${oraclesUrl}`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(oraclesUrl, {
      headers: { accept: "application/json" },
      signal: ctrl.signal,
    });
    const elapsed = Date.now() - t0;
    console.log(`[deepbook] HTTP ${res.status} in ${elapsed}ms`);

    if (!res.ok) {
      const body = await res.text().catch(() => "<no body>");
      console.error(`[deepbook] FAIL — status ${res.status}`);
      console.error(body.slice(0, 500));
      process.exit(1);
    }

    const oracles = (await res.json()) as Array<{
      predict_id: string;
      oracle_id: string;
      underlying_asset: string;
      expiry: number;
      status: string;
    }>;
    console.log(`[deepbook] received ${oracles.length} oracles`);

    if (oracles.length === 0) {
      console.warn("[deepbook] WARNING — empty oracle list");
    } else {
      // The production deepbook fetcher (lib/markets/deepbook.ts) skips
      // "settled" oracles and hits the state endpoint at
      //   /oracles/{oracle_id}/state
      // (note: oracle_id, not predict_id). Mirror that here so the second
      // hop exercises the same code path that actually works in prod.
      const live = oracles.find((x) => x.status !== "settled");
      const o = live ?? oracles[0];
      console.log(`[deepbook] picked oracle (status=${o.status}):`);
      console.log(JSON.stringify({
        predict_id: o.predict_id,
        oracle_id: o.oracle_id,
        underlying_asset: o.underlying_asset,
        expiry: o.expiry,
        status: o.status,
      }, null, 2));

      // Step 2: fetch state using oracle_id (matches production).
      const stateUrl = `${BASE}/oracles/${o.oracle_id}/state`;
      console.log(`[deepbook] GET ${stateUrl}`);
      const t1 = Date.now();
      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), TIMEOUT_MS);
      try {
        const r2 = await fetch(stateUrl, {
          headers: { accept: "application/json" },
          signal: ctrl2.signal,
        });
        console.log(`[deepbook] HTTP ${r2.status} in ${Date.now() - t1}ms`);
        if (r2.ok) {
          const state = await r2.json();
          console.log(`[deepbook] state keys:`, Object.keys(state).slice(0, 20));
        } else {
          console.warn(`[deepbook] state fetch returned ${r2.status} (non-fatal)`);
        }
      } catch (e2) {
        console.warn(`[deepbook] state fetch FAIL — ${e2 instanceof Error ? e2.message : String(e2)} (non-fatal)`);
      } finally {
        clearTimeout(t2);
      }
    }
    console.log(`[deepbook] OK`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[deepbook] FAIL — ${msg}`);
    if (msg.includes("abort")) {
      console.error(`  (timed out after ${TIMEOUT_MS}ms — network/DNS issue?)`);
    }
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
}

main();

/**
 * Offline sanity check for the math helpers — runs even when the network
 * fetch above is skipped because there are no live oracles. Uses a
 * plausible BTC price + forward. Exits non-zero if any of the invariants
 * break (bandwidth in [0,1], bands monotonic in width, etc.).
 */
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`[deepbook] ASSERT FAIL: ${msg}`);
    process.exit(2);
  }
}

function localMathCheck(): void {
  console.log(`\n[deepbook] ── local math sanity check ──`);
  const spot = 70_000;
  const tick = 1_000;
  const forwardRaw = 70_500 * 1e9; // slight contango

  const bands = generateRangeBands(spot, tick);
  console.log(`[deepbook] bands at spot $${spot}, tick $${tick}:`);
  for (const b of bands) {
    const prob = impliedProbUpForRange(b.floorUsd, b.capUsd, forwardRaw, NEAR_EXPIRY_MS, DEFAULT_SVI);
    const probFar = impliedProbUpForRange(b.floorUsd, b.capUsd, forwardRaw, FAR_EXPIRY_MS, DEFAULT_SVI);
    console.log(
      `  [${b.widthPct}%] $${b.floorUsd.toLocaleString()} – $${b.capUsd.toLocaleString()} ` +
      `(width $${(b.capUsd - b.floorUsd).toLocaleString()}) ` +
      `P(1d)=${(prob * 100).toFixed(1)}%  P(7d)=${(probFar * 100).toFixed(1)}%`,
    );
    assert(prob >= 0 && prob <= 1, `band prob out of [0,1]: ${prob}`);
    assert(b.floorUsd < b.capUsd, `band floor >= cap`);
  }

  // Invariants:
  //   1) wider band has ≥ probability (more of the distribution is inside it)
  //   2) symmetric band around forward ≈ 0
  //   3) strike probabilities are monotone across the up/down ladder
  const sortedByWidth = [...bands].sort((a, b) => a.widthPct - b.widthPct);
  for (let i = 1; i < sortedByWidth.length; i++) {
    const pLo = impliedProbUpForRange(
      sortedByWidth[i - 1].floorUsd, sortedByWidth[i - 1].capUsd, forwardRaw, NEAR_EXPIRY_MS, DEFAULT_SVI,
    );
    const pHi = impliedProbUpForRange(
      sortedByWidth[i].floorUsd, sortedByWidth[i].capUsd, forwardRaw, NEAR_EXPIRY_MS, DEFAULT_SVI,
    );
    assert(pHi + 1e-6 >= pLo, `wider band ${sortedByWidth[i].widthPct}% should have ≥ prob than ${sortedByWidth[i - 1].widthPct}%`);
  }

  // Up/down ladder sanity
  const strikes = [68_000, 69_000, 70_000, 71_000, 72_000];
  const probs = strikes.map((k) => impliedProbUpForStrike(k, forwardRaw, NEAR_EXPIRY_MS, DEFAULT_SVI));
  for (let i = 1; i < probs.length; i++) {
    assert(probs[i] <= probs[i - 1] + 1e-6, `up/down ladder should be monotone decreasing in strike`);
  }
  console.log(`[deepbook] up/down ladder: ${strikes.map((k, i) => `$${k / 1000}k=${(probs[i] * 100).toFixed(0)}%`).join("  ")}`);

  console.log(`[deepbook] local math OK`);
}

localMathCheck();
