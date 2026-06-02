'use client';

import TradeWrapper from '../../components/common/TradeWrapper';
import PredictPage from '../../components/pages/predict/page';

export default function Page() {
  return (
    <TradeWrapper>
      {(mode) => <PredictPage mode={mode} />}
    </TradeWrapper>
  );
}
