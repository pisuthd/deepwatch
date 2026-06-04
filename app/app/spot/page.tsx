'use client';

import TradeWrapper from '../../components/common/TradeWrapper';
import SpotPage from '../../components/pages/spot/page';
import InsightButton from '../../components/pages/insights/InsightButton';
import { CurrentPoolProvider } from '../../components/pages/spot/CurrentPoolContext';

export default function Page() {
  return (
    <CurrentPoolProvider>
      <TradeWrapper trailing={<InsightButton />}>
        {(mode) => <SpotPage mode={mode} />}
      </TradeWrapper>
    </CurrentPoolProvider>
  );
}
