import 'server-only';
/**
 * Legacy `docVerify` 15598 („🔍 Провери контролен код на договор“): is a printed control code one of the documents the
 * office registered (legacy `docReg` into `appsettings/doccodes`)? Server registry = the HR documents with their stored
 * `code` (employment contracts, annexes, decisions) + the accounting-service contracts (code computed from the saved
 * content, legacy `kdCode`, the same function that prints it).
 */
import { eq } from 'drizzle-orm';
import { kdCode } from '@wise/core/firms/kdog';
import { firms, hrDocs, serviceContracts, users } from '@wise/db';
import { db } from '@/lib/db';
import { rowToContract } from '../kdogovori/lib';

export type DocCodeHit = { t: string; name: string; firm: string; no: string; date: string | null; at: string; by: string };

export async function findDocCode(code: string): Promise<DocCodeHit | null> {
  const [h] = await db().select({ title: hrDocs.title, kind: hrDocs.kind, name: hrDocs.empName, firm: firms.name, no: hrDocs.no, date: hrDocs.date, at: hrDocs.createdAt, by: users.name })
    .from(hrDocs).innerJoin(firms, eq(firms.id, hrDocs.firmId)).leftJoin(users, eq(users.id, hrDocs.createdBy)).where(eq(hrDocs.code, code)).limit(1);
  if (h) return { t: h.title || (h.kind === 'contract' ? 'Договор за вработување' : 'Документ'), name: h.name, firm: h.firm, no: h.no, date: h.date, at: h.at.toISOString(), by: h.by ?? '' };
  const K = await db().select({ r: serviceContracts, firm: firms.name, by: users.name }).from(serviceContracts)
    .innerJoin(firms, eq(firms.id, serviceContracts.firmId)).leftJoin(users, eq(users.id, serviceContracts.createdBy));
  for (const { r, firm, by } of K) {
    if (kdCode(rowToContract(r), r.firmId) !== code) continue;
    return { t: 'Договор за сметководствени услуги', name: firm, firm, no: r.number ?? '', date: r.date, at: r.createdAt.toISOString(), by: by ?? '' };
  }
  return null;
}
