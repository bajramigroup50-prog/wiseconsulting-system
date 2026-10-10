'use server';
/**
 * Legacy `fimpRead` / `fimpGo` (ACT_NEED `firms`): read the Excel on the server, preview, then import. Existing firms
 * (same ЕДБ / ЕМБС / name) only get their empty fields filled; new firms belong to the importing user. With „profiles“
 * every new firm also gets a client-portal profile (legacy `klAutoUser`, needs `users`).
 */
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { can } from '@wise/core';
import { fimpFind, fimpParse, fimpToFirm, type FimpRecord } from '@wise/core/firms/firmimp';
import type { KlCred } from '@wise/core/firms/klprofili';
import { audit, firms } from '@wise/db';
import { Forbidden, requireCan } from '@/lib/auth';
import { createClientProfile, takenUsernames } from '@/lib/client-profiles';
import { db } from '@/lib/db';

export interface FimpPreview { error?: string; file?: string; cols?: string[]; rows?: { f: FimpRecord; ex: string; exName: string }[] }
export interface FimpResult { error?: string; ok?: string; creds?: KlCred[] }

const allFirms = () => db().select({ id: firms.id, name: firms.name, edb: firms.edb, embs: firms.embs }).from(firms);

export async function readFirmsFile(form: FormData): Promise<FimpPreview> {
  try { await requireCan('firms'); } catch (e) { if (e instanceof Forbidden) return { error: e.message }; throw e; }
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return { error: 'Изберете Excel датотека.' };
  if (file.size > 10 * 1024 * 1024) return { error: 'Датотеката е преголема (најмногу 10 MB).' };
  let rows: unknown[][];
  try {
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]!]!;
    const F = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false });
    const R = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true });
    // Long integers (ЕДБ, accounts) as typed, not in scientific notation (legacy).
    rows = F.map((r, i) => r.map((v, j) => { const x = R[i]?.[j]; return typeof x === 'number' && Number.isInteger(x) ? x.toLocaleString('fullwide', { useGrouping: false }) : v; }));
  } catch { return { error: 'Датотеката не може да се прочита.' }; }
  const P = fimpParse(rows);
  if ('error' in P) return { error: P.error };
  const ex = await allFirms();
  return { file: file.name, cols: P.cols, rows: P.L.slice(0, 3000).map((f) => { const x = fimpFind(f, ex); return { f, ex: x?.id ?? '', exName: x?.name ?? '' }; }) };
}

export async function importFirms(recs: FimpRecord[], opts: { ddv: boolean; profiles: boolean }): Promise<FimpResult> {
  let u;
  try { u = await requireCan('firms'); } catch (e) { if (e instanceof Forbidden) return { error: e.message }; throw e; }
  const L = (Array.isArray(recs) ? recs : []).filter((f) => f && typeof f === 'object' && typeof f.name === 'string' && f.name.trim()).slice(0, 3000);
  if (!L.length) return { error: 'Изберете барем една фирма.' };
  const profiles = opts.profiles && can(u.principal, 'users');
  const r = await db().transaction(async (tx) => {
    const ex = await tx.select().from(firms);
    let n = 0, up = 0;
    const creds: KlCred[] = [];
    const used = profiles ? await takenUsernames(tx) : new Set<string>();
    for (const rec of L) {
      const { cols, settings } = fimpToFirm(rec);
      const cur = fimpFind(rec, ex);
      if (cur) {
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(cols)) if (v != null && v !== '' && ((cur as Record<string, unknown>)[k] == null || (cur as Record<string, unknown>)[k] === '')) patch[k] = v;
        const cs = (cur.settings ?? {}) as Record<string, unknown>;
        const sp = Object.fromEntries(Object.entries(settings).filter(([k]) => cs[k] == null || cs[k] === ''));
        if (!Object.keys(patch).length && !Object.keys(sp).length) continue;
        await tx.update(firms).set({ ...patch, ...(Object.keys(sp).length ? { settings: sql`${firms.settings} || ${JSON.stringify(sp)}::jsonb` } : {}) }).where(eq(firms.id, cur.id));
        await audit(tx, { userId: u.id, firmId: cur.id, action: 'fimpGo', entityType: 'firm', entityId: cur.id, data: { filled: [...Object.keys(patch), ...Object.keys(sp)] } });
        up++;
      } else {
        const [f] = await tx.insert(firms).values({
          name: cols.name, code: cols.code, legalForm: cols.legalForm, edb: cols.edb, embs: cols.embs, address: cols.address, city: cols.city,
          phone: cols.phone, email: cols.email, activity: cols.activity, vatRegistered: cols.vatRegistered ?? opts.ddv, vatPeriod: cols.vatPeriod ?? 'quarter',
          settings, ownerId: u.id,
        }).returning();
        ex.push(f!);
        await audit(tx, { userId: u.id, firmId: f!.id, action: 'newFirm', entityType: 'firm', entityId: f!.id, data: { name: f!.name, source: 'fimp' } });
        n++;
        if (profiles) { const c = await createClientProfile(tx, f!, used, u.id); if (c) creds.push(c); }
      }
    }
    await audit(tx, { userId: u.id, action: 'fimpGo', data: { new: n, updated: up, profiles: creds.length } });
    return { n, up, creds };
  });
  revalidatePath('/firmi');
  revalidatePath('/firmiImp');
  return { ok: `Увезени ${r.n} нови фирми${r.up ? ', дополнети ' + r.up : ''}${r.creds.length ? `; креирани ${r.creds.length} профили за клиенти` : ''}.`, creds: r.creds };
}
