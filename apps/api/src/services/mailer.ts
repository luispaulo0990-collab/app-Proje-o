import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../config/env.js';

/** Abstraction so the e-mail provider can be swapped (Hostinger SMTP, SES, Graph…). */
export interface Mailer {
  sendPasswordReset(to: string, name: string, resetUrl: string): Promise<void>;
}

/** Development only: writes the link to the log instead of sending an e-mail. */
export class ConsoleMailer implements Mailer {
  constructor(private readonly log: FastifyBaseLogger) {}

  async sendPasswordReset(to: string, _name: string, resetUrl: string): Promise<void> {
    this.log.info({ to, resetUrl }, '[dev-mailer] link de redefinição de senha');
  }
}

export class SmtpMailer implements Mailer {
  private readonly transport: nodemailer.Transporter;

  constructor(private readonly env: Env) {
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }

  async sendPasswordReset(to: string, name: string, resetUrl: string): Promise<void> {
    await this.transport.sendMail({
      from: this.env.SMTP_FROM,
      to,
      subject: 'Redefinição de senha — Painel de Obras Unità',
      text: `Olá, ${name}.\n\nPara redefinir sua senha acesse: ${resetUrl}\n\nO link expira em ${this.env.PASSWORD_RESET_TTL_MINUTES} minutos. Se você não solicitou, ignore este e-mail.`,
    });
  }
}

/** Silent mailer used by automated tests; keeps the last message for assertions. */
export class MemoryMailer implements Mailer {
  readonly sent: { to: string; resetUrl: string }[] = [];

  async sendPasswordReset(to: string, _name: string, resetUrl: string): Promise<void> {
    this.sent.push({ to, resetUrl });
  }
}

/** Production fallback without SMTP: never logs the link (it contains a secret token). */
export class DisabledMailer implements Mailer {
  constructor(private readonly log: FastifyBaseLogger) {}

  async sendPasswordReset(to: string): Promise<void> {
    this.log.warn({ to }, 'SMTP não configurado: e-mail de redefinição de senha não enviado.');
  }
}

export function createMailer(env: Env, log: FastifyBaseLogger): Mailer {
  if (env.SMTP_HOST) return new SmtpMailer(env);
  return env.NODE_ENV === 'production' ? new DisabledMailer(log) : new ConsoleMailer(log);
}
