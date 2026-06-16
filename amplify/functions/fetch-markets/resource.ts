import { defineFunction } from "@aws-amplify/backend";

/**
 * Scheduled poller: every 15 minutes, fetch the latest BTC market snapshots
 * from Polymarket, Kalshi, and DeepBook Predict, and write them to
 * BinaryMarket + DeepBookMarket in Amplify Data. The /search page reads from
 * those tables; no live API calls happen in the browser.
 *
 * Also wired as a custom query in amplify/data/resource.ts (fetchMarkets),
 * so the frontend can trigger a manual refresh on demand.
 */
export const fetchMarkets = defineFunction({
  name: "fetchMarkets",
  schedule: "every 1h",
  // resourceGroupName: "data",
  timeoutSeconds: 120,
  memoryMB: 1024,
  entry: "./handler.ts",
});
