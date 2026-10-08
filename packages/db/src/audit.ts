import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { auditLog } from './schema/index';
import type * as schema from './schema/index';

type S = typeof schema;
/** Either the db or an open transaction — audit rows are written inside the mutation's transaction. */
export type Tx =
  | PgDatabase<PgQueryResultHKT, S>
  | PgTransaction<PgQueryResultHKT, S, ExtractTablesWithRelations<S>>;

export interface AuditEntry {
  userId: string | null;
  firmId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
}

export async function audit(tx: Tx, e: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    userId: e.userId,
    firmId: e.firmId ?? null,
    action: e.action,
    entityType: e.entityType ?? null,
    entityId: e.entityId ?? null,
    data: e.data ?? null,
  });
}
