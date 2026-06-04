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
      title="Volatility snapshot"
      description="Pull a full overview of the BTC volatility surface for one predict market: the current price, where the market expects BTC to settle, and how jumpy the market thinks it will be at five reference prices. Powered by Block Scholes' SVI model and surfaced through the DeepBook Predict oracle."
    >
      <PredictCard asset={asset} value={value} onChange={onChange} />
    </StepHeader>
  );
}
