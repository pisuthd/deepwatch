'use client';

import { NetworkProvider } from './context/NetworkContext';
import { ToastProvider } from './context/ToastContext';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { dAppKit } from './dapp-kit';
import { MarketsProvider } from './stores/markets-store';
import { InsightsProvider } from './stores/insights-store';

/**
 * Provider tree (outermost → innermost):
 *
 *   DAppKitProvider   — Sui wallet connection (per Next.js dApp Kit).
 *   MarketsProvider   — global Polymarket + Kalshi fetch + 90 s refresh.
 *                        Lives outside DAppKit intentionally — the markets
 *                        feed is independent of wallet state.
 *   NetworkProvider   — global network (mainnet/testnet) selector.
 *   InsightsProvider  — local-first insight store backed by localStorage.
 *   ToastProvider     — global toast queue.
 *
 * The order matters: MarketsProvider must wrap everything that might
 * read markets data (the wizard in particular), and InsightsProvider
 * must wrap any page that opens the saved-insights popover.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <MarketsProvider>
        <NetworkProvider>
          <InsightsProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </InsightsProvider>
        </NetworkProvider>
      </MarketsProvider>
    </DAppKitProvider>
  );
}
