import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { recoverAddress, hashMessage } from 'viem';
import { AppModule } from '../src/app.module';
import { computePaymasterHash } from '../src/modules/paymaster/signing/packed-user-op.util';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const SIGNER_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

function randomAddress(): string {
  const suffix = Math.random().toString(16).slice(2).padEnd(38, '0').slice(0, 38);
  return `0x${suffix}aa`;
}

function baseBody(overrides: Partial<Record<string, string>> = {}) {
  return {
    sender: randomAddress(),
    nonce: '0',
    initCode: '0x',
    callData: '0x1234abcd',
    callGasLimit: '200000',
    verificationGasLimit: '100000',
    preVerificationGas: '50000',
    maxFeePerGas: '1000000000',
    maxPriorityFeePerGas: '2000000000',
    targetContract: randomAddress(),
    selector: '0xa9059cbb',
    ...overrides,
  };
}

describe('POST /paymaster/sponsor (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdUserOpHashes: string[] = [];
  const createdPolicyIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.userOperation.deleteMany({ where: { userOpHash: { in: createdUserOpHashes } } });
    await prisma.walletQuotaUsage.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
    await prisma.sponsorshipPolicy.deleteMany({ where: { id: { in: createdPolicyIds } } });
    await app.close();
  });

  it('sponsors a valid UserOp under the seeded wildcard policy', async () => {
    const body = baseBody();

    const response = await request(app.getHttpServer())
      .post('/paymaster/sponsor')
      .send(body)
      .expect(200);

    expect(response.body).toEqual({
      paymasterAndData: expect.stringMatching(/^0x[0-9a-f]{362}$/i),
      userOpHash: expect.stringMatching(/^0x[0-9a-f]{64}$/i),
      validUntil: expect.any(Number),
      validAfter: 0,
    });
    createdUserOpHashes.push(response.body.userOpHash);

    // The signature embedded in paymasterAndData must recover to the configured
    // signer — i.e. exactly what the on-chain VerifyingPaymaster would check.
    const paymasterAddress = process.env.PAYMASTER_CONTRACT_ADDRESS as `0x${string}`;
    const digest = computePaymasterHash({
      userOp: {
        sender: body.sender as `0x${string}`,
        nonce: BigInt(body.nonce),
        initCode: body.initCode as `0x${string}`,
        callData: body.callData as `0x${string}`,
        callGasLimit: BigInt(body.callGasLimit),
        verificationGasLimit: BigInt(body.verificationGasLimit),
        preVerificationGas: BigInt(body.preVerificationGas),
        maxFeePerGas: BigInt(body.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(body.maxPriorityFeePerGas),
      },
      paymasterAddress,
      paymasterVerificationGasLimit: 100_000n,
      paymasterPostOpGasLimit: 0n,
      chainId: 31337,
      validUntil: response.body.validUntil,
      validAfter: response.body.validAfter,
    });

    const signature = `0x${response.body.paymasterAndData.slice(2 + 116 * 2)}` as `0x${string}`;
    const recovered = await recoverAddress({ hash: hashMessage({ raw: digest }), signature });
    expect(recovered).toBe(SIGNER_ADDRESS);
  });

  it('persists a UserOperation row with status PENDING', async () => {
    const body = baseBody();
    const response = await request(app.getHttpServer())
      .post('/paymaster/sponsor')
      .send(body)
      .expect(200);
    createdUserOpHashes.push(response.body.userOpHash);

    const row = await prisma.userOperation.findUniqueOrThrow({
      where: { userOpHash: response.body.userOpHash },
    });
    expect(row.status).toBe('PENDING');
    expect(row.sender.toLowerCase()).toBe(body.sender.toLowerCase());
    expect(row.policyId).not.toBeNull();
  });

  it('rejects a disallowed method under a contract-specific policy (even though the wildcard would allow it)', async () => {
    const targetContract = randomAddress();
    const policy = await prisma.sponsorshipPolicy.create({
      data: {
        name: 'e2e-restricted-policy',
        chainId: 31337,
        targetContract,
        allowedSelectors: ['0xa9059cbb'],
        dailyQuota: 5,
        isActive: true,
      },
    });
    createdPolicyIds.push(policy.id);

    const response = await request(app.getHttpServer())
      .post('/paymaster/sponsor')
      .send(baseBody({ targetContract, selector: '0xffffffff' }))
      .expect(403);

    expect(response.body).toMatchObject({ statusCode: 403, error: 'PolicyViolation' });
  });

  it('rejects once the sender wallet exhausts its daily quota', async () => {
    const targetContract = randomAddress();
    const policy = await prisma.sponsorshipPolicy.create({
      data: {
        name: 'e2e-quota-policy',
        chainId: 31337,
        targetContract,
        allowedSelectors: [],
        dailyQuota: 2,
        isActive: true,
      },
    });
    createdPolicyIds.push(policy.id);

    const sender = randomAddress();
    // Distinct nonces — two truly-identical requests (same sender/nonce/etc.) signed
    // within the same wall-clock second would collide on userOpHash and hit the
    // duplicate-request 409 path instead, which isn't what this test is exercising.
    const send = (nonce: string) =>
      request(app.getHttpServer())
        .post('/paymaster/sponsor')
        .send(baseBody({ sender, targetContract, nonce }));

    const first = await send('0').expect(200);
    createdUserOpHashes.push(first.body.userOpHash);
    const second = await send('1').expect(200);
    createdUserOpHashes.push(second.body.userOpHash);

    const third = await send('2').expect(429);
    expect(third.body).toMatchObject({ statusCode: 429, error: 'QuotaExceeded' });
  });

  it('rejects a malformed request body (validation pipe)', async () => {
    await request(app.getHttpServer())
      .post('/paymaster/sponsor')
      .send(baseBody({ sender: 'not-an-address' }))
      .expect(400);
  });
});
