import { HttpException, HttpStatus } from '@nestjs/common';

/** Thrown once a wallet has used up its daily sponsored-op allowance under the
 *  matched policy — distinct from PolicyViolationException since this is expected to
 *  resolve on its own (tomorrow), not a request the caller should change. */
export class QuotaExceededException extends HttpException {
  constructor(walletAddress: string, dailyQuota: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'QuotaExceeded',
        message: `Wallet ${walletAddress} has reached its daily quota of ${dailyQuota} sponsored operations`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
