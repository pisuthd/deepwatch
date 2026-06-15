'use client';

import { Amplify } from 'aws-amplify';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { dAppKit } from './lib/dapp-kit';
import outputs from '@/amplify_outputs.json';

Amplify.configure(outputs);

export default function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DAppKitProvider dAppKit={dAppKit}>{children}</DAppKitProvider>;
}
