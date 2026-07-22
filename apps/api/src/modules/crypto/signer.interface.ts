import { Hex } from 'viem';

/**
 * Signs an opaque 32-byte digest with a secp256k1 key. Deliberately knows nothing
 * about UserOperations, paymasters, or transactions — that encoding lives in whatever
 * calls this (e.g. modules/paymaster's signing service). Keeping the surface this thin
 * means an AWS KMS (or any HSM-backed) implementation is a drop-in replacement for
 * LocalPrivateKeySigner: neither the caller nor the rest of the app changes.
 */
export interface SignerService {
  /** The address corresponding to this signer's public key. */
  getAddress(): Promise<Hex>;

  /** Raw ECDSA signature (65-byte r + s + v) over the given 32-byte digest. */
  signDigest(digest: Hex): Promise<Hex>;
}

export const SIGNER_SERVICE = Symbol('SIGNER_SERVICE');
