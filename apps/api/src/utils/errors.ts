/** Application error mapped by the global error handler to the standard error envelope. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) =>
  new AppError(404, 'NOT_FOUND', `${what} não encontrado(a).`);
export const conflict = (message: string, details?: unknown[]) =>
  new AppError(409, 'CONFLICT', message, details);
export const unauthorized = (message = 'Não autenticado.') =>
  new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Você não tem permissão para esta operação.') =>
  new AppError(403, 'FORBIDDEN', message);
export const badRequest = (message: string, details?: unknown[]) =>
  new AppError(400, 'BAD_REQUEST', message, details);
