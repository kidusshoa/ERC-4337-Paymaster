import { ConfigService } from '@nestjs/config';
import { LocalPrivateKeySigner } from './local-private-key.signer';
import { SignerService } from './signer.interface';

export function createSignerService(configService: ConfigService): SignerService {
  const backend = configService.get<string>('SIGNER_BACKEND', 'local');

  switch (backend) {
    case 'local': {
      const privateKey = configService.getOrThrow<string>('SIGNER_PRIVATE_KEY');
      return new LocalPrivateKeySigner(privateKey);
    }
    default:
      // Extension point for a future AWS KMS / HSM-backed SignerService — add a case
      // here and it becomes a drop-in replacement for every consumer of
      // SIGNER_SERVICE, with no other code changes required.
      throw new Error(`Unsupported SIGNER_BACKEND "${backend}". Supported values: "local".`);
  }
}
