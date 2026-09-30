import type { FastifyError, FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { EngineValidationError } from '@unita/engine';
import type { ErrorResponse } from '@unita/contracts';
import { AppError } from '../utils/errors.js';

function body(code: string, message: string, details?: unknown[]): ErrorResponse {
  return details ? { error: { code, message, details } } : { error: { code, message } };
}

/** Maps every error to the standard `{ error: { code, message, details } }` envelope. */
export function registerErrorHandler(
  app: FastifyInstance,
  options: { spaFallback?: boolean } = {},
): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((v) => ({
        path: v.instancePath.replace(/^\//, '').replaceAll('/', '.'),
        message: v.message,
      }));
      return reply.status(400).send(body('VALIDATION_ERROR', 'Dados inválidos.', details));
    }
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(body(error.code, error.message, error.details));
    }
    if (error instanceof EngineValidationError) {
      return reply.status(422).send(body('DOMAIN_VALIDATION', error.message, error.issues));
    }
    if (isResponseSerializationError(error)) {
      request.log.error(
        { err: error, issues: error.cause.issues },
        'response serialization failed',
      );
      return reply.status(500).send(body('INTERNAL_ERROR', 'Erro interno.'));
    }
    if (error.statusCode === 429) {
      return reply
        .status(429)
        .send(body('RATE_LIMITED', 'Muitas requisições. Tente novamente em instantes.'));
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send(body(error.code ?? 'BAD_REQUEST', error.message));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .status(500)
      .send(body('INTERNAL_ERROR', 'Erro interno. Tente novamente mais tarde.'));
  });

  app.setNotFoundHandler((request, reply) => {
    // SPA routes (/obras, /curvas/…) resolve to index.html when the API serves the web app.
    if (options.spaFallback && request.method === 'GET' && !request.url.startsWith('/api')) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply
      .status(404)
      .send(body('NOT_FOUND', `Rota ${request.method} ${request.url} não encontrada.`));
  });
}
