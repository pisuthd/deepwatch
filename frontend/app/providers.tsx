'use client';

import { NetworkProvider } from './context/NetworkContext';
import { ToastProvider } from './context/ToastContext';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { dAppKit } from './dapp-kit';
import { MarketsProvider } from './stores/markets-store';
import { InsightsProvider } from './stores/insights-store';
import { MatchAnalysesProvider } from './stores/match-analyses-store';
import { BatchIndexProvider } from './stores/batch-index-store';
import { AiBatchProvider } from './stores/ai-batch-store';
import BatchStatusDock from './components/pages/compare/BatchStatusDock';

/**
 * Provider tree (outermost → innermost):
 *
 *   DAppKitProvider        — Sui wallet connection (per Next.js dApp Kit).
 *   MarketsProvider        — global Polymarket + Kalshi fetch + 90 s refresh.
 *                            Lives outside DAppKit intentionally — the markets
 *                            feed is independent of wallet state.
 *   NetworkProvider        — global network (mainnet/testnet) selector.
 *   InsightsProvider       — local-first insight store backed by localStorage.
 *   MatchAnalysesProvider  — per-match AI analysis store (Compare page).
 *   BatchIndexProvider     — localStorage cache of Walrus batch blobs.
 *                            Source of truth is Tatum; this is a read cache.
 *   ToastProvider          — global toast queue.
 *   AiBatchProvider        — owns the AI batch lifecycle (SSE consumer,
 *                            AbortController, Walrus upload). Survives
 *                            page navigation so closing the modal mid-stream
 *                            does NOT stop the batch.
 *   BatchStatusDock        — fixed bottom-right pill that surfaces the
 *                            batch state when the modal is closed.
 *                            Mounted here so it survives any route change.
 *
 * The order matters:
 *   - `AiBatchProvider` reads `useMatchAnalyses` (write), `useBatchIndex`
 *     (set), and `useToast` (notify), so it must be inside those three.
 *   - `BatchStatusDock` reads `useAiBatch`, so it must be inside the
 *     `AiBatchProvider`. It lives at the provider layer (not inside any
 *     page) so the user sees the dock on Predict, Overview, etc. while
 *     a batch is in flight on the Compare page.
 *   - `ToastProvider` must wrap `AiBatchProvider` because the provider
 *     fires a completion toast on `done`.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <MarketsProvider>
        <NetworkProvider>
          <InsightsProvider>
            <MatchAnalysesProvider>
              <BatchIndexProvider>
                <ToastProvider>
                  <AiBatchProvider>
                    <BatchStatusDock />
                    {children}
                  </AiBatchProvider>
                </ToastProvider>
              </BatchIndexProvider>
            </MatchAnalysesProvider>
          </InsightsProvider>
        </NetworkProvider>
      </MarketsProvider>
    </DAppKitProvider>
  );
}
