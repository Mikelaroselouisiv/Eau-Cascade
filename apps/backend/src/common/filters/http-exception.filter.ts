import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = this.extractMessage(exception);

    if (!(exception instanceof HttpException)) {
      const err = exception as Error;
      console.error('[HTTP 500]', request.method, request.url, err?.message, err?.stack);
    }

    response.status(status).json({
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      message,
    });
  }

  /** Nest encapsule souvent `{ statusCode, message, error }` — exposer le message utile. */
  private extractMessage(exception: unknown): string | string[] | unknown {
    if (!(exception instanceof HttpException)) {
      return 'Internal server error';
    }
    const raw = exception.getResponse();
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object' && 'message' in raw) {
      return (raw as { message: unknown }).message;
    }
    return raw;
  }
}
