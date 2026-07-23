import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createSignerService } from './signer.factory';
import { RELAYER_SIGNER_SERVICE, SIGNER_SERVICE } from './signer.interface';
import { ViemClientService } from './viem-client.service';

@Module({
  imports: [ConfigModule],
  providers: [
    ViemClientService,
    {
      provide: SIGNER_SERVICE,
      inject: [ConfigService],
      useFactory: createSignerService,
    },
    {
      provide: RELAYER_SIGNER_SERVICE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createSignerService(configService, 'RELAYER_PRIVATE_KEY'),
    },
  ],
  exports: [SIGNER_SERVICE, RELAYER_SIGNER_SERVICE, ViemClientService],
})
export class CryptoModule {}
