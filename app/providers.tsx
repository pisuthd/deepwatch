'use client';

import { ThemeProvider } from './context/ThemeContext';
import { NetworkProvider } from './context/NetworkContext';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { dAppKit } from './dapp-kit';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <NetworkProvider>
        <DAppKitProvider dAppKit={dAppKit}>
          {children}
        </DAppKitProvider>
      </NetworkProvider>
    </ThemeProvider>
  );
}