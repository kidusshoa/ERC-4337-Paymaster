import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const { method, originalUrl, correlationId } = req;
    const start = Date.now();

    // Every request logs exactly one access-log line here, success or failure — the
    // success path reads the real status Nest already wrote to the response; the
    // error path (AllExceptionsFilter runs after this, so `res.statusCode` isn't set
    // yet) derives it from the exception itself, since a caller tracing a request by
    // correlationId shouldn't lose it just because it errored.
    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - start;
          this.logger.log(
            `${method} ${originalUrl} ${res.statusCode} +${durationMs}ms [${correlationId}]`,
          );
        },
        error: (err: unknown) => {
          const durationMs = Date.now() - start;
          const statusCode =
            err instanceof HttpException ? err.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
          this.logger.log(
            `${method} ${originalUrl} ${statusCode} +${durationMs}ms [${correlationId}]`,
          );
        },
      }),
    );
  }
}
