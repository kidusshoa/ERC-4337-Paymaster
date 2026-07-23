import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Address, Hex, LocalAccount } from 'viem';
import { RELAYER_SIGNER_SERVICE, SignerService } from '../crypto/signer.interface';
import { ViemClientService } from '../crypto/viem-client.service';
import { createSignerAccount } from '../crypto/signer-account.util';
import { UserOperation } from '../../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { packAccountGasLimits, packGasFees } from '../paymaster/signing/packed-user-op.util';
import { ENTRY_POINT_ABI } from './entry-point.abi';
import { UserOpStatusResponseDto } from './dto/userop-status-response.dto';
import { UserOpStateMachineService } from './user-op-state-machine.service';

/**
 * Submits fully-signed UserOperations to the real EntryPoint (this backend acting as
 * its own bundler for the ops it sponsors) and tracks them through
 * UserOpStateMachineService. Confirmation is watched in the background — submit()
 * returns as soon as the transaction is broadcast, matching how a real bundler API
 * behaves, rather than blocking the HTTP response on mining.
 */
@Injectable()
export class RelayerService implements OnModuleInit {
  private readonly logger = new Logger(RelayerService.name);
  private relayerAccount!: LocalAccount;

  constructor(
    @Inject(RELAYER_SIGNER_SERVICE) private readonly relayerSigner: SignerService,
    private readonly viemClientService: ViemClientService,
    private readonly prisma: PrismaService,
    private readonly stateMachine: UserOpStateMachineService,
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

    const userOp = {
      sender: row.sender as Address,
      nonce: BigInt(row.nonce),
      initCode: row.initCode as Hex,
      callData: row.callData as Hex,
      accountGasLimits: packAccountGasLimits({
        verificationGasLimit: BigInt(row.verificationGasLimit),
        callGasLimit: BigInt(row.callGasLimit),
      }),
      preVerificationGas: BigInt(row.preVerificationGas),
      gasFees: packGasFees({
        maxPriorityFeePerGas: BigInt(row.opMaxPriorityFeePerGas),
        maxFeePerGas: BigInt(row.opMaxFeePerGas),
      }),
      paymasterAndData: row.paymasterAndData as Hex,
      signature: signature as Hex,
    };

    const publicClient = this.viemClientService.getPublicClient();
    const walletClient = this.viemClientService.getWalletClient(this.relayerAccount);
    const { maxFeePerGas, maxPriorityFeePerGas } = await publicClient.estimateFeesPerGas();

    const txHash = await walletClient.writeContract({
      chain: this.viemClientService.getChain(),
      account: this.relayerAccount,
      address: row.entryPoint as Address,
      abi: ENTRY_POINT_ABI,
      functionName: 'handleOps',
      args: [[userOp], this.relayerAccount.address],
      maxFeePerGas,
      maxPriorityFeePerGas,
    });

    await this.stateMachine.markSubmitted(userOpHash, {
      submittedTxHash: txHash,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });

    // Fire-and-forget: don't block the response on mining. Phase 12 replaces this
    // with a BullMQ delayed job that also detects "stuck" and bumps gas; for now a
    // failure here just leaves the row at SUBMITTED; that's still an accurate status.
    this.watchForConfirmation(userOpHash, txHash).catch((err) =>
      this.logger.error(
        `Failed to watch confirmation for ${userOpHash}`,
        err instanceof Error ? err.stack : err,
      ),
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

  private async watchForConfirmation(userOpHash: string, txHash: Hex): Promise<void> {
    const publicClient = this.viemClientService.getPublicClient();

    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status === 'success') {
        await this.stateMachine.markConfirmed(userOpHash, {
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
        });
      } else {
        await this.stateMachine.markFailed(userOpHash, 'Transaction reverted');
      }
    } catch (err) {
      await this.stateMachine.markFailed(
        userOpHash,
        err instanceof Error ? err.message : 'Unknown error',
      );
    }
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
