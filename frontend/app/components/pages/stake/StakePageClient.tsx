/**
 * StakePageClient — the /app/stake page body.
 *
 * Redesigned as a 3-tab IA over Pools / Stats / Borrow:
 *
 *   - **Pools** — two minimal "lending-pool" cards (DUSDC Liquidity +
 *     DeepWatch Subscription Vault). Each card is a discovery surface;
 *     the actual deposit / stake flow lives in a modal that opens
 *     when the user clicks the card's CTA. This keeps first paint
 *     scannable — pool names, APR / benefit taglines, share price,
 *     total supplied — without burying the action forms.
 *
 *   - **Stats** — the existing `VaultStats` (Predict indexer data,
 *     3 themed cards: Vault / PLP Token / Risk & Flows). Unchanged
 *     from the prior inline header.
 *
 *   - **Borrow** — the existing `BorrowPanel` (collateralised lending
 *     against staked PLP). Unchanged.
 *
 * # Modals
 *
 * `LpProvisionModal` and `PoolStakeModal` mount at the page root (not
 * inside the Pools tab) so they survive tab switches cleanly. ESC +
 * backdrop click both close (matches `BorrowRepayModal` convention).
 *
 * # Header rename
 *
 * The page heading is "Stake / Subscription" to clarify that the page
 * owns both pools AND subscription management (not just generic
 * staking).
 *
 * # MainnetWarning
 *
 * The sticky testnet-only toast still fires on mainnet regardless of
 * the active tab — the DeepWatch pool is hackathon v1 and only
 * published to testnet.
 */

import { useEffect, useState } from 'react';
import { Coins, Sparkles, Layers, Activity, Banknote } from 'lucide-react';
import PageWrapper from '../../common/PageWrapper';
import { Tabs, TabPanel, type Tab } from '../../common/Tabs';
import VaultStats from './VaultStats';
import BorrowPanel from './BorrowPanel';
import PoolCard from './PoolCard';
import LpProvisionModal from './LpProvisionModal';
import PoolStakeModal from './PoolStakeModal';
import { useNetwork } from '../../../context/NetworkContext';
import { useToast } from '../../../context/ToastContext';
import { useMarkets } from '../../../hooks/useMarkets';
import { useDeepWatchPool } from '../../../hooks/useDeepWatchPool';
import { DUSDC_SCALE, formatCompactUsd, formatUnitPrice } from '../../../lib/format';

type TabId = 'pools' | 'stats' | 'borrow';
type OpenModal = 'lp' | 'stake' | null;

const stakeTabs: Tab<TabId>[] = [
  { id: 'pools', label: 'Pools', icon: Layers },
  { id: 'stats', label: 'Stats', icon: Activity },
  { id: 'borrow', label: 'Borrow', icon: Banknote },
];

// ─── Page ───────────────────────────────────────────────────────────────

export default function StakePageClient() {
  const [activeTab, setActiveTab] = useState<TabId>('pools');
  const [openModal, setOpenModal] = useState<OpenModal>(null);

  return (
    <PageWrapper title="Stake / Subscription">
      <MainnetWarning />
      <div className="max-w-7xl mx-auto space-y-4">
        <Tabs
          tabs={stakeTabs}
          active={activeTab}
          onChange={setActiveTab}
          ariaLabel="Stake sections"
        />

        <TabPanel activeId={activeTab}>
          {activeTab === 'pools' && (
            <PoolsTab
              onOpenLp={() => setOpenModal('lp')}
              onOpenStake={() => setOpenModal('stake')}
            />
          )}
          {activeTab === 'stats' && <VaultStats />}
          {activeTab === 'borrow' && <BorrowPanel />}
        </TabPanel>

        {/* Modals mount at the page root so they survive tab switches. */}
        <LpProvisionModal
          open={openModal === 'lp'}
          onClose={() => setOpenModal(null)}
        />
        <PoolStakeModal
          open={openModal === 'stake'}
          onClose={() => setOpenModal(null)}
        />
      </div>
    </PageWrapper>
  );
}

// ─── Pools tab ──────────────────────────────────────────────────────────

function PoolsTab({
  onOpenLp,
  onOpenStake,
}: {
  onOpenLp: () => void;
  onOpenStake: () => void;
}) {
  const { vault } = useMarkets();
  const { snapshot, isConfigured: dwConfigured } = useDeepWatchPool();

  // Pool 1 — DUSDC ↔ PLP via Predict.
  const plpSharePrice = vault?.plp_share_price ?? null;
  const lpTotalSupplied = vault?.plp_total_supply ?? null;
  const lpAvailable = plpSharePrice != null && lpTotalSupplied != null;

  // Pool 2 — PLP ↔ Subscription NFT (DeepWatch pool).
  //
  // PLP's redeem value comes from the underlying Predict vault, so the
  // share price is shared across both pools — same source, different
  // perspective. The DeepWatch pool's `treasury_value` is reported in
  // raw 6-decimal DUSDC units (1e6 scale), so we feed it through
  // `formatCompactUsd` after dividing by `DUSDC_SCALE` to get the
  // human-scale number.
  const dwTreasuryRaw =
    snapshot && snapshot.treasuryValue > BigInt(0)
      ? Number(snapshot.treasuryValue / BigInt(DUSDC_SCALE)) * DUSDC_SCALE
      : null;
  const dwBorrowRateBps = snapshot?.borrowRateBps ?? null;
  const dwRateText =
    dwBorrowRateBps != null
      ? `${(dwBorrowRateBps / 100).toFixed(0)}% borrow APR · Required for AI insights`
      : '5% borrow APR · Required for AI insights';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <PoolCard
        icon={Coins}
        name="DUSDC Liquidity"
        subtitle="Deposit DUSDC → mint PLP"
        benefit="Variable · tracks Predict utilization"
        sharePrice={formatUnitPrice(plpSharePrice)}
        totalSupplied={lpTotalSupplied != null ? formatCompactUsd(lpTotalSupplied) : null}
        ctaLabel="Deposit DUSDC → PLP"
        onCtaClick={onOpenLp}
        disabled={!lpAvailable}
        disabledReason="Waiting for Predict indexer data…"
      />
      <PoolCard
        icon={Sparkles}
        name="DeepWatch Subscription Vault"
        subtitle="Stake PLP → unlock AI insights"
        benefit={dwRateText}
        sharePrice={formatUnitPrice(plpSharePrice)}
        totalSupplied={dwTreasuryRaw != null ? formatCompactUsd(dwTreasuryRaw) : null}
        ctaLabel="Stake PLP → Access"
        onCtaClick={onOpenStake}
        disabled={!dwConfigured}
        disabledReason="DeepWatch pool is not deployed on this network."
      />
    </div>
  );
}

// ─── Network warning (unchanged) ───────────────────────────────────────

function MainnetWarning() {
  const { network, setNetwork } = useNetwork();
  const { notify, hasToast } = useToast();

  useEffect(() => {
    if (network !== 'mainnet') return;
    if (hasToast('stake-mainnet-warning')) return;
    notify('DeepWatch staking is still on Testnet.', {
      variant: 'warning',
      title: 'Testnet Only',
      duration: 8000,
      key: 'stake-mainnet-warning',
      action: {
        label: 'Switch to Testnet to stake',
        onClick: () => setNetwork('testnet'),
      },
    });
  }, [network, notify, hasToast, setNetwork]);

  return null;
}
