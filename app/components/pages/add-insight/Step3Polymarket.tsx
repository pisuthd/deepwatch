'use client';

import type { PolymarketMarket } from '../../../lib/insights';
import PolymarketCard from '../insights/PolymarketCard';
import StepHeader from './StepHeader';

interface Props {
  apiKey: string;
  value: PolymarketMarket[];
  onChange: (markets: PolymarketMarket[]) => void;
}

/**
 * Step 3 — Polymarket markets.
 *
 * Reuses `PolymarketCard` unchanged. Initial query is `bitcoin` with
 * the `up-or-down` tag, mirroring the user's reference curl.
 */
export default function Step3Polymarket({ apiKey, value, onChange }: Props) {
  return (
    <StepHeader
      number={3}
      title="Polymarket odds"
      description="Real-time prediction market odds, pulled live from Tatum Data API. The five highest-volume markets are picked for you. Drop any you don't want cited."
    >
      <PolymarketCard apiKey={apiKey} value={value} onChange={onChange} />
    </StepHeader>
  );
}
