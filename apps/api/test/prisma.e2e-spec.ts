import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { UserOpStatus } from '../generated/prisma/enums';
import { PrismaModule } from '../src/modules/prisma/prisma.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';

/**
 * Proves the persistence layer, not app wiring: a real UserOperation row can be
 * created and moved through the relayer's state machine (PENDING -> SUBMITTED ->
 * CONFIRMED), a SponsorshipPolicy can be linked to it, and WalletQuotaUsage's
 * compound-unique constraint enforces one counter row per (wallet, policy, day).
 * Runs against the real docker-compose Postgres — not mocked.
 */
describe('Prisma persistence (integration)', () => {
  let prisma: PrismaService;
  const createdUserOpHashes: string[] = [];
  let policyId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
    }).compile();

    prisma = moduleFixture.get(PrismaService);
    await prisma.$connect();

    const policy = await prisma.sponsorshipPolicy.create({
      data: {
        name: 'integration-test-policy',
        chainId: 31337,
        targetContract: '0x0000000000000000000000000000000000dEaD',
        allowedSelectors: ['0xa9059cbb'],
        dailyQuota: 5,
        isActive: true,
      },
    });
    policyId = policy.id;
  });

  afterAll(async () => {
    await prisma.userOperation.deleteMany({ where: { userOpHash: { in: createdUserOpHashes } } });
    await prisma.walletQuotaUsage.deleteMany({ where: { policyId } });
    await prisma.sponsorshipPolicy.delete({ where: { id: policyId } });
    await prisma.$disconnect();
  });

  function uniqueHash(label: string): string {
    const hash = `0xtest-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    createdUserOpHashes.push(hash);
    return hash;
  }

  it('creates a UserOperation defaulting to PENDING', async () => {
    const hash = uniqueHash('create');
    const op = await prisma.userOperation.create({
      data: {
        userOpHash: hash,
        chainId: 31337,
        entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
        sender: '0x1111111111111111111111111111111111111111',
        nonce: '0',
        callData: '0x',
        paymasterAndData: '0x',
        signature: '0x',
        policyId,
      },
    });

    expect(op.status).toBe(UserOpStatus.PENDING);
    expect(op.policyId).toBe(policyId);
  });

  it('persists PENDING -> SUBMITTED -> CONFIRMED transitions', async () => {
    const hash = uniqueHash('lifecycle');
    await prisma.userOperation.create({
      data: {
        userOpHash: hash,
        chainId: 31337,
        entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
        sender: '0x2222222222222222222222222222222222222222',
        nonce: '0',
        callData: '0x',
        paymasterAndData: '0x',
        signature: '0x',
      },
    });

    await prisma.userOperation.update({
      where: { userOpHash: hash },
      data: { status: UserOpStatus.SUBMITTED, submittedTxHash: '0xabc123' },
    });

    let reloaded = await prisma.userOperation.findUniqueOrThrow({ where: { userOpHash: hash } });
    expect(reloaded.status).toBe(UserOpStatus.SUBMITTED);
    expect(reloaded.submittedTxHash).toBe('0xabc123');

    await prisma.userOperation.update({
      where: { userOpHash: hash },
      data: { status: UserOpStatus.CONFIRMED, blockNumber: 123n, gasUsed: '21000' },
    });

    reloaded = await prisma.userOperation.findUniqueOrThrow({ where: { userOpHash: hash } });
    expect(reloaded.status).toBe(UserOpStatus.CONFIRMED);
    expect(reloaded.blockNumber).toBe(123n);
  });

  it('tracks a STUCK detour with an incrementing bumpCount', async () => {
    const hash = uniqueHash('stuck');
    await prisma.userOperation.create({
      data: {
        userOpHash: hash,
        chainId: 31337,
        entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
        sender: '0x3333333333333333333333333333333333333333',
        nonce: '0',
        callData: '0x',
        paymasterAndData: '0x',
        signature: '0x',
        status: UserOpStatus.SUBMITTED,
      },
    });

    const stuck = await prisma.userOperation.update({
      where: { userOpHash: hash },
      data: { status: UserOpStatus.STUCK, bumpCount: { increment: 1 } },
    });
    expect(stuck.status).toBe(UserOpStatus.STUCK);
    expect(stuck.bumpCount).toBe(1);

    const resubmitted = await prisma.userOperation.update({
      where: { userOpHash: hash },
      data: { status: UserOpStatus.SUBMITTED },
    });
    expect(resubmitted.status).toBe(UserOpStatus.SUBMITTED);
    expect(resubmitted.bumpCount).toBe(1);
  });

  it('enforces one WalletQuotaUsage row per (wallet, policy, day)', async () => {
    const wallet = '0x4444444444444444444444444444444444444444';
    const day = new Date('2026-01-01T00:00:00.000Z');

    await prisma.walletQuotaUsage.create({
      data: { walletAddress: wallet, policyId, day, opsCount: 1 },
    });

    await expect(
      prisma.walletQuotaUsage.create({
        data: { walletAddress: wallet, policyId, day, opsCount: 1 },
      }),
    ).rejects.toThrow();

    const bumped = await prisma.walletQuotaUsage.update({
      where: { walletAddress_policyId_day: { walletAddress: wallet, policyId, day } },
      data: { opsCount: { increment: 1 } },
    });
    expect(bumped.opsCount).toBe(2);
  });
});
