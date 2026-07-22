import { envValidationSchema } from './env.validation';

const VALID_BASE_ENV = {
  SIGNER_PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  DATABASE_URL: 'postgresql://paymaster:paymaster@localhost:5434/paymaster?schema=public',
  ENTRY_POINT_ADDRESS: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  PAYMASTER_CONTRACT_ADDRESS: '0x2e234DAe75C793f67A35089C9d99245E1C58470b',
};

describe('envValidationSchema', () => {
  it('applies defaults given only the required fields', () => {
    const { error, value } = envValidationSchema.validate(VALID_BASE_ENV);

    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
    expect(value.PORT).toBe(5010);
    expect(value.CHAIN_ID).toBe(31337);
    expect(value.SIGNER_BACKEND).toBe('local');
    expect(value.PAYMASTER_VERIFICATION_GAS_LIMIT).toBe(100_000);
    expect(value.SPONSOR_VALID_SECONDS).toBe(180);
  });

  it('accepts a fully explicit configuration', () => {
    const { error } = envValidationSchema.validate({
      ...VALID_BASE_ENV,
      NODE_ENV: 'production',
      PORT: 8080,
      CHAIN_ID: 11155111,
      REDIS_URL: 'redis://localhost:6381',
    });
    expect(error).toBeUndefined();
  });

  it('rejects a non-numeric PORT', () => {
    const { error } = envValidationSchema.validate({ ...VALID_BASE_ENV, PORT: 'not-a-number' });
    expect(error).toBeDefined();
  });

  it('rejects an out-of-range PORT', () => {
    const { error } = envValidationSchema.validate({ ...VALID_BASE_ENV, PORT: 99999 });
    expect(error).toBeDefined();
  });

  it('rejects an unrecognized NODE_ENV', () => {
    const { error } = envValidationSchema.validate({ ...VALID_BASE_ENV, NODE_ENV: 'staging' });
    expect(error).toBeDefined();
  });

  it('requires SIGNER_PRIVATE_KEY when SIGNER_BACKEND is (or defaults to) "local"', () => {
    const { SIGNER_PRIVATE_KEY: _omit, ...withoutKey } = VALID_BASE_ENV;
    const { error } = envValidationSchema.validate(withoutKey);
    expect(error?.message).toMatch(/SIGNER_PRIVATE_KEY/);
  });

  it('rejects a malformed SIGNER_PRIVATE_KEY', () => {
    const { error } = envValidationSchema.validate({
      ...VALID_BASE_ENV,
      SIGNER_PRIVATE_KEY: '0x1234',
    });
    expect(error).toBeDefined();
  });

  it('rejects an unsupported SIGNER_BACKEND', () => {
    const { error } = envValidationSchema.validate({ ...VALID_BASE_ENV, SIGNER_BACKEND: 'kms' });
    expect(error).toBeDefined();
  });

  it.each(['DATABASE_URL', 'ENTRY_POINT_ADDRESS', 'PAYMASTER_CONTRACT_ADDRESS'])(
    'requires %s',
    (key) => {
      const rest = { ...VALID_BASE_ENV };
      delete (rest as Record<string, unknown>)[key];
      const { error } = envValidationSchema.validate(rest);
      expect(error?.message).toContain(key);
    },
  );

  it('rejects a malformed contract address', () => {
    const { error } = envValidationSchema.validate({
      ...VALID_BASE_ENV,
      ENTRY_POINT_ADDRESS: 'not-an-address',
    });
    expect(error).toBeDefined();
  });
});
