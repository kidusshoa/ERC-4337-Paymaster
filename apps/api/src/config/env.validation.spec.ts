import { envValidationSchema } from './env.validation';

describe('envValidationSchema', () => {
  it('applies defaults when nothing is set', () => {
    const { error, value } = envValidationSchema.validate({});

    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
    expect(value.PORT).toBe(3300);
  });

  it('accepts a valid explicit configuration', () => {
    const { error } = envValidationSchema.validate({ NODE_ENV: 'production', PORT: 8080 });
    expect(error).toBeUndefined();
  });

  it('rejects a non-numeric PORT', () => {
    const { error } = envValidationSchema.validate({ PORT: 'not-a-number' });
    expect(error).toBeDefined();
  });

  it('rejects an out-of-range PORT', () => {
    const { error } = envValidationSchema.validate({ PORT: 99999 });
    expect(error).toBeDefined();
  });

  it('rejects an unrecognized NODE_ENV', () => {
    const { error } = envValidationSchema.validate({ NODE_ENV: 'staging' });
    expect(error).toBeDefined();
  });
});
