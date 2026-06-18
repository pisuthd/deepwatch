'use client';

import TradeWrapper from '../../components/common/TradeWrapper';
import MarginPage from '../../components/pages/margin/page';
import MarginManagerButton from '../../components/pages/margin/MarginManagerButton';

export default function Page() {
  return (
    <TradeWrapper trailing={<MarginManagerButton />}>
      {(mode) => <MarginPage mode={mode} />}
    </TradeWrapper>
  );
}
