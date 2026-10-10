/**
 * Test database: PGlite + the repo migrations + the legacy-import tables.
 *
 * The coordinator generates the migration for `schema/legacy-import.ts` after the merge; until then the two tables are
 * created here with the same DDL the migration will contain.
 */
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { schema, seedReference, type Tx } from '@wise/db';

export const LEGACY_IMPORT_DDL = `
CREATE TABLE IF NOT EXISTS "legacy_import_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "files" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "options" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "progress" jsonb DEFAULT '{"done":0,"total":0}'::jsonb NOT NULL,
  "report" jsonb,
  "error" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  CONSTRAINT "legacy_import_runs_status_chk" CHECK ("status" in ('queued','running','done','failed'))
);
CREATE INDEX IF NOT EXISTS "legacy_import_runs_created_idx" ON "legacy_import_runs" ("created_at");
CREATE TABLE IF NOT EXISTS "legacy_id_map" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "firm_id" uuid REFERENCES "firms"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "legacy_id" text NOT NULL,
  "entity_id" text NOT NULL,
  "run_id" uuid REFERENCES "legacy_import_runs"("id") ON DELETE set null,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "legacy_id_map_uq" ON "legacy_id_map" (coalesce("firm_id", '00000000-0000-0000-0000-000000000000'::uuid), "kind", "legacy_id");
CREATE INDEX IF NOT EXISTS "legacy_id_map_entity_idx" ON "legacy_id_map" ("kind", "entity_id");
`;

export async function testDb(): Promise<Tx> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)) });
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from information_schema.tables where table_name = 'legacy_id_map'`)).rows as [{ n: number }];
  if (!n) for (const stmt of LEGACY_IMPORT_DDL.split(';').map((s) => s.trim()).filter(Boolean)) await db.execute(sql.raw(stmt));
  await seedReference(db as unknown as Tx);
  return db as unknown as Tx;
}
