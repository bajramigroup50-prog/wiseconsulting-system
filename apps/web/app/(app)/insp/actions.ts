'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { INSP, INSP_G, inspCheck, inspCtx, inspScore, type InspManual, type InspProfile } from '@wise/core/office';
import { audit, buildFirmSnapshot, firms, inspectionStates } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { renderPdf } from '@/lib/jobs';
import { fdate, fnum, fv, officeAction, officeError, today } from '@/lib/office';

/** Legacy `inspSet`: confirm a manual check (date + note) or mark it not applicable. */
export async function setInspState(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const itemId = fv(f, 'itemId');
    if (!INSP.some((i) => i.id === itemId)) return { error: 'Непозната проверка.' };
    const op = fv(f, 'op');
    const v = op === 'clear' ? null : { doneDate: op === 'na' ? null : fdate(f, 'd') ?? today(), na: op === 'na', note: fv(f, 'note'), byName: u.name, updatedBy: u.id };
    await db().transaction(async (tx) => {
      if (!v) await tx.delete(inspectionStates).where(sql`${inspectionStates.firmId} = ${firm.id} and ${inspectionStates.itemId} = ${itemId}`);
      else await tx.insert(inspectionStates).values({ firmId: firm.id, itemId: itemId!, ...v })
        .onConflictDoUpdate({ target: [inspectionStates.firmId, inspectionStates.itemId], set: v });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'inspOk', entityType: 'inspection', entityId: itemId!, data: { op } });
    });
    revalidatePath('/insp');
    return { ok: 'Зачувано.' };
  } catch (e) { return officeError(e); }
}

/** Firm inspection profile (legacy `firm.inspProf` + `kasaMax`), merged into `firms.settings`. */
export async function saveInspProfile(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const prof: InspProfile = { fisk: f.get('fisk') === 'on', alc: f.get('alc') === 'on', web: f.get('web') === 'on', kasaMax: Math.max(0, fnum(f, 'kasaMax')) };
    const j = JSON.stringify(prof);
    await db().transaction(async (tx) => {
      await tx.update(firms).set({ settings: sql`${firms.settings} || jsonb_build_object('inspProf', ${j}::jsonb)` }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'inspProf', entityType: 'firm', entityId: firm.id, data: prof as Record<string, unknown> });
    });
    revalidatePath('/insp');
    return { ok: 'Зачувано.' };
  } catch (e) { return officeError(e); }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const S_TXT = { ok: '✓', bad: '✕', warn: '!', todo: '?', na: '—' } as const;

/** Server-side PDF of the readiness report (worker `pdf.render`, Phase 9's HTML→PDF service). */
export async function inspPdf(): Promise<ActionState> {
  let id = '';
  try {
    const { u, firm } = await officeAction('office');
    const snap = await buildFirmSnapshot(db(), firm.id);
    const man = await db().select().from(inspectionStates).where(eq(inspectionStates.firmId, firm.id));
    const M: Record<string, InspManual> = Object.fromEntries(man.map((m) => [m.itemId, { d: m.doneDate, na: m.na, by: m.byName, note: m.note }]));
    const R = inspCheck(inspCtx(snap!, (firm.settings as { inspProf?: InspProfile }).inspProf ?? {}), M);
    const sc = inspScore(R);
    const html = `<h1>Подготвеност за инспекција – ${esc(firm.name)}</h1><p>Датум: ${today().split('-').reverse().join('.')} · подготвеност ${sc.pct}% · ${sc.bad} проблеми · ${sc.warn} предупредувања · ${sc.todo} за потврда</p>`
      + INSP_G.map(([g, t]) => {
        const rows = R.filter((r) => r.it.g === g);
        return rows.length ? `<h2>${esc(t)}</h2><table><tr><th></th><th>Обврска</th><th>Состојба</th><th>Закон</th></tr>${rows.map((r) => `<tr><td>${S_TXT[r.s]}</td><td>${esc(r.t)}</td><td>${esc(r.txt)}</td><td>${esc(r.it.law)}</td></tr>`).join('')}</table>` : '';
      }).join('');
    id = await renderPdf({ html, title: `Инспекција ${firm.name}`, firmId: firm.id, userId: u.id });
    await db().transaction((tx) => audit(tx, { userId: u.id, firmId: firm.id, action: 'inspPdf', entityType: 'file', entityId: id }));
  } catch (e) { return officeError(e); }
  redirect(`/insp?pdf=${id}`);
}
