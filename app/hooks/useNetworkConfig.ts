'use client';

import { useNetwork } from '../context/NetworkContext';
import { NETWORKS, type NetworkConfig } from '../lib/networkConfig';

/**
 * Returns the per-network config slice for the currently active network.
 * Reads from `useNetwork()` so it re-renders when the user switches
 * mainnet <-> testnet in the TopBar.
 */
export function useNetworkConfig(): NetworkConfig {
  return NETWORKS[useNetwork().network];
}
