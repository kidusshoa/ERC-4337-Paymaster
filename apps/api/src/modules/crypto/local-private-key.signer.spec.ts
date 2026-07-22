import { recoverAddress } from 'viem';
import { LocalPrivateKeySigner } from './local-private-key.signer';

// Anvil's well-known account #0 test key — never used on a real network.
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

describe('LocalPrivateKeySigner', () => {
  it('getAddress() matches the address derived from the private key', async () => {
    const signer = new LocalPrivateKeySigner(TEST_PRIVATE_KEY);
    expect(await signer.getAddress()).toBe(TEST_ADDRESS);
  });

  it('signDigest() produces a signature that recovers back to the signer address', async () => {
    const signer = new LocalPrivateKeySigner(TEST_PRIVATE_KEY);
    const digest = `0x${'ab'.repeat(32)}` as const;

    const signature = await signer.signDigest(digest);
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/i);

    const recovered = await recoverAddress({ hash: digest, signature });
    expect(recovered).toBe(await signer.getAddress());
  });

  it('rejects a malformed private key', () => {
    expect(() => new LocalPrivateKeySigner('not-a-key')).toThrow();
    expect(() => new LocalPrivateKeySigner('0x1234')).toThrow();
  });
});
