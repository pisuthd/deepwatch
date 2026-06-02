'use client';

import PageWrapper from '../../components/common/PageWrapper';
import TradeWrapper from '../../components/common/TradeWrapper';

export default function MarginPage() {
  return (
    <TradeWrapper>
      {(mode) => (
        <PageWrapper title="Margin">
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500">
              {mode === 'advanced'
                ? 'Margin trading coming soon — leverage sliders, liquidation buffers, and risk metrics will live here.'
                : 'Margin trading coming soon...'}
            </p>
          </div>
        </PageWrapper>
      )}
    </TradeWrapper>
  );
}
