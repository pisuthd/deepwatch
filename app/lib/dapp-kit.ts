import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';

// Sui mainnet and testnet fullnode gRPC endpoints
const NETWORK_CONFIG = {
  mainnet: {
    fullnodeGrpc: 'https://fullnode.mainnet.sui.io:443',
  },
  testnet: {
    fullnodeGrpc: 'https://fullnode.testnet.sui.io:443',
  },
} as const;

export const dAppKit = createDAppKit({
  networks: ['mainnet', 'testnet'],
  defaultNetwork: 'mainnet',
  createClient: (network) =>
    new SuiGrpcClient({
      network,
      baseUrl: NETWORK_CONFIG[network].fullnodeGrpc,
    }),
});

// Register types for hook type inference
declare module '@mysten/dapp-kit-react' {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
