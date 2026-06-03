'use client';

import { NetworkProvider } from './context/NetworkContext';
import { ToastProvider } from './context/ToastContext';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { dAppKit } from './dapp-kit';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <NetworkProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </NetworkProvider>
    </DAppKitProvider>
  );
}