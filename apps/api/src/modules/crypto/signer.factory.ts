import { ConfigService } from '@nestjs/config';
import { LocalPrivateKeySigner } from './local-private-key.signer';
import { SignerService } from './signer.interface';

/**
 * @param privateKeyEnvVar which env var holds the private key when SIGNER_BACKEND is
 *   "local" — SIGNER_PRIVATE_KEY for the paymaster signer, RELAYER_PRIVATE_KEY for the
 *   relayer/bundler EOA (modules/relayer). Both roles share SIGNER_BACKEND: switching
 *   to a future KMS backend applies to both at once.
 */
export function createSignerService(
  configService: ConfigService,
  privateKeyEnvVar: string = 'SIGNER_PRIVATE_KEY',
): SignerService {
  const backend = configService.get<string>('SIGNER_BACKEND', 'local');

  switch (backend) {
    case 'local': {
      const privateKey = configService.getOrThrow<string>(privateKeyEnvVar);
      return new LocalPrivateKeySigner(privateKey);
    }
    default:
      // Extension point for a future AWS KMS / HSM-backed SignerService — add a case
      // here and it becomes a drop-in replacement for every consumer of
      // SIGNER_SERVICE, with no other code changes required.
      throw new Error(`Unsupported SIGNER_BACKEND "${backend}". Supported values: "local".`);
  }
}
