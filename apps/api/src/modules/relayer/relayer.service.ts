import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Address, Hex, LocalAccount } from 'viem';
import { UserOperation } from '../../../generated/prisma/client';
import { createSignerAccount } from '../crypto/signer-account.util';
import { RELAYER_SIGNER_SERVICE, SignerService } from '../crypto/signer.interface';
import { ViemClientService } from '../crypto/viem-client.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildPackedUserOp } from './build-packed-user-op.util';
import { UserOpStatusResponseDto } from './dto/userop-status-response.dto';
import { ENTRY_POINT_ABI } from './entry-point.abi';
import {
  CONFIRMATION_CHECK_JOB,
  CONFIRMATION_CHECK_QUEUE,
  ConfirmationCheckJobData,
} from './queue/confirmation-check.queue';
import { UserOpStateMachineService } from './user-op-state-machine.service';

/**
 * Submits fully-signed UserOperations to the real EntryPoint (this backend acting as
 * its own bundler for the ops it sponsors) and tracks them through
 * UserOpStateMachineService. submit() returns as soon as the transaction is
 * broadcast, matching how a real bundler API behaves; ConfirmationCheckProcessor
 * (a delayed BullMQ job) takes over from there, including detecting "stuck" and
 * bumping gas.
 */
@Injectable()
export class RelayerService implements OnModuleInit {
  private relayerAccount!: LocalAccount;

  constructor(
    @Inject(RELAYER_SIGNER_SERVICE) private readonly relayerSigner: SignerService,
    private readonly viemClientService: ViemClientService,
    private readonly prisma: PrismaService,
    private readonly stateMachine: UserOpStateMachineService,
    private readonly configService: ConfigService,
    @InjectQueue(CONFIRMATION_CHECK_QUEUE) private readonly queue: Queue<ConfirmationCheckJobData>,
  ) {}

  async onModuleInit() {
    this.relayerAccount = await createSignerAccount(this.relayerSigner);
  }

  async submit(userOpHash: string, signature: string): Promise<UserOpStatusResponseDto> {
    const row = await this.prisma.userOperation.findUnique({ where: { userOpHash } });
    if (!row) {
      throw new NotFoundException(`No UserOperation found for hash ${userOpHash}`);
    }
    if (row.status !== 'PENDING') {
      throw new ConflictException(
        `UserOperation ${userOpHash} is not PENDING (currently ${row.status})`,
      );
    }

    const userOp = buildPackedUserOp(row, signature as Hex);

    const publicClient = this.viemClientService.getPublicClient();
    const walletClient = this.viemClientService.getWalletClient(this.relayerAccount);
    const handleOpsCall = {
      address: row.entryPoint as Address,
      abi: ENTRY_POINT_ABI,
      functionName: 'handleOps' as const,
      args: [[userOp], this.relayerAccount.address] as const,
    };

    const [{ maxFeePerGas, maxPriorityFeePerGas }, relayerNonce, estimatedGas] = await Promise.all([
      publicClient.estimateFeesPerGas(),
      publicClient.getTransactionCount({
        address: this.relayerAccount.address,
        blockTag: 'pending',
      }),
      publicClient.estimateContractGas({ ...handleOpsCall, account: this.relayerAccount }),
    ]);
    // Estimated once here and reused as-is on every gas-bumped resubmission — see
    // the relayerGasLimit column comment in schema.prisma for why that matters.
    const relayerGasLimit = (estimatedGas * 120n) / 100n;

    const txHash = await walletClient.writeContract({
      ...handleOpsCall,
      chain: this.viemClientService.getChain(),
      account: this.relayerAccount,
      nonce: relayerNonce,
      gas: relayerGasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });

    await this.stateMachine.markSubmitted(userOpHash, {
      submittedTxHash: txHash,
      relayerNonce,
      relayerGasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      signature,
    });

    const delaySeconds = this.configService.get<number>('STUCK_CHECK_DELAY_SECONDS', 45);
    await this.queue.add(
      CONFIRMATION_CHECK_JOB,
      { userOpHash, txHash },
      { delay: delaySeconds * 1000 },
    );

    const updated = await this.prisma.userOperation.findUniqueOrThrow({ where: { userOpHash } });
    return this.toStatusResponse(updated);
  }

  async getStatus(userOpHash: string): Promise<UserOpStatusResponseDto> {
    const row = await this.prisma.userOperation.findUnique({ where: { userOpHash } });
    if (!row) {
      throw new NotFoundException(`No UserOperation found for hash ${userOpHash}`);
    }
    return this.toStatusResponse(row);
  }

  private toStatusResponse(row: UserOperation): UserOpStatusResponseDto {
    return {
      userOpHash: row.userOpHash,
      status: row.status,
      sender: row.sender,
      submittedTxHash: row.submittedTxHash,
      blockNumber: row.blockNumber !== null ? row.blockNumber.toString() : null,
      gasUsed: row.gasUsed,
      failureReason: row.failureReason,
      bumpCount: row.bumpCount,
    };
  }
}
