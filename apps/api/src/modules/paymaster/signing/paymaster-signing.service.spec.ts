import { ConfigService } from '@nestjs/config';
import { hashMessage, recoverAddress } from 'viem';
import { LocalPrivateKeySigner } from '../../crypto/local-private-key.signer';
import { computePaymasterHash, LooseUserOpFields } from './packed-user-op.util';
import { PaymasterSigningService } from './paymaster-signing.service';

const SIGNER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const SIGNER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const CONFIG: Record<string, string | number> = {
  PAYMASTER_CONTRACT_ADDRESS: '0x2e234DAe75C793f67A35089C9d99245E1C58470b',
  ENTRY_POINT_ADDRESS: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  CHAIN_ID: 31337,
  PAYMASTER_VERIFICATION_GAS_LIMIT: 100_000,
  PAYMASTER_POSTOP_GAS_LIMIT: 0,
  SPONSOR_VALID_SECONDS: 180,
};

function fakeConfigService(): ConfigService {
  return {
    get: (key: string, def?: unknown) => CONFIG[key] ?? def,
    getOrThrow: (key: string) => {
      if (!(key in CONFIG)) throw new Error(`missing config: ${key}`);
      return CONFIG[key];
    },
  } as unknown as ConfigService;
}

const userOp: LooseUserOpFields = {
  sender: '0x1111111111111111111111111111111111111111',
  nonce: 0n,
  initCode: '0x',
  callData: '0xa9059cbb',
  callGasLimit: 200_000n,
  verificationGasLimit: 100_000n,
  preVerificationGas: 50_000n,
  maxFeePerGas: 1_000_000_000n,
  maxPriorityFeePerGas: 2_000_000_000n,
};

describe('PaymasterSigningService', () => {
  let service: PaymasterSigningService;

  beforeEach(() => {
    service = new PaymasterSigningService(
      new LocalPrivateKeySigner(SIGNER_PRIVATE_KEY),
      fakeConfigService(),
    );
  });

  it('produces a signature that recovers to the configured signer address', async () => {
    const result = await service.sign(userOp);

    // Re-derive the exact digest the contract would recompute on-chain and check the
    // signature embedded in paymasterAndData recovers against it. Signature starts at
    // byte 116 = 20 (address) + 16 + 16 (paymaster gas limits) + 64 (abi-encoded
    // validUntil/validAfter, each uint48 padded to a 32-byte word) — matches
    // VerifyingPaymaster.sol's SIGNATURE_OFFSET exactly.
    const signature = `0x${result.paymasterAndData.slice(2 + 116 * 2)}` as const;
    const digest = computePaymasterHash({
      userOp,
      paymasterAddress: CONFIG.PAYMASTER_CONTRACT_ADDRESS as `0x${string}`,
      paymasterVerificationGasLimit: 100_000n,
      paymasterPostOpGasLimit: 0n,
      chainId: 31337,
      validUntil: result.validUntil,
      validAfter: result.validAfter,
    });

    const recovered = await recoverAddress({ hash: hashMessage({ raw: digest }), signature });
    expect(recovered).toBe(SIGNER_ADDRESS);
  });

  it('assembles paymasterAndData with the correct byte layout', async () => {
    const result = await service.sign(userOp);

    // 20 (address) + 16 (paymasterVerificationGasLimit) + 16 (postOpGasLimit)
    // + 64 (abi-encoded validUntil/validAfter) + 65 (signature) = 181 bytes.
    expect(result.paymasterAndData).toMatch(/^0x[0-9a-f]{362}$/i);
    expect(result.paymasterAndData.slice(0, 42).toLowerCase()).toBe(
      (CONFIG.PAYMASTER_CONTRACT_ADDRESS as string).toLowerCase(),
    );
  });

  it('sets validAfter to 0 and validUntil ~SPONSOR_VALID_SECONDS in the future', async () => {
    const before = Math.floor(Date.now() / 1000);
    const result = await service.sign(userOp);
    const after = Math.floor(Date.now() / 1000);

    expect(result.validAfter).toBe(0);
    expect(result.validUntil).toBeGreaterThanOrEqual(before + 180);
    expect(result.validUntil).toBeLessThanOrEqual(after + 180);
  });

  it('returns a well-formed 32-byte userOpHash', async () => {
    const result = await service.sign(userOp);
    expect(result.userOpHash).toMatch(/^0x[0-9a-f]{64}$/i);
  });

  it('produces a different userOpHash for a different sender', async () => {
    const a = await service.sign(userOp);
    const b = await service.sign({
      ...userOp,
      sender: '0x2222222222222222222222222222222222222222',
    });
    expect(a.userOpHash).not.toBe(b.userOpHash);
  });
});
