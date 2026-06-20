'use client';

import TradeWrapper from '../../components/common/TradeWrapper';
import SpotPage from '../../components/pages/spot/page'; 
import { CurrentPoolProvider } from '../../components/pages/spot/CurrentPoolContext';

export default function Page() {
  return (
    <CurrentPoolProvider>
      <TradeWrapper>
        {(mode) => <SpotPage mode={mode} />}
      </TradeWrapper>
    </CurrentPoolProvider>
  );
}
