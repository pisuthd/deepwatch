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
import Image from 'next/image';
import { Archive, Layers, Activity, Banknote, TowerControl } from 'lucide-react';
import PageWrapper from '../../common/PageWrapper';
import { getCoinIcon } from '../../../lib/coinIcons';
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

// Local color tokens — same set used by `ComparePageClient.tsx` for
// the subtitle card. Inlined here so this file stays self-contained.
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const green = '#00E68A';

type TabId = 'pools' | 'stats' | 'borrow';
type OpenModal = 'lp' | 'stake' | null;

const stakeTabs: Tab<TabId>[] = [
  { id: 'pools', label: 'All pools', icon: Layers },
  { id: 'stats', label: 'Predict Vault Stats', icon: Activity },
  { id: 'borrow', label: 'Borrow SUI', icon: Banknote },
];

// ─── Page ───────────────────────────────────────────────────────────────

export default function StakePageClient() {
  const [activeTab, setActiveTab] = useState<TabId>('pools');
  const [openModal, setOpenModal] = useState<OpenModal>(null);

  return (
    <PageWrapper title="Subscription">
      <MainnetWarning />

      <div className="max-w-7xl mx-auto space-y-4">
        {/* Subtitle — glass card matching the Compare page style.
            Two-clause flow: (1) DUSDC in → PLP out (the earning side),
            (2) PLP in → subscription NFT (the access side). `pointer-
            events-none` on the overlays keeps the card body non-
            interactive. */}
        <div
          className="relative overflow-hidden rounded-2xl p-4 pr-16 border border-white/10"
          style={{
            background: 'rgba(26, 29, 46, 0.6)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

          {/* Glow icon on the right — mirrors the Compare page subtitle. */}
          <div
            className="absolute top-1/2 -translate-y-1/2 right-3 pointer-events-none"
            aria-hidden="true"
          >
            <div className="relative w-10 h-10 flex items-center justify-center">
              <div
                className="absolute inset-0 rounded-xl"
                style={{
                  background: green,
                  filter: 'blur(14px)',
                  opacity: 0.35,
                }}
              />
              <div
                className="absolute inset-0 rounded-xl border border-white/10"
                style={{ background: 'rgba(26, 29, 46, 0.6)' }}
              />
              <Archive
                size={18}
                className="relative z-10"
                style={{ color: green }}
              />
            </div>
          </div>

          <p
            className="relative text-sm max-w-3xl"
            style={{ color: textSecondary }}
          >
            Deposit{' '}
            <span style={{ color: textPrimary }}>DUSDC</span> to mint{' '}
            <span style={{ color: textPrimary }}>PLP</span> — providing
            liquidity to{' '}
            <span style={{ color: textPrimary }}>DeepBook Predict</span>{' '}
            and earning passive yield. Stake{' '}
            <span style={{ color: textPrimary }}>PLP</span> for a
            subscription NFT to unlock exclusive AI insights, with{' '}
            <span style={{ color: green }}>
              extra yield via our internal lending pool
            </span>
            .
          </p>
        </div>

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
          {activeTab === 'borrow' && (
            <div className="max-w-2xl mx-auto">
              <BorrowPanel />
            </div>
          )}
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
  const apr = vault?.total_max_payout ?? null
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Card 1 — DeepBook Predict Vault.
          Top-left icon: the DeepBook protocol token (DEEP) image.
          Top-right metric: utilization (placeholder, no data field
          exposed yet by the indexer — wire to a real field when it
          lands). Asset row shows the deposit token (DUSDC) with its
          CMC icon. */}
      <PoolCard
        icon={
          <Image
            src={getCoinIcon('DEEP')}
            width={28}
            height={28}
            alt="DeepBook"
            unoptimized
          />
        }
        name="Deepbook Predict Vault"
        subtitle="Deposit DUSDC → mint PLP"
        metric={{ value: (`${((apr || 1)/10**9).toFixed(2)}%`) , label: 'APR' }}
        details={[
          {
            label: 'Asset',
            value: (
              <span className="inline-flex items-center gap-1.5">
                <Image
                  src={getCoinIcon('DUSDC')}
                  width={14}
                  height={14}
                  alt="DUSDC"
                  unoptimized
                />
                <span style={{ color: textPrimary }}>DUSDC</span>
              </span>
            ),
          },
        ]}
        sharePrice={formatUnitPrice(plpSharePrice)}
        totalSupplied={lpTotalSupplied != null ? formatCompactUsd(lpTotalSupplied) : null}
        ctaLabel="Deposit DUSDC → PLP"
        onCtaClick={onOpenLp}
        disabled={!lpAvailable}
        disabledReason="Waiting for Predict indexer data…"
      />
      {/* Card 2 — DeepWatch Subscription Vault.
          Top-left icon: the DeepWatch brand glyph (TowerControl, same
          as the landing footer). Top-right metric: N/A — the
          subscription yield isn't directly yield-bearing (it unlocks
          gated AI content + extra borrow-pool yield, no flat APR on
          the principal). Lockup row mirrors the modal's
          `DURATION_PRESETS_DAYS = [7, 30, 90]`, default 30. */}
      <PoolCard
        icon={<TowerControl size={18} style={{ color: green }} />}
        name="DeepWatch Subscription Vault"
        subtitle="Stake PLP → unlock AI insights + more"
        metric={{ value: '20%', label: 'APR' }}
        details={[
          { label: 'Lockup', value: '7 / 30 / 90 days' },
        ]}
        sharePrice={formatUnitPrice(plpSharePrice)}
        totalSupplied={dwTreasuryRaw != null ? formatCompactUsd(dwTreasuryRaw) : null}
        ctaLabel="Stake PLP → Subscription NFT"
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
