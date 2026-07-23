import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ADMIN_API_KEY_HEADER } from './common/guards/admin-api-key.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('ERC-4337 Paymaster & Gas Relayer API')
    .setDescription(
      'Sponsors gas for ERC-4337 UserOperations (EntryPoint v0.7) and relays them on-chain.\n\n' +
        'Typical flow: `POST /paymaster/sponsor` (checks policy/quota, returns signed ' +
        '`paymasterAndData` + `userOpHash`) → the account owner signs that hash → ' +
        '`POST /relayer/submit` (broadcasts `handleOps`, watches for confirmation, auto-recovers ' +
        "stuck transactions) → poll `GET /userops/:hash` for status. See the repo's root README " +
        'for a full walkthrough and architecture overview.',
    )
    .setVersion('0.0.1')
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addTag('health', 'Liveness check')
    .addTag('paymaster', 'Policy/quota-checked gas sponsorship')
    .addTag('relayer', 'UserOperation submission and status tracking')
    .addTag('admin', 'Operational monitoring (deposit/stake), gated by an API key')
    .addApiKey({ type: 'apiKey', name: ADMIN_API_KEY_HEADER, in: 'header' }, ADMIN_API_KEY_HEADER)
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  const port = configService.get<number>('PORT', 5010);
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}`, 'Bootstrap');
  Logger.log(`Swagger docs at http://localhost:${port}/docs`, 'Bootstrap');
}

bootstrap();
