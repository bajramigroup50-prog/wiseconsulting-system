/**
 * Schema — 🔐 enrolled computers (mutual TLS device certificates, `apps/web/lib/device-certs.ts`).
 * One row per issued client certificate. The app refuses a request whose certificate fingerprint is unknown or
 * revoked (Caddy has no CRL). `bundle` keeps the sealed .p12 + password only until the device first connects (so the
 * owner can download the installer again), then it is cleared; it is also cleared on revocation.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Device name = certificate CN, e.g. „АЛФА ДООЕЛ – уред 1 – каса 1“. */
  name: text('name').notNull(),
  /** Client firm the computer belongs to; null = the office's own computer. */
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'set null' }),
  /** Running number within the firm (or the office) — „уред N“. */
  no: integer('no').notNull(),
  /** Certificate serial (lower-case hex) and SHA-256 of the DER (lower-case hex, Caddy's `tls.client.fingerprint`). */
  serial: text('serial').notNull(),
  fingerprint: text('fingerprint').notNull(),
  notAfter: ts('not_after').notNull(),
  status: text('status').notNull().default('active'),
  /** Sealed .p12 + password (AES-GCM, key from the CA key) until the first connection; then null. */
  bundle: text('bundle'),
  downloads: integer('downloads').notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at'),
  lastSeenIp: text('last_seen_ip'),
  revokedAt: ts('revoked_at'),
  revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'set null' }),
  revokeReason: text('revoke_reason'),
}, (t) => [
  uniqueIndex('devices_fingerprint_uq').on(t.fingerprint),
  uniqueIndex('devices_serial_uq').on(t.serial),
  index('devices_firm_idx').on(t.firmId),
  check('devices_status_chk', sql`${t.status} in ('active','revoked')`),
]);

export type Device = typeof devices.$inferSelect;
