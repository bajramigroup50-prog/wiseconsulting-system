/**
 * Schema v1 — foundation: tenancy, users & RBAC, sessions, audit log, files, app settings.
 * Ledger, masters and documents follow in later phases (see plan, Step 3).
 *
 * Conventions: uuid primary keys, `timestamptz` for instants, `date` for accounting dates,
 * `numeric(18,2)` for money (never float), per-firm tables carry `firm_id` + `(firm_id, date)` index.
 */
import { sql } from 'drizzle-orm';
import type { Role } from '@wise/core';
import {
  bigserial, boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date());

/* ---------------- Tenancy ---------------- */

export const firms = pgTable('firms', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Legacy firm document id (`firms/{fid}`), kept for the importer and for traceability. */
  legacyId: text('legacy_id').unique(),
  code: text('code'),
  name: text('name').notNull(),
  /** Legal form (legacy `lf`: dooel, doo, tp, zdr, …). */
  legalForm: text('legal_form'),
  edb: text('edb'),
  embs: text('embs'),
  address: text('address'),
  city: text('city'),
  email: text('email'),
  phone: text('phone'),
  activity: text('activity'),
  vatRegistered: boolean('vat_registered').notNull().default(true),
  /** `quarter` (≤ 25 mil.) or `month` (> 25 mil.). */
  vatPeriod: text('vat_period').notNull().default('quarter'),
  /** Books are locked up to and including this date (legacy `lock`). Enforced in the posting service. */
  lockDate: date('lock_date'),
  ownerId: uuid('owner_id'),
  active: boolean('active').notNull().default(true),
  /** Enabled industry modules (hotel, rentacar, travel, …). */
  mods: jsonb('mods').$type<string[]>().notNull().default([]),
  /** Remaining legacy settings blobs: sch, nalCodes, zsMan, insp, kl, invoice styling, payroll codes, … */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('firms_name_idx').on(t.name),
  index('firms_edb_idx').on(t.edb),
]);

/* ---------------- Users, sessions, access ---------------- */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  legacyId: text('legacy_id').unique(),
  username: text('username').notNull(),
  name: text('name').notNull(),
  email: text('email'),
  role: text('role').$type<Role>().notNull().default('view'),
  /** Access to every firm (legacy `firms: ['*']`). */
  allFirms: boolean('all_firms').notNull().default(false),
  /** argon2id hash, or a legacy `p2$…` / sha256 hash until the first successful login re-hashes it. */
  passwordHash: text('password_hash').notNull(),
  /** Legacy per-user salt, only needed while `password_hash` is still a legacy hash. */
  legacySalt: text('legacy_salt'),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  active: boolean('active').notNull().default(true),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('users_username_uq').on(sql`lower(${t.username})`)]);

export const sessions = pgTable('sessions', {
  /** sha256 of the cookie token — the raw token is never stored. */
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

export const userFirms = pgTable('user_firms', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.firmId] }), index('user_firms_firm_idx').on(t.firmId)]);

/* ---------------- Audit ---------------- */

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: ts('at').notNull().defaultNow(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'set null' }),
  /** Legacy action name (`saveFirm`, `uNew`, …) or `login` / `logout`. */
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  data: jsonb('data').$type<Record<string, unknown>>(),
}, (t) => [
  index('audit_firm_at_idx').on(t.firmId, t.at),
  index('audit_user_at_idx').on(t.userId, t.at),
]);

/* ---------------- Files (MinIO) ---------------- */

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'restrict' }),
  /** Object key in the `wise-docs` bucket: firms/{firmId}/{yyyy}/{uuid}.{ext} */
  bucketKey: text('bucket_key').notNull().unique(),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  /** `pending` until the browser's presigned PUT is confirmed. */
  status: text('status').$type<'pending' | 'ready'>().notNull().default('pending'),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [
  index('files_firm_sha_idx').on(t.firmId, t.sha256),
  index('files_firm_created_idx').on(t.firmId, t.createdAt),
]);

export const fileLinks = pgTable('file_links', {
  fileId: uuid('file_id').notNull().references(() => files.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  /** e.g. `source`, `attachment`, `logo`, `signature`, `stamp`. */
  role: text('role').notNull().default('attachment'),
}, (t) => [
  primaryKey({ columns: [t.fileId, t.entityType, t.entityId, t.role] }),
  index('file_links_entity_idx').on(t.entityType, t.entityId),
]);

/* ---------------- Global settings ---------------- */

/** Office-wide settings (legacy `app*` docs): schemes, office, tpl, doccodes, … keyed by name. */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

export type Firm = typeof firms.$inferSelect;
export type NewFirm = typeof firms.$inferInsert;
export type User = typeof users.$inferSelect;
export type FileRow = typeof files.$inferSelect;
