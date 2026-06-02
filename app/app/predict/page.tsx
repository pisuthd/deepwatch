'use client';

import TradeWrapper from '../../components/common/TradeWrapper';
import PredictPage from '../../components/pages/predict/page';
import PositionsButton from '../../components/pages/predict/PositionsButton';
import AccountOverviewButton from '../../components/pages/predict/AccountOverviewButton';
import { CurrentMarketProvider } from '../../components/pages/predict/CurrentMarketContext';

export default function Page() {
  return (
    <CurrentMarketProvider>
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
