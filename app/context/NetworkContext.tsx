'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useCurrentNetwork } from '@mysten/dapp-kit-react';

export type Network = 'mainnet' | 'testnet';

interface NetworkContextType {
  network: Network;
  setNetwork: (network: Network) => void;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

const STORAGE_KEY = 'deepwatch-network';

export function NetworkProvider({ children }: { children: ReactNode }) {
  const dappKitNetwork = useCurrentNetwork();
  const [localNetwork, setLocalNetwork] = useState<Network>(() => {
    if (typeof window === 'undefined') return 'mainnet';
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return (stored === 'mainnet' || stored === 'testnet' ? stored : 'mainnet') as Network;
  });

  // Sync localStorage preference
  useEffect(() => {
    if (typeof window !== 'undefined' && dappKitNetwork !== localNetwork) {
      // When dapp-kit network changes, update local state
      setLocalNetwork(dappKitNetwork as Network);
    }
  }, [dappKitNetwork]);

  const setNetwork = (network: Network) => {
    setLocalNetwork(network);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, network);
    }
    // Trigger re-render by updating state
    setLocalNetwork(network);
  };

  const contextValue: NetworkContextType = {
    network: localNetwork,
    setNetwork,
  };

  return (
    <NetworkContext.Provider value={contextValue}>
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
