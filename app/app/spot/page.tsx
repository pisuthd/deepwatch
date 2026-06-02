'use client';

import PageWrapper from '../../components/common/PageWrapper';
import TradeWrapper from '../../components/common/TradeWrapper';

export default function SpotPage() {
  return (
    <TradeWrapper>
      {(mode) => (
        <PageWrapper title="Spot">
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500">
              {mode === 'advanced'
                ? 'Spot trading coming soon — pro order book, depth charts, and limit controls will live here.'
                : 'Spot trading coming soon...'}
            </p>
          </div>
        </PageWrapper>
      )}
    </TradeWrapper>
  );
}
