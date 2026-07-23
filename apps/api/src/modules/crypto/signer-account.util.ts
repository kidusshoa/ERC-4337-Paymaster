import { hashMessage, hashTypedData, keccak256, parseSignature, serializeTransaction } from 'viem';
import { CustomSource, LocalAccount, toAccount } from 'viem/accounts';
import { SignerService } from './signer.interface';

/**
 * Bridges a SignerService (raw-digest signing only — see signer.interface.ts) into a
 * full viem Account usable by a WalletClient to send real transactions. Each of
 * signMessage/signTransaction/signTypedData reduces to "compute the digest viem would
 * sign locally, hand it to signDigest(), reassemble" — so swapping SIGNER_BACKEND to
 * a KMS-backed implementation makes the relayer's outgoing transactions KMS-signed
 * too, with no changes here.
 */
export async function createSignerAccount(signer: SignerService): Promise<LocalAccount> {
  const address = await signer.getAddress();

  const source: CustomSource = {
    address,

    async signMessage({ message }) {
      return signer.signDigest(hashMessage(message));
    },

    async signTransaction(transaction, options) {
      const serialize = options?.serializer ?? serializeTransaction;
      const unsignedSerialized = await serialize(transaction);
      const digest = keccak256(unsignedSerialized);
      const signature = await signer.signDigest(digest);
      return serialize(transaction, parseSignature(signature));
    },

    async signTypedData(typedDataDefinition) {
      return signer.signDigest(hashTypedData(typedDataDefinition));
    },
  };

  return toAccount(source);
}
