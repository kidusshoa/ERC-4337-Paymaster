import { Hex, isHex, PrivateKeyAccount } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { SignerService } from './signer.interface';

/**
 * Development/self-hosted SignerService backed by a raw private key held in process
 * memory. Fine for local dev and Anvil/testnet use; production deployments should
 * swap `SIGNER_BACKEND` to a future KMS-backed implementation instead (see
 * signer.interface.ts) rather than shipping a raw key.
 */
export class LocalPrivateKeySigner implements SignerService {
  private readonly account: PrivateKeyAccount;

  constructor(privateKey: string) {
    if (!isHex(privateKey) || privateKey.length !== 66) {
      throw new Error(
        'LocalPrivateKeySigner: private key must be a 0x-prefixed 32-byte hex string',
      );
    }
    this.account = privateKeyToAccount(privateKey);
  }

  async getAddress(): Promise<Hex> {
    return this.account.address;
  }

  async signDigest(digest: Hex): Promise<Hex> {
    return this.account.sign({ hash: digest });
  }
}
