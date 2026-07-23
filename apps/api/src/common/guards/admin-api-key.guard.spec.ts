import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminApiKeyGuard } from './admin-api-key.guard';

function contextWithHeader(headerValue: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) => (name === 'x-admin-api-key' ? headerValue : undefined),
      }),
    }),
  } as unknown as ExecutionContext;
}

function configServiceWithKey(key: string | undefined): ConfigService {
  return { get: () => key } as unknown as ConfigService;
}

describe('AdminApiKeyGuard', () => {
  const REAL_KEY = 'a-real-admin-key-1234567890';

  it('throws ServiceUnavailableException when ADMIN_API_KEY is unset', () => {
    const guard = new AdminApiKeyGuard(configServiceWithKey(undefined));
    expect(() => guard.canActivate(contextWithHeader(REAL_KEY))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('throws UnauthorizedException when no header is provided', () => {
    const guard = new AdminApiKeyGuard(configServiceWithKey(REAL_KEY));
    expect(() => guard.canActivate(contextWithHeader(undefined))).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the header does not match', () => {
    const guard = new AdminApiKeyGuard(configServiceWithKey(REAL_KEY));
    expect(() => guard.canActivate(contextWithHeader('wrong-key'))).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the header is a different length (no crash from timingSafeEqual)', () => {
    const guard = new AdminApiKeyGuard(configServiceWithKey(REAL_KEY));
    expect(() => guard.canActivate(contextWithHeader('short'))).toThrow(UnauthorizedException);
  });

  it('allows the request through when the header matches exactly', () => {
    const guard = new AdminApiKeyGuard(configServiceWithKey(REAL_KEY));
    expect(guard.canActivate(contextWithHeader(REAL_KEY))).toBe(true);
  });
});
