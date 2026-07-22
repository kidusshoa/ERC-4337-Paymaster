import { ConfigService } from '@nestjs/config';
import { LocalPrivateKeySigner } from './local-private-key.signer';
import { createSignerService } from './signer.factory';

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function configServiceWith(env: Record<string, string>): ConfigService {
  return {
    get: (key: string, defaultValue?: unknown) => env[key] ?? defaultValue,
    getOrThrow: (key: string) => {
      if (!(key in env)) {
        throw new Error(`Config key "${key}" is required but was not set`);
      }
      return env[key];
    },
  } as unknown as ConfigService;
}

describe('createSignerService', () => {
  it('returns a LocalPrivateKeySigner when SIGNER_BACKEND is "local" (or unset)', () => {
    const signer = createSignerService(
      configServiceWith({ SIGNER_BACKEND: 'local', SIGNER_PRIVATE_KEY: TEST_PRIVATE_KEY }),
    );
    expect(signer).toBeInstanceOf(LocalPrivateKeySigner);
  });

  it('defaults to "local" when SIGNER_BACKEND is not set', () => {
    const signer = createSignerService(configServiceWith({ SIGNER_PRIVATE_KEY: TEST_PRIVATE_KEY }));
    expect(signer).toBeInstanceOf(LocalPrivateKeySigner);
  });

  it('throws a clear error when SIGNER_PRIVATE_KEY is missing for the local backend', () => {
    expect(() => createSignerService(configServiceWith({ SIGNER_BACKEND: 'local' }))).toThrow(
      /SIGNER_PRIVATE_KEY/,
    );
  });

  it('throws a clear error for an unsupported backend instead of silently falling back', () => {
    expect(() => createSignerService(configServiceWith({ SIGNER_BACKEND: 'kms' }))).toThrow(
      /Unsupported SIGNER_BACKEND "kms"/,
    );
  });
});
