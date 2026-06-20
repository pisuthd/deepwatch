'use client';

/**
 * StakePageClient — the /app/stake page body.
 *
 * Renders four pieces in order:
 *   1. VaultStats — header with 3 thematic cards (Vault / PLP Token
 *      / Risk & Flows) sourced from the Predict indexer's
 *      `/vault/summary` endpoint. DeepWatch second-layer pool
 *      state is intentionally NOT in the header — the pool is not
 *      deployed yet, and a "Pool not deployed" card was noise.
 *   2. LpProvisionPanel — DUSDC ↔ PLP via raw `predict::supply` /
 *      `predict::withdraw`. The user must have PLP before the
 *      pool stake panel can do anything useful.
 *   3. PoolStakePanel — PLP → Subscription NFT (and the reverse).
 *      This is the panel that controls AI-insight access.
 *   4. BorrowPanel — collateralised lending against the staked
 *      PLP. Generates the yield that flows back to stakers.
 *
 * The panels are independent — there's no shared state between
 * them — but each one calls `useUserPool().refresh()` /
 * `useDeepWatchPool().refresh()` after its own PTB so the others
 * see fresh state on the next render.
 *
 * The page also surfaces a sticky testnet-only toast if the user is
 * on mainnet, mirroring the /app/predict page's behaviour (the
 * DeepWatch pool is hackathon v1 and only published to testnet).
 */

import { useEffect } from 'react';
import PageWrapper from '../../common/PageWrapper';
import VaultStats from './VaultStats';
import LpProvisionPanel from './LpProvisionPanel';
import PoolStakePanel from './PoolStakePanel';
import BorrowPanel from './BorrowPanel';
import { useNetwork } from '../../../context/NetworkContext';
import { useToast } from '../../../context/ToastContext';

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

export default function StakePageClient() {
  return (
    <PageWrapper title="Stake">
      <MainnetWarning />
      <div className="max-w-7xl mx-auto space-y-4">
        <VaultStats />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <LpProvisionPanel />
          <PoolStakePanel />
          <BorrowPanel />
        </div>
      </div>
    </PageWrapper>
  );
}
