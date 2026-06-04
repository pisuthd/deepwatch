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
      title="Kalshi"
      description="List Kalshi market tickers (e.g. KXELONMARS-99) — one per line. Each line is checked against the ticker format; invalid entries are skipped. Kalshi search is intentionally not wired up; manual entry is the only path."
    >
      <KalshiCard value={value} onChange={onChange} />
    </StepHeader>
  );
}
