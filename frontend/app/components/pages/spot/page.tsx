'use client';

import PageWrapper from '../../common/PageWrapper';
import type { TradeMode } from '../../common/TradeWrapper';
import SpotSimpleMode from './SimpleMode';
import SpotAdvancedMode from './AdvancedMode';

export default function SpotPage({ mode }: { mode: TradeMode }) {
  return (
    <PageWrapper title="Spot">
      {mode === 'simple' ? <SpotSimpleMode /> : <SpotAdvancedMode />}
    </PageWrapper>
  );
}
