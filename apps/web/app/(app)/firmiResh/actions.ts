'use server';
/**
 * Legacy ACT `fsRead` / `fsGo` (ACT_NEED `firms`): read the scanned decision (worker job), then create the firm — or
 * fill only the empty fields of the existing one — put the decision in the firm's dossier, switch on the modules of
 * its activity code, link a matching formation case and optionally create the client's portal profile.
 * Gap: the draft accounting-service contract (legacy option „kd“).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { can } from '@wise/core';
import { nkdProfiles, suggestedModules } from '@wise/core/industry';
import type { KlCred } from '@wise/core/firms/klprofili';
import { FS_CAT, fsDig, fsDup, fsNorm, otherNkd } from '@wise/core/firms/resh';
import { audit, dossierDocs, fileLinks, files, firmReshReads, firms, formationCases, OFFICE_FILE_ENTITY } from '@wise/db';
import { Forbidden, requireCan } from '@/lib/auth';
import { createClientProfile, takenUsernames } from '@/lib/client-profiles';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { isUuid, today } from '@/lib/office';
import { selectFirm } from '../actions';

export interface ReshResult { error?: string; ok?: string; log?: string[]; creds?: KlCred[]; firmId?: string }

export async function startRead(_p: ReshResult, f: FormData): Promise<ReshResult> {
  let id: string;
  try {
    const u = await requireCan('firms');
    const ids = [...new Set(f.getAll('fileIds').filter(isUuid))].slice(0, 20);
    if (!ids.length) return { error: 'Скенирајте или прикачете го решението.' };
    const ok = await db().select({ id: files.id }).from(files).where(and(inArray(files.id, ids), isNull(files.firmId), eq(files.status, 'ready')));
    if (ok.length !== ids.length) return { error: 'Датотеката не е пронајдена.' };
    id = await db().transaction(async (tx) => {
      const [r] = await tx.insert(firmReshReads).values({ fileIds: ids, createdBy: u.id }).returning({ id: firmReshReads.id });
      await audit(tx, { userId: u.id, action: 'fsRead', entityType: 'firm_resh_read', entityId: r!.id, data: { files: ids.length } });
      return r!.id;
    });
    try { await enqueue('ai.read-firm-resh', { id }); } catch { await db().update(firmReshReads).set({ status: 'error', error: 'Читањето (AI) не е достапно – внесете ја фирмата рачно.' }).where(eq(firmReshReads.id, id)); }
  } catch (e) { if (e instanceof Forbidden) return { error: e.message }; throw e; }
  redirect(`/firmiResh?r=${id}`);
}

const s = (f: FormData, k: string, n = 300) => String(f.get(k) ?? '').trim().slice(0, n);
const d = (f: FormData, k: string) => { const v = s(f, k); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; };

export async function saveResh(_p: ReshResult, f: FormData): Promise<ReshResult> {
  let u;
  try { u = await requireCan('firms'); } catch (e) { if (e instanceof Forbidden) return { error: e.message }; throw e; }
  const readId = s(f, 'readId');
  const [read] = isUuid(readId) ? await db().select().from(firmReshReads).where(eq(firmReshReads.id, readId)).limit(1) : [];
  const r0 = (read?.result ?? {}) as { otherNkd?: string[]; founders?: { name: string; share?: string }[]; docType?: string; capital?: number; capitalCur?: string };
  const name = s(f, 'name');
  if (!name) return { error: 'Нема назив на фирмата.' };
  const nkd = s(f, 'nkd', 20), activity = s(f, 'activity');
  const lf = s(f, 'lf', 10) || null;
  const edb = fsDig(s(f, 'edb')), embs = fsDig(s(f, 'embs'));
  const ddv = f.get('ddv') === '1';
  const regDate = d(f, 'regDate'), docDate = d(f, 'docDate'), docNumber = s(f, 'docNumber', 100);
  const cols = { name, legalForm: lf, edb: edb || null, embs: embs || null, address: s(f, 'address') || null, city: s(f, 'city') || null, phone: s(f, 'phone') || null, email: s(f, 'email') || null, activity: nkd ? nkd + (activity ? ' ' + activity : '') : activity || null, vatRegistered: ddv };
  const settings: Record<string, unknown> = {
    short: s(f, 'short') || undefined, nkd: nkd || undefined, nkdOther: otherNkd({ otherNkd: r0.otherNkd ?? [], nkd }), signer: s(f, 'signer') || undefined, signerRole: 'Управител',
    bankAccount: fsDig(s(f, 'bank')) || undefined, bankName: s(f, 'bankName') || undefined, regDate: regDate || undefined, vatFrom: d(f, 'vatFrom') || undefined,
    capital: Number(r0.capital) || undefined, capitalCur: r0.capitalCur || undefined, founders: r0.founders?.length ? r0.founders : undefined,
  };
  for (const k of Object.keys(settings)) if (settings[k] === undefined || (Array.isArray(settings[k]) && !(settings[k] as unknown[]).length)) delete settings[k];
  const exId = s(f, 'ex');
  const wantKl = f.get('kl') === 'on' && can(u.principal, 'users');
  const log: string[] = [];
  let res: { fid: string; creds: KlCred[] };
  try { res = await db().transaction(async (tx) => {
    const all = await tx.select().from(firms);
    const ex = isUuid(exId) ? all.find((x) => x.id === exId) : fsDup({ name, edb, embs }, all);
    let fid: string;
    if (ex) {
      if (!can(u.principal, 'saveFirm', ex.id)) throw new Forbidden('saveFirm');
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cols)) if (k !== 'vatRegistered' && v != null && v !== '' && ((ex as Record<string, unknown>)[k] == null || (ex as Record<string, unknown>)[k] === '')) patch[k] = v;
      const cs = (ex.settings ?? {}) as Record<string, unknown>;
      const sp = Object.fromEntries(Object.entries(settings).filter(([k]) => cs[k] == null || cs[k] === ''));
      if (Object.keys(patch).length || Object.keys(sp).length) await tx.update(firms).set({ ...patch, ...(Object.keys(sp).length ? { settings: sql`${firms.settings} || ${JSON.stringify(sp)}::jsonb` } : {}) }).where(eq(firms.id, ex.id));
      await audit(tx, { userId: u.id, firmId: ex.id, action: 'fsGo', entityType: 'firm', entityId: ex.id, data: { filled: [...Object.keys(patch), ...Object.keys(sp)] } });
      log.push(`✓ Постоечката фирма „${ex.name}“ е дополнета (${Object.keys(patch).length + Object.keys(sp).length} полиња)`);
      fid = ex.id;
    } else {
      const mods = suggestedModules(nkdProfiles(nkd));
      const [n] = await tx.insert(firms).values({ ...cols, vatPeriod: 'quarter', mods, settings, ownerId: u.id }).returning({ id: firms.id });
      fid = n!.id;
      await audit(tx, { userId: u.id, firmId: fid, action: 'newFirm', entityType: 'firm', entityId: fid, data: { name, source: 'firmiResh' } });
      log.push(`✓ Фирмата „${name}“ е регистрирана во листата на фирми`);
      log.push(`✓ Модули според шифрата ${nkd || '—'}: ${mods.length ? mods.join(', ') : 'само основни'}`);
      const nc = (await tx.select().from(formationCases).where(isNull(formationCases.firmId))).find((x) => fsNorm(x.name) === fsNorm(name) || (embs && fsDig(x.data?.embs) === embs));
      if (nc) {
        await tx.update(formationCases).set({ status: 'created', firmId: fid }).where(eq(formationCases.id, nc.id));
        log.push(`✓ Поврзано со основањето „${nc.name}“ од канцеларијата`);
      }
    }
    // The decision → the firm's dossier (the office-wide upload becomes the firm's file).
    const fileIds = read?.fileIds ?? [];
    if (fileIds.length) {
      const same = docNumber ? (await tx.select({ id: dossierDocs.id }).from(dossierDocs).where(and(eq(dossierDocs.firmId, fid), eq(dossierDocs.number, docNumber))).limit(1))[0] : undefined;
      if (same) log.push(`• Ова решение (${docNumber}) веќе е во досието – не е зачувано двапати`);
      else {
        await tx.update(files).set({ firmId: fid }).where(and(inArray(files.id, fileIds), isNull(files.firmId)));
        const cat = FS_CAT[r0.docType ?? 'upis'] ?? FS_CAT.upis!;
        const [dd] = await tx.insert(dossierDocs).values({ firmId: fid, category: cat, title: `${cat} – ${s(f, 'short') || name}`, number: docNumber || null, date: docDate || regDate || today(), partnerName: name, note: 'Внесено автоматски при регистрација на фирмата', createdBy: u.id }).returning({ id: dossierDocs.id });
        await tx.insert(fileLinks).values(fileIds.map((fileId) => ({ fileId, entityType: OFFICE_FILE_ENTITY.dossier, entityId: dd!.id, role: 'attachment' }))).onConflictDoNothing();
        log.push('✓ Решението е зачувано во Документи на фирмата (досие)');
      }
    }
    if (read) await tx.update(firmReshReads).set({ status: 'saved', firmId: fid }).where(eq(firmReshReads.id, read.id));
    const creds: KlCred[] = [];
    if (wantKl) {
      const [nf] = await tx.select().from(firms).where(eq(firms.id, fid)).limit(1);
      const c = await createClientProfile(tx, nf!, await takenUsernames(tx), u.id);
      if (c) { creds.push(c); log.push(`✓ Профил за клиентот: корисник ${c.username}`); } else log.push('• Клиентот веќе има профил');
    }
    if (!ex && !settings.bankAccount) log.push('→ Дополнете: жиро сметка' + (ddv ? '' : ', ДДВ (кога ќе стане обврзник)'));
    return { fid, creds };
  }); } catch (e) { if (e instanceof Forbidden) return { error: e.message }; throw e; }
  if (f.get('open') === 'on') await selectFirm(res.fid);
  revalidatePath('/firmi');
  return { ok: 'Готово', log, creds: res.creds, firmId: res.fid };
}
