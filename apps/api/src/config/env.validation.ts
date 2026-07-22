import * as Joi from 'joi';

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
});
