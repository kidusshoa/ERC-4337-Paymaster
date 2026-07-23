import { timingSafeEqual } from 'crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

export const ADMIN_API_KEY_HEADER = 'x-admin-api-key';

/**
 * Gates admin/monitoring routes behind a static API key (`ADMIN_API_KEY`) — these
 * expose operational detail (paymaster deposit/stake) that isn't secret in the
 * cryptographic sense, but is still information an attacker could use to time a
 * griefing attack against a nearly-drained deposit, so it isn't left open by
 * default. No key configured means the route is disabled (503), not unauthenticated
 * (401) — a missing env var should fail closed, not silently expose the endpoint.
 */
@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configuredKey = this.configService.get<string>('ADMIN_API_KEY');
    if (!configuredKey) {
      throw new ServiceUnavailableException('Admin API is not configured (ADMIN_API_KEY unset)');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const providedKey = request.header(ADMIN_API_KEY_HEADER);
    if (!providedKey || !this.matches(providedKey, configuredKey)) {
      throw new UnauthorizedException('Invalid or missing admin API key');
    }

    return true;
  }

  /** Constant-time comparison — a naive `===` leaks the matching prefix length
   *  through response timing, letting an attacker recover the key byte by byte. */
  private matches(provided: string, configured: string): boolean {
    const providedBuf = Buffer.from(provided);
    const configuredBuf = Buffer.from(configured);
    if (providedBuf.length !== configuredBuf.length) {
      return false;
    }
    return timingSafeEqual(providedBuf, configuredBuf);
  }
}
