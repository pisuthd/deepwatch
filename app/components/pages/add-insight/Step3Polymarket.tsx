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
      title="Polymarket"
      description="Pick one or more BTC prediction markets from Polymarket. The default search is 'bitcoin' with the 'up-or-down' tag, active markets only — change either field to broaden the search. Tick the markets you want cited in the analysis."
    >
      <PolymarketCard apiKey={apiKey} value={value} onChange={onChange} />
    </StepHeader>
  );
}
