/**
 * SMTP transport (Nodemailer) — replaces the legacy Gmail MCP sends (`gmailSendParts`, `slipMail`).
 *
 * Configuration (docker/.env): `SMTP_HOST`, `SMTP_PORT` (465 → implicit TLS, otherwise STARTTLS when offered),
 * `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. `SMTP_URL` (smtp[s]://user:pass@host:port) is accepted as a fallback.
 * Without a host the mailer is `null` and every message is logged as failed with a clear reason.
 */
import nodemailer from 'nodemailer';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface OutgoingMail {
  from: string;
  to: string[];
  subject: string;
  html: string;
  attachments?: MailAttachment[];
}

/** The part of a Nodemailer transport the mail job uses (tests pass a mock). */
export interface MailTransport {
  sendMail(m: OutgoingMail): Promise<{ messageId?: string }>;
}

export interface Mailer {
  transport: MailTransport;
  from: string;
}

type Env = Record<string, string | undefined>;

/** Mailer from the environment, or null when SMTP is not configured. */
export function mailerFromEnv(env: Env = process.env): Mailer | null {
  const url = env.SMTP_URL?.trim();
  const host = env.SMTP_HOST?.trim();
  if (!host && !url) return null;
  let transport: MailTransport;
  let user = env.SMTP_USER?.trim();
  if (host) {
    const port = Number(env.SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(user ? { auth: { user, pass: env.SMTP_PASS ?? '' } } : {}),
    });
  } else {
    transport = nodemailer.createTransport(url!);
    try { user ||= decodeURIComponent(new URL(url!).username); } catch { /* keep undefined */ }
  }
  const from = env.MAIL_FROM?.trim() || user || '';
  return { transport, from };
}

/**
 * The login typed in the program („Систем → Е-пошта на програмата“, app setting `smtp`: user / app password) wins over
 * docker/.env – a Gmail with 2-step verification needs an app password, and the office sets it without a deploy.
 * `refreshMailerOverride` (worker start, then every minute) reads it; `sharedMailer` rebuilds the transport on a change.
 */
let override: { user?: string; pass?: string } = {};
let shared: { key: string; m: Mailer | null } | null = null;

export function setMailerOverride(o: { user?: string; pass?: string }): void { override = { ...(o.user ? { user: o.user } : {}), ...(o.pass ? { pass: o.pass } : {}) }; }

export function sharedMailer(env: Env = process.env): Mailer | null {
  const key = `${override.user ?? ''}|${override.pass ?? ''}`;
  if (!shared || shared.key !== key) {
    const e: Env = { ...env };
    if (override.user) { e.SMTP_USER = override.user; e.MAIL_FROM = env.MAIL_FROM?.includes(override.user) ? env.MAIL_FROM : `${env.BRAND_NAME?.trim() || 'WISE CONSULTING'} <${override.user}>`; }
    if (override.pass) e.SMTP_PASS = override.pass;
    shared = { key, m: mailerFromEnv(e) };
  }
  return shared.m;
}
