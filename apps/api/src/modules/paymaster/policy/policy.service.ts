import { Injectable } from '@nestjs/common';
import { Address, Hex } from 'viem';
import { PrismaService } from '../../prisma/prisma.service';
import { SponsorshipPolicy } from '../../../../generated/prisma/client';
import { PolicyViolationException } from './policy-violation.exception';
import { QuotaExceededException } from './quota-exceeded.exception';

function truncateToUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Decides whether a UserOp is eligible for sponsorship: is there an active policy
 * whitelisting its target contract/method, and is the sender wallet still under that
 * policy's daily quota. Target contract and method selector are supplied explicitly
 * by the caller (SponsorUserOpDto) rather than parsed out of callData — decoding an
 * arbitrary smart account's callData format generically (SimpleAccount vs Safe vs
 * Kernel, etc. all differ) is out of scope here.
 */
@Injectable()
export class PolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async findApplicablePolicy(
    chainId: number,
    targetContract: Address,
    selector: Hex,
  ): Promise<SponsorshipPolicy> {
    const candidates = await this.prisma.sponsorshipPolicy.findMany({
      where: {
        chainId,
        isActive: true,
        OR: [{ targetContract: targetContract.toLowerCase() }, { targetContract: null }],
      },
      // Postgres treats NULL as distinct for unique constraints, so more than one
      // "any contract" policy per chain isn't schema-prevented; oldest-first makes
      // the tie-break deterministic if that ever happens.
      orderBy: { createdAt: 'asc' },
    });

    // A policy scoped to this exact contract takes precedence over an "any contract"
    // wildcard policy for the same chain.
    const policy =
      candidates.find((p) => p.targetContract?.toLowerCase() === targetContract.toLowerCase()) ??
      candidates.find((p) => p.targetContract === null);

    if (!policy) {
      throw new PolicyViolationException(
        `No active sponsorship policy covers target ${targetContract} on chain ${chainId}`,
      );
    }

    const methodAllowed =
      policy.allowedSelectors.length === 0 ||
      policy.allowedSelectors.some((s) => s.toLowerCase() === selector.toLowerCase());

    if (!methodAllowed) {
      throw new PolicyViolationException(
        `Method ${selector} is not whitelisted under policy "${policy.name}"`,
      );
    }

    return policy;
  }

  /**
   * Atomically increments today's usage counter for (wallet, policy) iff it's still
   * under the policy's daily quota, via a single conditional UPDATE — avoids a
   * check-then-increment race between concurrent requests for the same wallet.
   */
  async checkAndConsumeQuota(walletAddress: Address, policy: SponsorshipPolicy): Promise<void> {
    const day = truncateToUtcDate(new Date());
    const wallet = walletAddress.toLowerCase();

    await this.prisma.walletQuotaUsage.upsert({
      where: { walletAddress_policyId_day: { walletAddress: wallet, policyId: policy.id, day } },
      create: { walletAddress: wallet, policyId: policy.id, day, opsCount: 0 },
      update: {},
    });

    const { count } = await this.prisma.walletQuotaUsage.updateMany({
      where: {
        walletAddress: wallet,
        policyId: policy.id,
        day,
        opsCount: { lt: policy.dailyQuota },
      },
      data: { opsCount: { increment: 1 } },
    });

    if (count === 0) {
      throw new QuotaExceededException(walletAddress, policy.dailyQuota);
    }
  }
}
