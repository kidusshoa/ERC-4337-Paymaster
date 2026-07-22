import { HttpException, HttpStatus } from '@nestjs/common';

/** Thrown when a UserOp's target contract/method isn't covered by any active
 *  sponsorship policy — the caller should not retry without changing the request. */
export class PolicyViolationException extends HttpException {
  constructor(message: string) {
    super(
      { statusCode: HttpStatus.FORBIDDEN, error: 'PolicyViolation', message },
      HttpStatus.FORBIDDEN,
    );
  }
}
