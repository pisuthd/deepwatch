'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

export type Network = 'mainnet' | 'testnet';

interface NetworkContextType {
  network: Network;
  setNetwork: (network: Network) => void;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

const STORAGE_KEY = 'deepwatch-network';

function readInitialNetwork(): Network {
  if (typeof window === 'undefined') return 'mainnet';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'mainnet' || stored === 'testnet' ? stored : 'mainnet';
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  // Read localStorage synchronously so hooks that depend on `network`
  // (indexer URLs, RPC, coin types) don't fetch the wrong one on first render.
  const [network, setNetworkState] = useState<Network>(readInitialNetwork);

  const setNetwork = (newNetwork: Network) => {
    setNetworkState(newNetwork);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, newNetwork);
    }
  };

  return (
    <NetworkContext.Provider value={{ network, setNetwork }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within NetworkProvider');
  }
  return context;
}