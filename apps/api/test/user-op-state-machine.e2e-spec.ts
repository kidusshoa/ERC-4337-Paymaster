import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { UserOpStatus } from '../generated/prisma/enums';
import { PrismaModule } from '../src/modules/prisma/prisma.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { UserOpStateMachineService } from '../src/modules/relayer/user-op-state-machine.service';

describe('UserOpStateMachineService (integration)', () => {
  let prisma: PrismaService;
  let stateMachine: UserOpStateMachineService;
  const createdHashes: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
      providers: [UserOpStateMachineService],
    }).compile();

    prisma = moduleFixture.get(PrismaService);
    stateMachine = moduleFixture.get(UserOpStateMachineService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.userOperation.deleteMany({ where: { userOpHash: { in: createdHashes } } });
    await prisma.$disconnect();
  });

  async function createPendingOp(label: string, status: UserOpStatus = UserOpStatus.PENDING) {
    const userOpHash = `0xstate-machine-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    createdHashes.push(userOpHash);
    await prisma.userOperation.create({
      data: {
        userOpHash,
        chainId: 31337,
        entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
        sender: '0x1111111111111111111111111111111111111111',
        nonce: '0',
        callGasLimit: '200000',
        verificationGasLimit: '100000',
        preVerificationGas: '50000',
        opMaxFeePerGas: '1000000000',
        opMaxPriorityFeePerGas: '2000000000',
        callData: '0x',
        paymasterAndData: '0x',
        signature: '0x',
        status,
      },
    });
    return userOpHash;
  }

  it('moves PENDING -> SUBMITTED', async () => {
    const hash = await createPendingOp('submit');
    await stateMachine.markSubmitted(hash, {
      submittedTxHash: '0xtx1',
      relayerNonce: 0,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    });

    const row = await prisma.userOperation.findUniqueOrThrow({ where: { userOpHash: hash } });
    expect(row.status).toBe(UserOpStatus.SUBMITTED);
    expect(row.submittedTxHash).toBe('0xtx1');
    expect(row.maxFeePerGas).toBe('2000000000');
  });

  it('moves SUBMITTED -> CONFIRMED', async () => {
    const hash = await createPendingOp('confirm', UserOpStatus.SUBMITTED);
    await stateMachine.markConfirmed(hash, { blockNumber: 42n, gasUsed: 54_000n });

    const row = await prisma.userOperation.findUniqueOrThrow({ where: { userOpHash: hash } });
    expect(row.status).toBe(UserOpStatus.CONFIRMED);
    expect(row.blockNumber).toBe(42n);
    expect(row.gasUsed).toBe('54000');
  });

  it('moves SUBMITTED -> FAILED', async () => {
    const hash = await createPendingOp('fail', UserOpStatus.SUBMITTED);
    await stateMachine.markFailed(hash, 'reverted');

    const row = await prisma.userOperation.findUniqueOrThrow({ where: { userOpHash: hash } });
    expect(row.status).toBe(UserOpStatus.FAILED);
    expect(row.failureReason).toBe('reverted');
  });

  it('allows STUCK -> CONFIRMED (Phase 12 resubmission landing)', async () => {
    const hash = await createPendingOp('stuck-confirm', UserOpStatus.STUCK);
    await stateMachine.markConfirmed(hash, { blockNumber: 7n, gasUsed: 21_000n });

    const row = await prisma.userOperation.findUniqueOrThrow({ where: { userOpHash: hash } });
    expect(row.status).toBe(UserOpStatus.CONFIRMED);
  });

  it('rejects an invalid transition (PENDING -> CONFIRMED, skipping SUBMITTED)', async () => {
    const hash = await createPendingOp('invalid');
    await expect(
      stateMachine.markConfirmed(hash, { blockNumber: 1n, gasUsed: 1n }),
    ).rejects.toThrow();

    const row = await prisma.userOperation.findUniqueOrThrow({ where: { userOpHash: hash } });
    expect(row.status).toBe(UserOpStatus.PENDING);
  });

  it('rejects double-submission (SUBMITTED -> SUBMITTED again is not a PENDING/STUCK source)', async () => {
    const hash = await createPendingOp('double-submit', UserOpStatus.CONFIRMED);
    await expect(
      stateMachine.markSubmitted(hash, {
        submittedTxHash: '0xtx2',
        relayerNonce: 0,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
      }),
    ).rejects.toThrow();
  });

  it('moves SUBMITTED -> STUCK', async () => {
    const hash = await createPendingOp('stuck', UserOpStatus.SUBMITTED);
    await stateMachine.markStuck(hash);

    const row = await prisma.userOperation.findUniqueOrThrow({ where: { userOpHash: hash } });
    expect(row.status).toBe(UserOpStatus.STUCK);
  });

  it('rejects marking PENDING as STUCK (only a SUBMITTED op can go stuck)', async () => {
    const hash = await createPendingOp('invalid-stuck');
    await expect(stateMachine.markStuck(hash)).rejects.toThrow();
  });

  it('increments bumpCount and persists relayerGasLimit on a gas-bumped resubmission', async () => {
    const hash = await createPendingOp('bump', UserOpStatus.STUCK);

    await stateMachine.markSubmitted(hash, {
      submittedTxHash: '0xtx-bumped-1',
      relayerNonce: 3,
      relayerGasLimit: 250_000n,
      maxFeePerGas: 2_400_000_000n,
      maxPriorityFeePerGas: 1_200_000_000n,
      isResubmission: true,
    });

    let row = await prisma.userOperation.findUniqueOrThrow({ where: { userOpHash: hash } });
    expect(row.status).toBe(UserOpStatus.SUBMITTED);
    expect(row.bumpCount).toBe(1);
    expect(row.relayerGasLimit).toBe('250000');
    expect(row.maxFeePerGas).toBe('2400000000');

    // A second bump on the same op increments further.
    await stateMachine.markStuck(hash);
    await stateMachine.markSubmitted(hash, {
      submittedTxHash: '0xtx-bumped-2',
      relayerNonce: 3,
      maxFeePerGas: 2_880_000_000n,
      maxPriorityFeePerGas: 1_440_000_000n,
      isResubmission: true,
    });

    row = await prisma.userOperation.findUniqueOrThrow({ where: { userOpHash: hash } });
    expect(row.bumpCount).toBe(2);
    expect(row.submittedTxHash).toBe('0xtx-bumped-2');
  });

  it('does not touch bumpCount or signature on the initial submission', async () => {
    const hash = await createPendingOp('initial-submit-fields');
    await stateMachine.markSubmitted(hash, {
      submittedTxHash: '0xtx-initial',
      relayerNonce: 0,
      relayerGasLimit: 200_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
      signature: '0xdeadbeef',
    });

    const row = await prisma.userOperation.findUniqueOrThrow({ where: { userOpHash: hash } });
    expect(row.bumpCount).toBe(0);
    expect(row.signature).toBe('0xdeadbeef');
    expect(row.relayerGasLimit).toBe('200000');
  });
});
