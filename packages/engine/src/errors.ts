import type { ValidationIssue } from './types.js';

/** Raised when the engine input violates a domain rule. Carries every issue found. */
export class EngineValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(issues.map((i) => i.message).join(' | ') || 'Entrada inválida para o motor de cálculo');
    this.name = 'EngineValidationError';
    this.issues = issues;
  }
}

export function issue(
  code: string,
  message: string,
  context?: ValidationIssue['context'],
  severity: ValidationIssue['severity'] = 'ERROR',
): ValidationIssue {
  return context ? { code, severity, message, context } : { code, severity, message };
}

export function assertNoErrors(issues: ValidationIssue[]): void {
  const errors = issues.filter((i) => i.severity === 'ERROR');
  if (errors.length > 0) throw new EngineValidationError(errors);
}
