'use server';
/**
 * ⚖ Правен асистент (AI) — server actions. Office staff only (`office`; the client and field roles never: `requireCan`
 * fails for them and the view is not in their menu). A case for the selected firm also checks that firm
 * (`requireCan('office', firm.id)`). The stored corpus (sync, import by link / paste) needs `settings`. Every mutation
 * writes `audit_log`.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { LAW_BY_KEY, lawOfficialUrl, type LawCaseKind } from '@wise/core/law';
import { audit, kontroli, lawCases, storeLawText } from '@wise/db';
import { Forbidden, requireCan, requireUser } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { isUuid, today } from '@/lib/office';

const err = (e: unknown): ActionState => {
  if (e instanceof Forbidden) return { error: e.message };
  if (e instanceof Error && /не се најдени членови/.test(e.message)) return { error: e.message };
  throw e;
};
const KINDS: readonly LawCaseKind[] = ['ask', 'law', 'ver', 'treat'];
const ymd = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
const lawKeys = (f: FormData, k: string) => [...new Set(f.getAll(k).map(String).filter((x) => !!LAW_BY_KEY[x]))];

/** Ask a question / start a comparison: the case is saved and answered by the worker (`law.case`). */
export async function lawCaseStart(_p: ActionState, f: FormData): Promise<ActionState> {
  let id = '';
  try {
    const u0 = await requireUser();
    const kind = String(f.get('kind') ?? 'ask') as LawCaseKind;
    if (!KINDS.includes(kind)) return { error: 'Непознат вид.' };
    const q = String(f.get('q') ?? '').trim().slice(0, 3000);
    const useFirm = kind === 'treat' || f.get('firm') === '1';
    const firm = useFirm ? await currentFirm(u0) : null;
    if (useFirm && !firm) return { error: 'Изберете фирма (горе) за прашање за фирма.' };
    const u = await requireCan('office', firm?.id ?? null);
    const from = useFirm ? ymd(f.get('from')) : null, to = useFirm ? ymd(f.get('to')) : null;
    if (useFirm && (!from || !to || from > to)) return { error: 'Внесете период (од – до).' };
    const laws = lawKeys(f, 'laws');
    const params: Record<string, unknown> = { deep: f.get('deep') === '1', ai: f.get('ai') === '1' };
    if (laws.length) params.laws = laws;
    const date = ymd(f.get('date'));
    if (date) params.date = date;
    let question = q;
    if (kind === 'law') {
      if (laws.length !== 2) return { error: 'Изберете точно два прописа за споредба.' };
      if (!q) return { error: 'Внесете тема (пр. „рокови за жалба“).' };
    } else if (kind === 'ver') {
      const law = String(f.get('law') ?? ''), art = String(f.get('art') ?? '').trim().replace(/^чл\.?\s*/i, '');
      if (!LAW_BY_KEY[law] || !/^\d{1,4}(-[а-шa-z])?$/i.test(art)) return { error: 'Изберете закон и внесете број на член (пр. 14 или 12-а).' };
      Object.assign(params, { law, art: art.toLowerCase(), ...(isUuid(f.get('v1')) ? { v1: f.get('v1') } : {}), ...(isUuid(f.get('v2')) ? { v2: f.get('v2') } : {}) });
      question = q || `${LAW_BY_KEY[law]!.abbr} чл. ${art}: верзија наспроти верзија`;
    } else if (!q) return { error: kind === 'treat' ? 'Внесете што се споредува (пр. „ДДВ на аванси“, „готовински плаќања“).' : 'Внесете прашање.' };
    id = await db().transaction(async (tx) => {
      const [r] = await tx.insert(lawCases).values({ firmId: firm?.id ?? null, userId: u.id, byName: u.name, kind, question, periodFrom: from, periodTo: to, params }).returning({ id: lawCases.id });
      await audit(tx, { userId: u.id, firmId: firm?.id ?? null, action: 'lawCase', entityType: 'law_case', entityId: r!.id, data: { kind, ai: kind === 'ask' || params.ai === true, deep: params.deep } });
      return r!.id;
    });
    await enqueue('law.case', { id });
  } catch (e) { return err(e); }
  revalidatePath('/lawAi');
  redirect(`/lawAi?case=${id}`);
}

async function caseFor(id: string, perm: string) {
  if (!isUuid(id)) throw new Forbidden(perm);
  const [c] = await db().select().from(lawCases).where(eq(lawCases.id, id)).limit(1);
  if (!c) throw new Forbidden(perm);
  const u = await requireCan(perm, c.firmId);
  return { u, c };
}

/** „📎 Додај во контрола“: link the memo to an inspection case of the same firm (id only; the kontroli page shows it). */
export async function lawCaseAttach(id: string, kontrolaId: string | null): Promise<ActionState> {
  try {
    const { u, c } = await caseFor(id, 'office');
    if (kontrolaId) {
      if (!isUuid(kontrolaId) || !c.firmId) return { error: 'Белешката мора да е за фирма за да се додаде во контрола.' };
      const [k] = await db().select({ id: kontroli.id }).from(kontroli).where(and(eq(kontroli.id, kontrolaId), eq(kontroli.firmId, c.firmId))).limit(1);
      if (!k) return { error: 'Контролата не е најдена за оваа фирма.' };
    }
    await db().transaction(async (tx) => {
      await tx.update(lawCases).set({ kontrolaId }).where(eq(lawCases.id, id));
      await audit(tx, { userId: u.id, firmId: c.firmId, action: kontrolaId ? 'lawCaseAttach' : 'lawCaseDetach', entityType: 'law_case', entityId: id, data: { kontrolaId } });
    });
    revalidatePath('/lawAi');
    return { ok: kontrolaId ? 'Белешката е додадена во контролата.' : 'Белешката е отстранета од контролата.' };
  } catch (e) { return err(e); }
}

export async function lawCaseDelete(id: string): Promise<ActionState> {
  try {
    const { u, c } = await caseFor(id, 'del');
    await db().transaction(async (tx) => {
      await tx.delete(lawCases).where(eq(lawCases.id, id));
      await audit(tx, { userId: u.id, firmId: c.firmId, action: 'lawCaseDel', entityType: 'law_case', entityId: id, data: { question: c.question.slice(0, 200) } });
    });
    revalidatePath('/lawAi');
    return {};
  } catch (e) { return err(e); }
}

/** „🔄 Синхронизирај текстови“: the robot's text step now (free, official sources). */
export async function lawTextsSyncNow(): Promise<ActionState> {
  try {
    const u = await requireCan('settings');
    await db().transaction((tx) => audit(tx, { userId: u.id, action: 'lawTextsSync', entityType: 'law_text' }));
    await enqueue('law.texts', {});
    return { ok: 'Синхронизацијата е пуштена – текстовите ќе се појават за неколку минути.' };
  } catch (e) { return err(e); }
}

/** „📥 Преземи од линк“: the office gives the official URL of a law's consolidated text (worker downloads and segments it). */
export async function lawTextFromUrl(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireCan('settings');
    const law = String(f.get('law') ?? ''), url = String(f.get('url') ?? '').trim(), title = String(f.get('title') ?? '').trim().slice(0, 300);
    if (!LAW_BY_KEY[law]) return { error: 'Изберете закон.' };
    if (!lawOfficialUrl(url)) return { error: 'Внесете линк од официјален извор (gov.mk, slvesnik.com.mk, sobranie.mk, …).' };
    await db().transaction((tx) => audit(tx, { userId: u.id, action: 'lawTextLink', entityType: 'law_text', data: { law, url } }));
    await enqueue('law.texts', { law, url, title: title || undefined, userId: u.id });
    return { ok: 'Текстот се презема – ќе се појави за неколку минути.' };
  } catch (e) { return err(e); }
}

/** „📋 Внеси текст“: pasted consolidated text (copied from the official source) → articles, a new version. */
export async function lawTextPaste(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireCan('settings');
    const law = String(f.get('law') ?? ''), text = String(f.get('text') ?? '');
    const src = String(f.get('url') ?? '').trim();
    if (!LAW_BY_KEY[law]) return { error: 'Изберете закон.' };
    if (text.length < 50) return { error: 'Залепете го текстот на законот.' };
    if (text.length > 3_000_000) return { error: 'Текстот е преголем.' };
    if (src && !lawOfficialUrl(src)) return { error: 'Изворот мора да е официјален линк (gov.mk, slvesnik.com.mk, …).' };
    const r = await db().transaction(async (tx) => {
      const x = await storeLawText(tx, {
        law, title: String(f.get('title') ?? '').trim().slice(0, 300) || LAW_BY_KEY[law]!.n, text, sourceUrl: src || null,
        asOf: ymd(f.get('asOf')) ?? today(), effectiveFrom: ymd(f.get('effectiveFrom')), source: 'manual', userId: u.id,
      });
      if (x.isNew) await audit(tx, { userId: u.id, action: 'lawTextPaste', entityType: 'law_text', entityId: x.id, data: { law, articles: x.articles } });
      return x;
    });
    revalidatePath('/lawAi');
    return { ok: r.isNew ? `Зачувано: ${r.articles} членови.` : 'Истиот текст веќе е зачуван.' };
  } catch (e) { return err(e); }
}
