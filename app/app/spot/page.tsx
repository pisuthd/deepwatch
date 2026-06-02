'use client';

import TradeWrapper from '../../components/common/TradeWrapper';
import SpotPage from '../../components/pages/spot/page';
import SpotAccountOverviewButton from '../../components/pages/spot/SpotAccountOverviewButton';
import SpotPositionsButton from '../../components/pages/spot/SpotPositionsButton';
import { CurrentPoolProvider } from '../../components/pages/spot/CurrentPoolContext';

export default function Page() {
  return (
    <CurrentPoolProvider>
      <TradeWrapper
        trailing={
          <>
            <SpotAccountOverviewButton />
            <SpotPositionsButton />
          </>
        }
      >
        {(mode) => <SpotPage mode={mode} />}
      </TradeWrapper>
    </CurrentPoolProvider>
  );
}
