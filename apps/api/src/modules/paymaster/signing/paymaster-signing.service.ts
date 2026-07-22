import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Address, concatHex, encodeAbiParameters, Hex, hashMessage } from 'viem';
import { SIGNER_SERVICE, SignerService } from '../../crypto/signer.interface';
import {
  buildPaymasterAndDataHeader,
  computePaymasterHash,
  computeUserOpHash,
  LooseUserOpFields,
} from './packed-user-op.util';

export interface SignedSponsorship {
  paymasterAndData: Hex;
  userOpHash: Hex;
  validUntil: number;
  validAfter: number;
}

/**
 * Assembles paymasterAndData for a UserOperation: computes the same digest
 * VerifyingPaymaster.getHash() computes on-chain, has SIGNER_SERVICE sign it (raw
 * ECDSA over the EIP-191-prefixed digest, matching ECDSA.recover on the contract
 * side), then packs the header + validity window + signature together.
 */
@Injectable()
export class PaymasterSigningService {
  constructor(
    @Inject(SIGNER_SERVICE) private readonly signer: SignerService,
    private readonly configService: ConfigService,
  ) {}

  async sign(userOp: LooseUserOpFields): Promise<SignedSponsorship> {
    const paymasterAddress = this.configService.getOrThrow<Address>('PAYMASTER_CONTRACT_ADDRESS');
    const entryPointAddress = this.configService.getOrThrow<Address>('ENTRY_POINT_ADDRESS');
    const chainId = this.configService.get<number>('CHAIN_ID', 31337);
    const paymasterVerificationGasLimit = BigInt(
      this.configService.get<number>('PAYMASTER_VERIFICATION_GAS_LIMIT', 100_000),
    );
    const paymasterPostOpGasLimit = BigInt(
      this.configService.get<number>('PAYMASTER_POSTOP_GAS_LIMIT', 0),
    );
    const validSeconds = this.configService.get<number>('SPONSOR_VALID_SECONDS', 180);

    const validAfter = 0;
    const validUntil = Math.floor(Date.now() / 1000) + validSeconds;

    const digest = computePaymasterHash({
      userOp,
      paymasterAddress,
      paymasterVerificationGasLimit,
      paymasterPostOpGasLimit,
      chainId,
      validUntil,
      validAfter,
    });

    const signature = await this.signer.signDigest(hashMessage({ raw: digest }));

    const header = buildPaymasterAndDataHeader(
      paymasterAddress,
      paymasterVerificationGasLimit,
      paymasterPostOpGasLimit,
    );
    const encodedWindow = encodeAbiParameters(
      [{ type: 'uint48' }, { type: 'uint48' }],
      [validUntil, validAfter],
    );
    const paymasterAndData = concatHex([header, encodedWindow, signature]);

    const userOpHash = computeUserOpHash({ userOp, paymasterAndData, entryPointAddress, chainId });

    return { paymasterAndData, userOpHash, validUntil, validAfter };
  }
}
