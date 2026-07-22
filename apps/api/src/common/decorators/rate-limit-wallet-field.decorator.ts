import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_WALLET_FIELD = 'rateLimitWalletField';

/**
 * Marks which field of the request body RateLimitGuard should read as the sender
 * wallet address for the per-wallet rate-limit tier — a dot path, e.g. "sender" or
 * "userOp.sender". Omit on routes with no wallet-scoped identity; only the IP tier
 * applies then.
 */
export const RateLimitWalletField = (path: string) => SetMetadata(RATE_LIMIT_WALLET_FIELD, path);
