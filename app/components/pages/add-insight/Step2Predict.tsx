'use client';

import type { InsightAsset, PredictSnapshot } from '../../../lib/insights';
import PredictCard from '../insights/PredictCard';
import StepHeader from './StepHeader';

interface Props {
  asset: InsightAsset;
  value: PredictSnapshot | null;
  onChange: (snapshot: PredictSnapshot | null) => void;
}

/**
 * Step 2 — Predict market snapshot (BTC only).
 *
 * Reuses the existing `PredictCard` unchanged. The card is
 * automatically disabled with a "BTC only" notice for non-BTC assets.
 */
export default function Step2Predict({ asset, value, onChange }: Props) {
  return (
    <StepHeader
      number={2}
      title="Predict market"
      description="Capture a snapshot of the SVI surface, spot/forward, the 5 standard-strike IVs, and the last 30 spot prices for one BTC predict market. This data is what the AI will cite when it writes the analysis."
    >
      <PredictCard asset={asset} value={value} onChange={onChange} />
    </StepHeader>
  );
}
