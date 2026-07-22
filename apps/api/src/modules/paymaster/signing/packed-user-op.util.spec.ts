import {
  computePaymasterHash,
  computeUserOpHash,
  LooseUserOpFields,
  packAccountGasLimits,
  packGasFees,
  packHighLow128,
} from './packed-user-op.util';

const baseUserOp: LooseUserOpFields = {
  sender: '0x1111111111111111111111111111111111111111',
  nonce: 5n,
  initCode: '0x',
  callData: '0x1234abcd',
  callGasLimit: 200000n,
  verificationGasLimit: 100000n,
  preVerificationGas: 50000n,
  maxFeePerGas: 1000000000n,
  maxPriorityFeePerGas: 2000000000n,
};

describe('packHighLow128', () => {
  it('packs high/low into a 32-byte value with high bits first', () => {
    expect(packHighLow128(1n, 2n)).toBe(`0x${'0'.repeat(31)}1${'0'.repeat(31)}2`);
  });

  it('rejects values outside uint128 range', () => {
    expect(() => packHighLow128(-1n, 0n)).toThrow();
    expect(() => packHighLow128(0n, 1n << 128n)).toThrow();
  });
});

describe('packAccountGasLimits / packGasFees', () => {
  it('puts verificationGasLimit in the high 128 bits, callGasLimit in the low', () => {
    expect(packAccountGasLimits(baseUserOp)).toBe(packHighLow128(100000n, 200000n));
  });

  it('puts maxPriorityFeePerGas in the high 128 bits, maxFeePerGas in the low', () => {
    expect(packGasFees(baseUserOp)).toBe(packHighLow128(2000000000n, 1000000000n));
  });
});

describe('computePaymasterHash', () => {
  const params = {
    userOp: baseUserOp,
    paymasterAddress: '0x2e234DAe75C793f67A35089C9d99245E1C58470b' as const,
    paymasterVerificationGasLimit: 100000n,
    paymasterPostOpGasLimit: 0n,
    chainId: 31337,
    validUntil: 1784712539 + 180,
    validAfter: 0,
  };

  // Cross-checked directly against VerifyingPaymaster.getHash() on-chain (Foundry test,
  // Phase 9 build session) for these exact inputs — a real, not fabricated, vector.
  const EXPECTED_HASH = '0x6ca6876da46b65709044ba18327cfcae13f6c65b1d1524632b6d8a4c1b51506e';

  it('matches the on-chain VerifyingPaymaster.getHash() output for a known input', () => {
    expect(computePaymasterHash(params)).toBe(EXPECTED_HASH);
  });

  it('is deterministic for identical inputs', () => {
    expect(computePaymasterHash(params)).toBe(computePaymasterHash(params));
  });

  it('changes if any single field changes (avalanche property)', () => {
    const base = computePaymasterHash(params);

    expect(computePaymasterHash({ ...params, validUntil: params.validUntil + 1 })).not.toBe(base);
    expect(computePaymasterHash({ ...params, validAfter: 1 })).not.toBe(base);
    expect(computePaymasterHash({ ...params, chainId: 1 })).not.toBe(base);
    expect(computePaymasterHash({ ...params, userOp: { ...baseUserOp, nonce: 6n } })).not.toBe(
      base,
    );
    expect(
      computePaymasterHash({ ...params, userOp: { ...baseUserOp, callData: '0xdead' } }),
    ).not.toBe(base);
  });
});

describe('computeUserOpHash', () => {
  const params = {
    userOp: baseUserOp,
    paymasterAndData: '0xdeadbeef' as const,
    entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const,
    chainId: 31337,
  };

  it('is deterministic for identical inputs', () => {
    expect(computeUserOpHash(params)).toBe(computeUserOpHash(params));
  });

  it('depends on the full paymasterAndData, including the signature bytes', () => {
    const base = computeUserOpHash(params);
    expect(computeUserOpHash({ ...params, paymasterAndData: '0xdeadbeef00' })).not.toBe(base);
  });

  it('changes if entryPoint or chainId changes (replay protection across deployments)', () => {
    const base = computeUserOpHash(params);
    expect(
      computeUserOpHash({
        ...params,
        entryPointAddress: '0x1111111111111111111111111111111111111111',
      }),
    ).not.toBe(base);
    expect(computeUserOpHash({ ...params, chainId: 1 })).not.toBe(base);
  });
});
