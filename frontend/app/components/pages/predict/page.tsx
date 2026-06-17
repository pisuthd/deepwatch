'use client';

import PageWrapper from '../../common/PageWrapper';
import type { TradeMode } from '../../common/TradeWrapper';
import PredictSimpleMode from './SimpleMode';
import PredictAdvancedMode from './AdvancedMode';

export default function PredictPage({ mode }: { mode: TradeMode }) {
  return (
    <PageWrapper title="Predict">
      {mode === 'simple' ? <PredictSimpleMode /> : <PredictAdvancedMode />}
    </PageWrapper>
  );
}
