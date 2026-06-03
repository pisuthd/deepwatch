'use client';

import { useEffect } from 'react';
import TradeWrapper from '../../components/common/TradeWrapper';
import PredictPage from '../../components/pages/predict/page';
import PositionsButton from '../../components/pages/predict/PositionsButton';
import AccountOverviewButton from '../../components/pages/predict/AccountOverviewButton';
import { CurrentMarketProvider } from '../../components/pages/predict/CurrentMarketContext';
import { useNetwork } from '../../context/NetworkContext';
import { useToast } from '../../context/ToastContext';

/**
 * DeepBook's predict indexer is testnet-only. Show a sticky warning
 * whenever the user lands on /app/predict while mainnet is active. The
 * toast's `key` keeps it from re-appearing on every re-render; it re-fires
 * only if the user dismisses it and toggles back to mainnet.
 */
function MainnetWarning() {
  const { network, setNetwork } = useNetwork();
  const { notify, hasToast } = useToast();

  useEffect(() => {
    if (network !== 'mainnet') return;
    // Skip if a toast with the same key is already on screen. The `key`
    // de-dupe inside `notify()` also catches this, but checking here is
    // self-documenting and avoids a wasted call on every consumer re-render.
    if (hasToast('predict-mainnet-warning')) return;
    notify('DeepBook Predict is still on Testnet.', {
      variant: 'warning',
      title: 'Not Supported',
      duration: 8000,
      key: 'predict-mainnet-warning',
      action: {
        label: 'Switch to Testnet',
        onClick: () => setNetwork('testnet'),
      },
    });
  }, [network, notify, hasToast, setNetwork]);

  return null;
}

export default function Page() {
  return (
    <CurrentMarketProvider>
      <MainnetWarning />
      <TradeWrapper
        trailing={
          <>
            <AccountOverviewButton />
            <PositionsButton />
          </>
        }
      >
        {(mode) => <PredictPage mode={mode} />}
      </TradeWrapper>
    </CurrentMarketProvider>
  );
}
