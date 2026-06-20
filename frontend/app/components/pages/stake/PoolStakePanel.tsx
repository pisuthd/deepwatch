'use client';

/**
 * PoolStakePanel — backward-compat GlassCard wrapper around
 * `PoolStakeFormBody`.
 *
 * The Stake page was redesigned to put pool actions behind a modal
 * (`PoolStakeModal`) rather than inline cards. This file remains so
 * any external consumer can still render the body inline via
 * `<PoolStakePanel />`.
 *
 * The actual form (mode toggle, balance fetch, PTB, error handling)
 * lives in `PoolStakeFormBody` and is shared by the inline and the
 * modal surfaces.
 */

import GlassCard from '../../common/GlassCard';
import { PoolStakeFormBody } from './PoolStakeFormBody';

export default function PoolStakePanel() {
  return (
    <GlassCard>
      <PoolStakeFormBody />
    </GlassCard>
  );
}

export { PoolStakeFormBody } from './PoolStakeFormBody';
