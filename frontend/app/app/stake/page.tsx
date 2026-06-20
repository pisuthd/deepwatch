'use client';

import StakePageClient from '../../components/pages/stake/StakePageClient';

/**
 * /app/stake — DeepWatch second-layer staking page.
 *
 * Three panels in priority order (the user should see this in flow):
 *   1. **LP provision** — DUSDC ↔ PLP via `predict::supply` /
 *      `predict::withdraw`. The user's "deposit" is the LP token that
 *      everything else on the page assumes.
 *   2. **Pool stake** — PLP → `Subscription` NFT. Mints the access
 *      ticket for Seal-decrypted AI insights. Duration chosen by the
 *      user; defaults to 30 days.
 *   3. **Borrow** — SUI collateral → PLP loan. Generates the yield
 *      that flows back to stakers. Admin can `donate` and
 *      `admin_seed_borrow` for the demo bootstrap (out of UI scope
 *      for v1 — admin runs them via `sui client call`).
 *
 * + **VaultStats** header at the top — vault_value +
 *   available_liquidity (existing predict indexer), and the live
 *   `Pool` state (total staked, borrowed, utilisation).
 */
export default function Page() {
  return <StakePageClient />;
}
