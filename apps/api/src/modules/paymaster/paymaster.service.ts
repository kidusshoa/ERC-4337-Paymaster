import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Address, Hex } from 'viem';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SponsorUserOpDto } from './dto/sponsor-userop.dto';
import { SponsorUserOpResponseDto } from './dto/sponsor-userop-response.dto';
import { PolicyService } from './policy/policy.service';
import { PaymasterSigningService } from './signing/paymaster-signing.service';

const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

@Injectable()
export class PaymasterService {
  constructor(
    private readonly policyService: PolicyService,
    private readonly signingService: PaymasterSigningService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async sponsor(dto: SponsorUserOpDto): Promise<SponsorUserOpResponseDto> {
    const chainId = this.configService.get<number>('CHAIN_ID', 31337);

    const policy = await this.policyService.findApplicablePolicy(
      chainId,
      dto.targetContract as Address,
      dto.selector as Hex,
    );
    await this.policyService.checkAndConsumeQuota(dto.sender as Address, policy);

    const userOp = {
      sender: dto.sender as Address,
      nonce: BigInt(dto.nonce),
      initCode: dto.initCode as Hex,
      callData: dto.callData as Hex,
      callGasLimit: BigInt(dto.callGasLimit),
      verificationGasLimit: BigInt(dto.verificationGasLimit),
      preVerificationGas: BigInt(dto.preVerificationGas),
      maxFeePerGas: BigInt(dto.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(dto.maxPriorityFeePerGas),
    };

    const signed = await this.signingService.sign(userOp);
    const entryPoint = this.configService.getOrThrow<string>('ENTRY_POINT_ADDRESS');

    try {
      await this.prisma.userOperation.create({
        data: {
          userOpHash: signed.userOpHash,
          chainId,
          entryPoint,
          sender: dto.sender,
          nonce: userOp.nonce.toString(),
          callData: dto.callData,
          paymasterAndData: signed.paymasterAndData,
          // The account signs the finished op (including our paymasterAndData)
          // client-side, after this response — not known until Phase 11's submit.
          signature: '',
          policyId: policy.id,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
      ) {
        // Same UserOp signed twice within the same wall-clock second produces an
        // identical validUntil and therefore an identical userOpHash. Vanishingly
        // rare and self-resolving (the next attempt gets a fresh timestamp), so a
        // clear conflict for the client to retry beats a confusing 500.
        throw new ConflictException('Duplicate sponsorship request — retry');
      }
      throw err;
    }

    return {
      paymasterAndData: signed.paymasterAndData,
      userOpHash: signed.userOpHash,
      validUntil: signed.validUntil,
      validAfter: signed.validAfter,
    };
  }
}
