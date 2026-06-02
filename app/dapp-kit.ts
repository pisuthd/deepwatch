import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { NETWORKS } from './lib/networkConfig';

export const dAppKit = createDAppKit({
	networks: ['testnet', 'mainnet'],
	createClient: (network) =>
		new SuiGrpcClient({ network, baseUrl: NETWORKS[network].fullnodeGrpc }),
});

// Register types for hook type inference
declare module '@mysten/dapp-kit-react' {
	interface Register {
		dAppKit: typeof dAppKit;
	}
}