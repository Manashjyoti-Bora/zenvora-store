import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../env';
import { logger } from '../logger';

/**
 * Email provider abstraction.
 *  - console: default in development; renders the email to server logs so the
 *    full notification flow is observable without credentials.
 *  - smtp: any SMTP service (Resend, Brevo, Amazon SES, Zoho, self-hosted).
 *    Credentials come exclusively from environment variables.
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(input: SendEmailInput): Promise<void>;
}

class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  isConfigured(): boolean {
    return true;
  }
  async send(input: SendEmailInput): Promise<void> {
    logger.info('[EMAIL:console] -----------------------------------------');
    logger.info(`To: ${input.to}`);
    logger.info(`Subject: ${input.subject}`);
    logger.info(input.text ?? '(html-only email)');
    logger.info('[EMAIL:console] -----------------------------------------');
  }
}

class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private transporter: Transporter | null = null;

  isConfigured(): boolean {
    return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: { user: env.SMTP_USER!, pass: env.SMTP_PASS! },
      });
    }
    return this.transporter;
  }

  async send(input: SendEmailInput): Promise<void> {
    await this.getTransporter().sendMail({
      from: env.EMAIL_FROM,
      to: input.to,
      replyTo: env.EMAIL_REPLY_TO ?? undefined,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
  }
}

const providers: Record<string, EmailProvider> = {
  console: new ConsoleEmailProvider(),
  smtp: new SmtpEmailProvider(),
};

export function getEmailProvider(): EmailProvider {
  const chosen = providers[env.EMAIL_PROVIDER] ?? providers.console;
  if (env.EMAIL_PROVIDER === 'smtp' && !chosen.isConfigured()) {
    logger.error(
      'EMAIL_PROVIDER=smtp but SMTP_HOST/SMTP_USER/SMTP_PASS are missing - cannot send email'
    );
  }
  return chosen;
}
