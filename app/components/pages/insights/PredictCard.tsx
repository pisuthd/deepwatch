'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useMarkets } from '../../../hooks/useMarkets';
import { useMarket } from '../../../hooks/useMarket';
import { useMarketPrices } from '../../../hooks/useMarketPrices';
import { calculateMintPrice, sviVol } from '../../../hooks/useSVI';
import GlassCard from '../../common/GlassCard';
import GlassDropdown from '../../common/GlassDropdown';
import { formatExpiryLabel, type InsightAsset, type PredictSnapshot } from '../../../lib/insights';
 
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

const PRICE_SCALE = 1e9;
const STANDARD_MONEYNESS = [0.9, 0.95, 1.0, 1.05, 1.1] as const;
const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

interface Props {
  asset: InsightAsset;
  value: PredictSnapshot | null;
  onChange: (snapshot: PredictSnapshot | null) => void;
}

/**
 * PredictCard — BTC predict market data card.
 *
 * Lets the user pick an oracle (active BTC market), then we snapshot
 * the SVI parameters, spot/forward, the 5 standard-strike IVs, and the
 * last 30 spot price points. The snapshot lives in `value` and is what
 * gets baked into the uploaded insight's `includes.predict`.
 *
 * Disabled (and uncheckable) for non-BTC assets — the underlying
 * predict server only has BTC markets right now (see `useMarkets.ts`).
 */
export default function PredictCard({ asset, value, onChange }: Props) {
  const enabled = asset === 'BTC';
  const [checked, setChecked] = useState<boolean>(!!value);
  const [oracleId, setOracleId] = useState<string | null>(value?.oracleId ?? null);

  const { markets, loading: marketsLoading } = useMarkets();
  const { market, loading: marketLoading } = useMarket(oracleId);
  const { history, loading: pricesLoading } = useMarketPrices(oracleId, 30);

  const { oracleOptions, recommendedId } = useMemo(() => {
    const active = markets.filter((m) => m.asset === 'BTC' && m.status === 'active');
    // Mark the market whose expiry is closest to 24h from now as the
    // recommended pick — it's the sweet spot between "lots of time to
    // trade" and "soon enough that the SVI is meaningful".
    const target = Date.now() + 24 * 60 * 60 * 1000;
    let recommendedId: string | null = null;
    let bestDelta = Infinity;
    for (const m of active) {
      const delta = Math.abs(m.expiryMs - target);
      if (delta < bestDelta) {
        bestDelta = delta;
        recommendedId = m.oracle_id;
      }
    }
    const oracleOptions = active.map((m) => ({
      // The dropdown only surfaces the expiry — the oracle id is
      // an internal identifier and is hidden via `showValue={false}`.
      value: m.oracle_id,
      label: formatExpiryLabel(m.expiryMs),
      badge: m.oracle_id === recommendedId ? 'Recommended' : undefined,
    }));
    return { oracleOptions, recommendedId };
  }, [markets]);

  // Auto-select the recommended market when the user enables the card
  // and hasn't already picked one. Fires once `markets` finishes
  // loading, then never again unless the user clears the selection
  // (uncheck) or markets change and there's no current pick.
  useEffect(() => {
    if (checked && !oracleId && recommendedId) {
      setOracleId(recommendedId);
    }
  }, [checked, oracleId, recommendedId]);

  // When the user picks an oracle (or it finishes loading) build the
  // snapshot. The snapshot becomes `value` in the parent, which drives
  // the auto-generated markdown.
  useEffect(() => {
    if (!checked || !oracleId) return;
    if (!market || !market.svi || !history) return;

    const spotUSD = market.spot / PRICE_SCALE;
    const forwardUSD = market.forward / PRICE_SCALE;
    const T = Math.max(0, (market.expiryMs - Date.now()) / MS_PER_YEAR);

    const standardStrikes = STANDARD_MONEYNESS.map((m) => {
      // Round to the nearest tick so the strike is tradeable.
      const raw = spotUSD * m;
      const strike = Math.max(
        market.minStrike,
        Math.round(raw / market.tickSize) * market.tickSize,
      );
      // calculateMintPrice expects forward RAW (× PRICE_SCALE); it
      // divides internally. Strike is USD.
      const { up, down } = calculateMintPrice(
        strike,
        market.forward,
        market.expiryMs,
        market.svi ?? undefined,
      );
      const iv = sviVol(strike, forwardUSD, T, market.svi!);
      return { strike, up: Math.round(up), down: Math.round(down), iv };
    });

    const snap: PredictSnapshot = {
      oracleId,
      expiryMs: market.expiryMs,
      spot: spotUSD,
      forward: forwardUSD,
      svi: {
        a: market.svi.a,
        b: market.svi.b,
        rho: market.svi.rho,
        m: market.svi.m,
        sigma: market.svi.sigma,
      },
      standardStrikes,
      recentPrices: history.prices.map((p) => ({ time: p.time, spot: p.spot })),
    };
    onChange(snap);
  }, [checked, market, history, oracleId, onChange]);

  // ── Disabled state (non-BTC asset) ─────────────────────────────────────
  if (!enabled) {
    return (
      <GlassCard>
        <div className="flex items-start gap-3">
          <input type="checkbox" disabled className="mt-1" />
          <div>
            <div className="text-sm font-semibold" style={{ color: textSecondary }}>
              Predict market analysis
            </div>
            <div className="text-xs mt-1" style={{ color: textSecondary, opacity: 0.8 }}>
              Only available for BTC — the underlying predict server is BTC-only. Switch
              the asset above to enable.
            </div>
          </div>
        </div>
      </GlassCard>
    );
  }

  const loading = marketsLoading || marketLoading || pricesLoading;

  return (
    <GlassCard overflow="visible">
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => {
              setChecked(e.target.checked);
              if (!e.target.checked) {
                onChange(null);
                setOracleId(null);
              }
            }}
            className="mt-1"
          />
          <div className="flex-1">
            <div className="text-sm font-semibold" style={{ color: textPrimary }}>
              Predict market analysis
            </div>
            <div className="text-xs mt-0.5" style={{ color: textSecondary }}>
              Snapshot of SVI parameters, implied vols at standard strikes, recent spot.
            </div>
          </div>
        </div>

        {checked && (
          <div className="space-y-2 pl-7">
            {markets.length === 0 && marketsLoading ? (
              <div
                className="flex items-center gap-2 text-xs"
                style={{ color: textSecondary }}
              >
                <Loader2 size={12} className="animate-spin" /> Loading markets…
              </div>
            ) : oracleOptions.length === 0 ? (
              <div className="text-xs" style={{ color: textSecondary }}>
                No active BTC markets right now.
              </div>
            ) : (
              <div className="w-full max-w-md">
                <GlassDropdown
                  options={oracleOptions}
                  value={oracleId ?? ''}
                  onChange={setOracleId}
                  placeholder="Select a market"
                  showValue={false}
                />
              </div>
            )}

            {oracleId && loading && !value && (
              <div
                className="flex items-center gap-2 text-xs"
                style={{ color: textSecondary }}
              >
                <Loader2 size={12} className="animate-spin" /> Loading market data…
              </div>
            )}

            {value && (
              <div
                className="rounded-lg p-2.5 text-xs font-mono"
                style={{ background: 'rgba(0,230,138,0.06)', color: textPrimary }}
              >
                Spot ${value.spot.toFixed(0)} · Forward ${value.forward.toFixed(0)} ·
                {value.standardStrikes[2] && (
                  <>
                    {' '}
                    UP {value.standardStrikes[2].up}% / DOWN {value.standardStrikes[2].down}% at spot
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </GlassCard>
  );
}
