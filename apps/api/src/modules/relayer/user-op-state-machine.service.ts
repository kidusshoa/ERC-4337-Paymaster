import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, UserOpStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface MarkSubmittedParams {
  submittedTxHash: string;
  relayerNonce: number;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** Only set on the very first submission — estimated once and reused verbatim on
   *  every resubmission (see schema comment on relayerGasLimit for why). */
  relayerGasLimit?: bigint;
  /** Only present on the very first submission — a gas-bumped resubmission reuses
   *  whatever's already stored, since nothing the account/paymaster signed changes. */
  signature?: string;
  /** Set when this call is a gas-bumped resubmission, not the initial submission. */
  isResubmission?: boolean;
}

/**
 * Enforces valid transitions through the relayer's state machine:
 *   PENDING -> SUBMITTED -> CONFIRMED
 *                        -> FAILED
 *                        -> STUCK -> SUBMITTED (resubmitted with bumped gas, Phase 12)
 *                                 -> CONFIRMED / FAILED
 * Each transition is a single conditional UPDATE (status must currently be one of
 * `from`) rather than a read-then-write, so two concurrent callers acting on the same
 * row can't both "succeed" — the same atomic-guarded-update pattern as
 * PolicyService's quota check.
 */
@Injectable()
export class UserOpStateMachineService {
  constructor(private readonly prisma: PrismaService) {}

  async markSubmitted(userOpHash: string, params: MarkSubmittedParams): Promise<void> {
    const data: Prisma.UserOperationUpdateManyMutationInput = {
      status: UserOpStatus.SUBMITTED,
      submittedTxHash: params.submittedTxHash,
      relayerNonce: params.relayerNonce,
      maxFeePerGas: params.maxFeePerGas.toString(),
      maxPriorityFeePerGas: params.maxPriorityFeePerGas.toString(),
    };
    if (params.signature !== undefined) {
      data.signature = params.signature;
    }
    if (params.relayerGasLimit !== undefined) {
      data.relayerGasLimit = params.relayerGasLimit.toString();
    }
    if (params.isResubmission) {
      data.bumpCount = { increment: 1 };
    }

    await this.transition(userOpHash, [UserOpStatus.PENDING, UserOpStatus.STUCK], data);
  }

  async markStuck(userOpHash: string): Promise<void> {
    await this.transition(userOpHash, [UserOpStatus.SUBMITTED], { status: UserOpStatus.STUCK });
  }

  async markConfirmed(
    userOpHash: string,
    params: { blockNumber: bigint; gasUsed: bigint },
  ): Promise<void> {
    await this.transition(userOpHash, [UserOpStatus.SUBMITTED, UserOpStatus.STUCK], {
      status: UserOpStatus.CONFIRMED,
      blockNumber: params.blockNumber,
      gasUsed: params.gasUsed.toString(),
    });
  }

  async markFailed(userOpHash: string, failureReason: string): Promise<void> {
    await this.transition(userOpHash, [UserOpStatus.SUBMITTED, UserOpStatus.STUCK], {
      status: UserOpStatus.FAILED,
      failureReason,
    });
  }

  private async transition(
    userOpHash: string,
    fromStatuses: UserOpStatus[],
    data: Prisma.UserOperationUpdateManyMutationInput,
  ): Promise<void> {
    const { count } = await this.prisma.userOperation.updateMany({
      where: { userOpHash, status: { in: fromStatuses } },
      data,
    });

    if (count === 0) {
      throw new ConflictException(
        `UserOperation ${userOpHash} is not in a state that allows this transition (expected one of: ${fromStatuses.join(', ')})`,
      );
    }
  }
}
