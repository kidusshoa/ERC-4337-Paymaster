import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Account,
  Chain,
  createPublicClient,
  createWalletClient,
  http,
  PublicClient,
  WalletClient,
} from 'viem';
import { foundry, mainnet, sepolia } from 'viem/chains';

const KNOWN_CHAINS: Record<number, Chain> = {
  [foundry.id]: foundry,
  [sepolia.id]: sepolia,
  [mainnet.id]: mainnet,
};

/**
 * Resolves the configured target chain (CHAIN_ID/CHAIN_RPC_URL) into viem clients.
 * One client per process is enough for now — every module that needs chain access
 * goes through this service rather than constructing its own transport, so there's a
 * single place to add multi-chain support later if this paymaster ever needs it.
 */
@Injectable()
export class ViemClientService {
  private readonly chain: Chain;
  private readonly rpcUrl: string;
  private readonly publicClient: PublicClient;

  constructor(private readonly configService: ConfigService) {
    const chainId = this.configService.get<number>('CHAIN_ID', 31337);
    this.rpcUrl = this.configService.get<string>('CHAIN_RPC_URL', 'http://127.0.0.1:8545');

    this.chain = KNOWN_CHAINS[chainId] ?? {
      id: chainId,
      name: `chain-${chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [this.rpcUrl] } },
    };

    this.publicClient = createPublicClient({ chain: this.chain, transport: http(this.rpcUrl) });
  }

  getChain(): Chain {
    return this.chain;
  }

  getPublicClient(): PublicClient {
    return this.publicClient;
  }

  /** A fresh WalletClient for the given account — one per caller, since each account
   *  (paymaster signer, relayer signer, ...) needs its own. */
  getWalletClient(account: Account): WalletClient {
    return createWalletClient({ account, chain: this.chain, transport: http(this.rpcUrl) });
  }
}
