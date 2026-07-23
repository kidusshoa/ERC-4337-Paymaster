import * as Joi from 'joi';

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * Joi schema for process.env, validated once at boot via ConfigModule.forRoot().
 * `allowUnknown: true` (set where this is used) so later phases can add their own
 * env vars incrementally without every module needing to touch this one file —
 * but each var a given module actually *depends on* should still be declared here
 * so a missing/malformed value fails fast at startup instead of at first use.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(5010),

  // modules/crypto
  CHAIN_ID: Joi.number().integer().positive().default(31337),
  CHAIN_RPC_URL: Joi.string().uri().default('http://127.0.0.1:8545'),
  SIGNER_BACKEND: Joi.string().valid('local').default('local'),
  SIGNER_PRIVATE_KEY: Joi.when('SIGNER_BACKEND', {
    is: 'local',
    then: Joi.string()
      .pattern(/^0x[0-9a-fA-F]{64}$/)
      .required(),
    otherwise: Joi.string().optional(),
  }),

  // modules/relayer's signer, but provided unconditionally by CryptoModule (both
  // signer roles share SIGNER_BACKEND) — required as soon as CryptoModule is wired
  // in, whether or not modules/relayer itself exists yet.
  RELAYER_PRIVATE_KEY: Joi.when('SIGNER_BACKEND', {
    is: 'local',
    then: Joi.string()
      .pattern(/^0x[0-9a-fA-F]{64}$/)
      .required(),
    otherwise: Joi.string().optional(),
  }),

  // modules/redis, modules/queue
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .default('redis://127.0.0.1:6379'),
  // Namespaces BullMQ's Redis keys — distinct e2e test suites override this to their
  // own value so their workers never compete for each other's jobs (see
  // queue.module.ts's doc comment).
  BULLMQ_PREFIX: Joi.string().min(1).default('bullmq'),

  // common/guards/rate-limit.guard
  RATE_LIMIT_IP_MAX: Joi.number().integer().positive().default(50),
  RATE_LIMIT_IP_WINDOW_SECONDS: Joi.number().integer().positive().default(60),
  // Deliberately well above the seeded default SponsorshipPolicy's dailyQuota (5,
  // see prisma/seed.ts) — this tier is a velocity guard against API abuse, not the
  // business-level daily allowance (that's Policy.dailyQuota, enforced separately in
  // Postgres). Setting it equal to or below a policy's quota makes this tier the
  // silent bottleneck instead: raising the quota alone wouldn't help.
  RATE_LIMIT_WALLET_MAX: Joi.number().integer().positive().default(20),
  RATE_LIMIT_WALLET_WINDOW_SECONDS: Joi.number().integer().positive().default(86400),

  // prisma/schema.prisma (read directly by Prisma via its own env() call too — declared
  // here as well so a missing value fails fast with a clear error at Nest's boot,
  // before Prisma's own lazy-connect error would otherwise surface it later).
  DATABASE_URL: Joi.string().uri().required(),

  // modules/paymaster
  ENTRY_POINT_ADDRESS: Joi.string().pattern(ADDRESS_PATTERN).required(),
  PAYMASTER_CONTRACT_ADDRESS: Joi.string().pattern(ADDRESS_PATTERN).required(),
  PAYMASTER_VERIFICATION_GAS_LIMIT: Joi.number().integer().min(0).default(100_000),
  PAYMASTER_POSTOP_GAS_LIMIT: Joi.number().integer().min(0).default(0),
  SPONSOR_VALID_SECONDS: Joi.number().integer().positive().default(180),

  // modules/relayer's gas-bumping worker
  STUCK_CHECK_DELAY_SECONDS: Joi.number().integer().positive().default(45),
  GAS_BUMP_PERCENT: Joi.number().integer().positive().default(15),
  MAX_GAS_BUMP_ATTEMPTS: Joi.number().integer().positive().default(5),

  // modules/paymaster/admin — GET /admin/paymaster-status. No default: unset means
  // the endpoint is disabled (503) rather than open, so exposing operational
  // balance/stake info is an explicit opt-in, not an accident.
  ADMIN_API_KEY: Joi.string().min(16).optional(),
  // 0.05 ETH — below this, the endpoint's `lowBalance` flag flips so monitoring can
  // page someone before the paymaster runs out of deposit and starts reverting ops.
  PAYMASTER_LOW_BALANCE_THRESHOLD_WEI: Joi.string().pattern(/^\d+$/).default('50000000000000000'),
});
