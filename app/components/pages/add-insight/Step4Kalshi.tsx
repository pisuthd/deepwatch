'use client';

import KalshiCard from '../insights/KalshiCard';
import StepHeader from './StepHeader';

interface Props {
  value: string[];
  onChange: (tickers: string[]) => void;
}

/**
 * Step 4 — Kalshi tickers (manual entry only).
 *
 * Reuses `KalshiCard` unchanged. The card validates each line against
 * the ticker regex and only propagates valid entries up to the parent.
 */
export default function Step4Kalshi({ value, onChange }: Props) {
  return (
    <StepHeader
      number={4}
      title="Kalshi tickers"
      description="List the Kalshi markets you want cited (e.g. KXBTCD-99), one ticker per line. We check each line for the right format and skip anything invalid. We don't pull live Kalshi odds here — type the markets you want the AI to reference."
    >
      <KalshiCard value={value} onChange={onChange} />
    </StepHeader>
  );
}
