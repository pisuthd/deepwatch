'use client';

import { ThemeProvider } from './context/ThemeContext';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { dAppKit } from './dapp-kit';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <DAppKitProvider dAppKit={dAppKit}>
        {children}
      </DAppKitProvider>
    </ThemeProvider>
  );
}