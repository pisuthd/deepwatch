'use client';

import PageWrapper from '../../common/PageWrapper';
import type { TradeMode } from '../../common/TradeWrapper';
import MarginSimpleMode from './SimpleMode';
import MarginAdvancedMode from './AdvancedMode';

export default function MarginPage({ mode }: { mode: TradeMode }) {
  return (
    <PageWrapper title="Margin">
      {mode === 'simple' ? <MarginSimpleMode /> : <MarginAdvancedMode />}
    </PageWrapper>
  );
}
