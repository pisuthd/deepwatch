'use client';

import TradeWrapper from '../../components/common/TradeWrapper';
import MarginPage from '../../components/pages/margin/page';

export default function Page() {
  return (
    <TradeWrapper>
      {(mode) => <MarginPage mode={mode} />}
    </TradeWrapper>
  );
}
