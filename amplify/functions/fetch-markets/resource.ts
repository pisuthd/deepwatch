import { defineFunction } from "@aws-amplify/backend";

/**
 * Scheduled poller: every 15 minutes, fetch the latest BTC market snapshots
 * from Polymarket, Kalshi, and DeepBook Predict, and write them to
 * BinaryMarket + DeepBookMarket in Amplify Data. The /search page reads from
 * those tables; no live API calls happen in the browser.
 */
export const fetchMarkets = defineFunction({
  name: "fetch-markets",
  schedule: "every 15m",
  timeoutSeconds: 120,
  memoryMB: 1024,
  entry: "./handler.ts",
});
