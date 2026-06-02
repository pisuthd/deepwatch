'use client';

import { useEffect, useState } from 'react';
import { formatDetailedExpiry } from '../pages/predict/utils';

/**
 * Self-contained 1s ticker that re-renders only itself.
 * Used anywhere a countdown needs to update each second without
 * forcing the parent tree to re-render.
 */
export default function Countdown({
  expiryMs,
  expiredLabel = 'soon',
}: {
  expiryMs: number;
  expiredLabel?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (expiryMs <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiryMs]);

  if (expiryMs <= 0) return <span>—</span>;
  const text = formatDetailedExpiry(expiryMs, now);
  return <span>{text === 'soon' ? expiredLabel : text}</span>;
}
