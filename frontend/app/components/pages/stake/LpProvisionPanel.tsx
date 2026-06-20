'use client';

/**
 * LpProvisionPanel — backward-compat GlassCard wrapper around
 * `LpProvisionFormBody`.
 *
 * The Stake page was redesigned to put pool actions behind a modal
 * (`LpProvisionModal`) rather than inline cards. This file remains so
 * any external consumer can still render the body inline via
 * `<LpProvisionPanel />`.
 *
 * The actual form (mode toggle, balance fetch, PTB, error handling)
 * lives in `LpProvisionFormBody` and is shared by the inline and the
 * modal surfaces.
 */

import GlassCard from '../../common/GlassCard';
import { LpProvisionFormBody } from './LpProvisionFormBody';

export default function LpProvisionPanel() {
  return (
    <GlassCard>
      <LpProvisionFormBody />
    </GlassCard>
  );
}

export { LpProvisionFormBody } from './LpProvisionFormBody';
