'use client';

import TradeWrapper from '../../components/common/TradeWrapper';
import SpotPage from '../../components/pages/spot/page';

export default function Page() {
  return (
    <TradeWrapper>
      {(mode) => <SpotPage mode={mode} />}
    </TradeWrapper>
  );
}
