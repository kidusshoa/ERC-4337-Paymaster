import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { Address, Hex, LocalAccount } from 'viem';
import { createSignerAccount } from '../../crypto/signer-account.util';
import { RELAYER_SIGNER_SERVICE, SignerService } from '../../crypto/signer.interface';
import { ViemClientService } from '../../crypto/viem-client.service';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPackedUserOp } from '../build-packed-user-op.util';
import { ENTRY_POINT_ABI } from '../entry-point.abi';
import { UserOpStateMachineService } from '../user-op-state-machine.service';
import {
  CONFIRMATION_CHECK_JOB,
  CONFIRMATION_CHECK_QUEUE,
  ConfirmationCheckJobData,
} from './confirmation-check.queue';

/**
 * Checks whether a submitted handleOps transaction has been mined by the time its
 * delayed job fires. Mined -> CONFIRMED/FAILED. Not yet mined -> STUCK, then bumps
 * the relayer's own outer-transaction fees by GAS_BUMP_PERCENT and resubmits with
 * the *same relayer nonce* (a genuine EIP-1559 replacement, not a new transaction),
 * scheduling another delayed check — up to MAX_GAS_BUMP_ATTEMPTS before giving up.
 */
@Processor(CONFIRMATION_CHECK_QUEUE)
export class ConfirmationCheckProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ConfirmationCheckProcessor.name);
  private relayerAccount!: LocalAccount;

  constructor(
    @Inject(RELAYER_SIGNER_SERVICE) private readonly relayerSigner: SignerService,
    private readonly viemClientService: ViemClientService,
    private readonly prisma: PrismaService,
    private readonly stateMachine: UserOpStateMachineService,
    private readonly configService: ConfigService,
    @InjectQueue(CONFIRMATION_CHECK_QUEUE) private readonly queue: Queue<ConfirmationCheckJobData>,
  ) {
    super();
  }

  async onModuleInit() {
    this.relayerAccount = await createSignerAccount(this.relayerSigner);
  }

  async process(job: Job<ConfirmationCheckJobData>): Promise<void> {
    const { userOpHash, txHash } = job.data;
    const publicClient = this.viemClientService.getPublicClient();

    const receipt = await publicClient
      .getTransactionReceipt({ hash: txHash as Hex })
      .catch(() => null);

    if (receipt) {
      if (receipt.status === 'success') {
        await this.stateMachine.markConfirmed(userOpHash, {
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
        });
      } else {
        await this.stateMachine.markFailed(userOpHash, 'Transaction reverted');
      }
      return;
    }

    await this.handleStuck(userOpHash);
  }

  private async handleStuck(userOpHash: string): Promise<void> {
    const row = await this.prisma.userOperation.findUniqueOrThrow({ where: { userOpHash } });
    const maxAttempts = this.configService.get<number>('MAX_GAS_BUMP_ATTEMPTS', 5);

    if (row.bumpCount >= maxAttempts) {
      await this.stateMachine.markFailed(
        userOpHash,
        `Exceeded max gas-bump attempts (${maxAttempts}) without confirmation`,
      );
      return;
    }

    await this.stateMachine.markStuck(userOpHash);
    this.logger.warn(
      `UserOp ${userOpHash} stuck (tx ${row.submittedTxHash}); bumping gas and resubmitting (attempt ${row.bumpCount + 1}/${maxAttempts})`,
    );

    const bumpPercent = this.configService.get<number>('GAS_BUMP_PERCENT', 15);
    const bumpedMaxFeePerGas = (BigInt(row.maxFeePerGas!) * BigInt(100 + bumpPercent)) / 100n;
    const bumpedMaxPriorityFeePerGas =
      (BigInt(row.maxPriorityFeePerGas!) * BigInt(100 + bumpPercent)) / 100n;

    const userOp = buildPackedUserOp(row, row.signature as Hex);
    const walletClient = this.viemClientService.getWalletClient(this.relayerAccount);

    const newTxHash = await walletClient.writeContract({
      chain: this.viemClientService.getChain(),
      account: this.relayerAccount,
      address: row.entryPoint as Address,
      abi: ENTRY_POINT_ABI,
      functionName: 'handleOps',
      args: [[userOp], this.relayerAccount.address],
      nonce: row.relayerNonce!,
      // Reuse the original estimate rather than re-estimating: gas estimation
      // against a still-pending same-nonce transaction gets confused (observed as
      // a spurious "AA25 invalid account nonce" revert), and the intrinsic gas an
      // op needs doesn't change just because its gas *price* is being bumped.
      gas: BigInt(row.relayerGasLimit!),
      maxFeePerGas: bumpedMaxFeePerGas,
      maxPriorityFeePerGas: bumpedMaxPriorityFeePerGas,
    });

    await this.stateMachine.markSubmitted(userOpHash, {
      submittedTxHash: newTxHash,
      relayerNonce: row.relayerNonce!,
      maxFeePerGas: bumpedMaxFeePerGas,
      maxPriorityFeePerGas: bumpedMaxPriorityFeePerGas,
      isResubmission: true,
    });

    const delaySeconds = this.configService.get<number>('STUCK_CHECK_DELAY_SECONDS', 45);
    await this.queue.add(
      CONFIRMATION_CHECK_JOB,
      { userOpHash, txHash: newTxHash },
      { delay: delaySeconds * 1000 },
    );
  }
}
