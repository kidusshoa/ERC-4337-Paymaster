import {
  recoverMessageAddress,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  TransactionSerializable,
} from 'viem';
import { LocalPrivateKeySigner } from './local-private-key.signer';
import { createSignerAccount } from './signer-account.util';

const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

describe('createSignerAccount', () => {
  it('exposes the address the underlying SignerService reports', async () => {
    const account = await createSignerAccount(new LocalPrivateKeySigner(PRIVATE_KEY));
    expect(account.address).toBe(ADDRESS);
  });

  it('signMessage produces a signature that recovers to the account address', async () => {
    const account = await createSignerAccount(new LocalPrivateKeySigner(PRIVATE_KEY));
    const message = 'hello relayer';

    const signature = await account.signMessage({ message });
    const recovered = await recoverMessageAddress({ message, signature });

    expect(recovered).toBe(ADDRESS);
  });

  it('signTransaction produces a signature that recovers to the account address', async () => {
    const account = await createSignerAccount(new LocalPrivateKeySigner(PRIVATE_KEY));
    const transaction: TransactionSerializable = {
      chainId: 31337,
      type: 'eip1559',
      nonce: 0,
      to: '0x1111111111111111111111111111111111111111',
      value: 1_000_000_000_000_000_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      gas: 21_000n,
    };

    const signedSerialized = await account.signTransaction(transaction);
    const recovered = await recoverTransactionAddress({
      serializedTransaction: signedSerialized as `0x02${string}`,
    });

    expect(recovered).toBe(ADDRESS);
  });

  it('signTypedData produces a signature that recovers to the account address', async () => {
    const account = await createSignerAccount(new LocalPrivateKeySigner(PRIVATE_KEY));
    const typedData = {
      domain: { name: 'Test', version: '1', chainId: 31337 },
      types: { Ping: [{ name: 'value', type: 'uint256' }] },
      primaryType: 'Ping' as const,
      message: { value: 42n },
    };

    const signature = await account.signTypedData(typedData);
    const recovered = await recoverTypedDataAddress({ ...typedData, signature });

    expect(recovered).toBe(ADDRESS);
  });
});
