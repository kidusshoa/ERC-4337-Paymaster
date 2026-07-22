import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PolicyViolationException } from '../src/modules/paymaster/policy/policy-violation.exception';
import { PolicyService } from '../src/modules/paymaster/policy/policy.service';
import { QuotaExceededException } from '../src/modules/paymaster/policy/quota-exceeded.exception';
import { PrismaModule } from '../src/modules/prisma/prisma.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';

const ALLOWED_SELECTOR = '0xa9059cbb';

describe('PolicyService (integration)', () => {
  let prisma: PrismaService;
  let service: PolicyService;
  const policyIds: string[] = [];

  // Every test gets its own chain id, so policies one test creates can never be
  // matched by another test's findApplicablePolicy query (an "any contract"
  // wildcard policy, in particular, would otherwise leak across every later test
  // sharing a chain id).
  let nextChainId = 900_000;
  function isolatedChainId(): number {
    return nextChainId++;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
      providers: [PolicyService],
    }).compile();

    prisma = moduleFixture.get(PrismaService);
    service = moduleFixture.get(PolicyService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.walletQuotaUsage.deleteMany({ where: { policyId: { in: policyIds } } });
    await prisma.sponsorshipPolicy.deleteMany({ where: { id: { in: policyIds } } });
    await prisma.$disconnect();
  });

  async function createPolicy(data: {
    chainId: number;
    name: string;
    targetContract: string | null;
    allowedSelectors: string[];
    dailyQuota: number;
    isActive?: boolean;
  }) {
    const policy = await prisma.sponsorshipPolicy.create({
      data: { ...data, isActive: data.isActive ?? true },
    });
    policyIds.push(policy.id);
    return policy;
  }

  describe('findApplicablePolicy', () => {
    it('matches a policy scoped to the exact target contract', async () => {
      const chainId = isolatedChainId();
      const targetContract = '0x00000000000000000000000000000000abcdef';
      const policy = await createPolicy({
        chainId,
        name: 'scoped-policy',
        targetContract,
        allowedSelectors: [ALLOWED_SELECTOR],
        dailyQuota: 5,
      });

      const found = await service.findApplicablePolicy(chainId, targetContract, ALLOWED_SELECTOR);
      expect(found.id).toBe(policy.id);
    });

    it('prefers a contract-specific policy over an any-contract wildcard', async () => {
      const chainId = isolatedChainId();
      const targetContract = '0x00000000000000000000000000000000abcdef';

      await createPolicy({
        chainId,
        name: 'wildcard',
        targetContract: null,
        allowedSelectors: [],
        dailyQuota: 1,
      });
      const specific = await createPolicy({
        chainId,
        name: 'specific',
        targetContract,
        allowedSelectors: [],
        dailyQuota: 5,
      });

      const found = await service.findApplicablePolicy(chainId, targetContract, '0xdeadbeef');
      expect(found.id).toBe(specific.id);
    });

    it('falls back to a wildcard policy for an unlisted contract', async () => {
      const chainId = isolatedChainId();
      const wildcard = await createPolicy({
        chainId,
        name: 'wildcard-2',
        targetContract: null,
        allowedSelectors: [],
        dailyQuota: 1,
      });

      const found = await service.findApplicablePolicy(
        chainId,
        '0x0000000000000000000000000000000000f00d',
        '0xdeadbeef',
      );
      expect(found.id).toBe(wildcard.id);
    });

    it('rejects when no policy covers the target contract', async () => {
      const chainId = isolatedChainId();
      await expect(
        service.findApplicablePolicy(
          chainId,
          '0x000000000000000000000000000000000fffff',
          '0xdeadbeef',
        ),
      ).rejects.toBeInstanceOf(PolicyViolationException);
    });

    it('rejects an unlisted method under a selector-scoped policy', async () => {
      const chainId = isolatedChainId();
      const targetContract = '0x0000000000000000000000000000000000beef';
      await createPolicy({
        chainId,
        name: 'selector-scoped',
        targetContract,
        allowedSelectors: [ALLOWED_SELECTOR],
        dailyQuota: 5,
      });

      await expect(
        service.findApplicablePolicy(chainId, targetContract, '0xffffffff'),
      ).rejects.toBeInstanceOf(PolicyViolationException);
    });

    it('ignores an inactive policy', async () => {
      const chainId = isolatedChainId();
      const targetContract = '0x0000000000000000000000000000000000dead';
      await createPolicy({
        chainId,
        name: 'inactive',
        targetContract,
        allowedSelectors: [],
        dailyQuota: 5,
        isActive: false,
      });

      await expect(
        service.findApplicablePolicy(chainId, targetContract, '0xdeadbeef'),
      ).rejects.toBeInstanceOf(PolicyViolationException);
    });
  });

  describe('checkAndConsumeQuota', () => {
    it('allows requests under the quota, then rejects once exhausted', async () => {
      const chainId = isolatedChainId();
      const policy = await createPolicy({
        chainId,
        name: 'quota-test',
        targetContract: '0x0000000000000000000000000000000000aaaa',
        allowedSelectors: [],
        dailyQuota: 2,
      });
      const wallet = '0x1234000000000000000000000000000000aaaa';

      await service.checkAndConsumeQuota(wallet, policy);
      await service.checkAndConsumeQuota(wallet, policy);

      await expect(service.checkAndConsumeQuota(wallet, policy)).rejects.toBeInstanceOf(
        QuotaExceededException,
      );
    });

    it('tracks quota independently per wallet', async () => {
      const chainId = isolatedChainId();
      const policy = await createPolicy({
        chainId,
        name: 'quota-per-wallet',
        targetContract: '0x0000000000000000000000000000000000bbbb',
        allowedSelectors: [],
        dailyQuota: 1,
      });

      await service.checkAndConsumeQuota('0x1111000000000000000000000000000000bbbb', policy);
      await expect(
        service.checkAndConsumeQuota('0x2222000000000000000000000000000000bbbb', policy),
      ).resolves.toBeUndefined();
    });
  });
});
