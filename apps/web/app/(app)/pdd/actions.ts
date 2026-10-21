'use server';
/**
 * Legacy `pddSave` / `pddDel` / `pddTypesSave` (8366–8380): ПДД payment (rent, bonuses, services from natural persons)
 * saved and booked in one transaction (journal kind `pdd`, source `pdd`), its deletion, and the firm's income types.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, sql } from 'drizzle-orm';
import { pddCalc, pddEntries, pddKontaOfGroup, pddTotal, pddTypes, type PddRow, type PddType } from '@wise/core/finance';
import { audit, ensurePartner, firms, partners, pddPayments, postJournal, unpostSource, type PddPaymentRow } from '@wise/db';
import { parseAkontativna, type AkontRow } from '@wise/core/pdd-akont';
import { pdfTextItems } from '@/lib/pdf-text';
import { recheckFirmLater } from '@/lib/jobs';
import { latToCyr } from '@wise/core/text/cyr';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { isDate } from '@/lib/finance';

const typesOf = (settings: unknown) => pddTypes(((settings ?? {}) as { pddTypes?: Partial<PddType>[] }).pddTypes);

export interface PddInput { id?: string; date: string; note: string; rows: PddRow[] }

export async function savePddAction(v: PddInput): Promise<ActionState> {
  const r = await persistPdd(v);
  if ('error' in r) return r;
  revalidatePath('/pdd');
  redirect('/pdd?ok=1');
}

/** Save + book one payment (shared by the editor and the PDF import). */
async function persistPdd(v: PddInput): Promise<{ id: string } | { error: string }> {
  let id = v.id ?? '';
  try {
    const { u, firm } = await firmAction('pddSave');
    if (!isDate(v.date)) return { error: 'Внесете датум на исплата.' };
    const T = typesOf(firm.settings);
    const R = (v.rows ?? []).filter((r) => r.name || +r.amt);
    if (!R.length) return { error: 'Внесете барем еден примач.' };
    if (R.some((r) => !(+r.amt > 0))) return { error: 'Внесете износ за секој примач.' };
    if (R.some((r) => !T.some((t) => t.id === r.tid))) return { error: 'Непознат вид приход.' };
    const rows: PddPaymentRow[] = R.map((r) => {
      const t = T.find((x) => x.id === r.tid)!;
      const c = pddCalc(r, t);
      return { tid: r.tid, mode: r.mode === 'g' ? 'g' : 'n', amt: Math.round(+r.amt), name: String(r.name ?? '').trim(), embg: String(r.embg ?? '').replace(/\D/g, ''), acct: String(r.acct ?? '').replace(/\D/g, ''), pid: r.pid && /^[0-9a-f-]{36}$/i.test(r.pid) ? r.pid : null, ...c };
    });
    const tot = pddTotal(rows, T);
    await db().transaction(async (tx) => {
      const head = { date: v.date, note: v.note?.trim() || null, rows, gross: String(tot.G), deductions: String(tot.ded), tax: String(tot.tax), net: String(tot.net) };
      if (id) {
        const [x] = await tx.update(pddPayments).set(head).where(and(eq(pddPayments.id, id), eq(pddPayments.firmId, firm.id))).returning({ id: pddPayments.id });
        if (!x) throw new Error('Книжењето не постои.');
      } else {
        id = (await tx.insert(pddPayments).values({ ...head, firmId: firm.id, createdBy: u.id }).returning({ id: pddPayments.id }))[0]!.id;
      }
      await postJournal(tx, {
        firmId: firm.id, date: v.date, kind: 'pdd', description: v.note?.trim() || 'Закупнина / бонуси ' + v.date.split('-').reverse().join('.'),
        sourceType: 'pdd', sourceId: id, userId: u.id, auditAction: 'pddPost',
        lines: pddEntries(rows, T).map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, note: l.note, partnerId: l.partnerId ?? null })),
        requirePartner: false,
      });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'pddSave', entityType: 'pdd_payment', entityId: id, data: { date: v.date, rows: rows.length, ...tot } });
    });
    await recheckFirmLater(firm.id);
  } catch (e) {
    if (e instanceof Error && e.message === 'Книжењето не постои.') return { error: e.message };
    return { error: actionError(e).error ?? 'Грешка при книжење.' };
  }
  return { id };
}

/**
 * The firm's partner of a recipient: by ЕМБГ (partner data / ЕДБ field), else by the name – Latin and Cyrillic alike
 * (BLAŽE MANEVSKI = БЛАЖЕ МАНЕВСКИ, the statements often carry the Latin one).
 */
async function partnerMatcher(firmId: string): Promise<(embg: string | null | undefined, name: string) => string | null> {
  const P = await db().select({ id: partners.id, name: partners.name, edb: partners.edb, data: partners.data }).from(partners).where(eq(partners.firmId, firmId));
  const norm = (x: string) => latToCyr(x).toUpperCase().replace(/[^\p{L}\d ]/gu, ' ').replace(/\s+/g, ' ').trim();
  const byEmbg = new Map<string, string>(), byName = new Map<string, string>();
  for (const p of P) {
    const e = String(((p.data ?? {}) as { embg?: string }).embg ?? p.edb ?? '').replace(/\D/g, '');
    if (e.length === 13) byEmbg.set(e, p.id);
    if (!byName.has(norm(p.name))) byName.set(norm(p.name), p.id);
  }
  // the same person written otherwise in the statements: words in another order („Цана Деа“), a middle name
  // („АРЈАН СЕЛИМ ЦАНА“) or a shortened surname („РИГОН ХАЈДАР АД“ = РИГОН АДЕМИ) – every word of the recipient
  // matches a word of exactly ONE partner (equal, or one starts with the other, 2+ letters)
  const words = (x: string) => norm(x).split(' ').filter((w) => w.length > 1);
  const PW = P.map((p) => ({ id: p.id, w: words(p.name) }));
  const fuzzy = (name: string) => {
    const R = words(name);
    if (R.length < 2) return null;
    const hit = PW.filter((p) => R.every((r) => p.w.some((w) => w === r || (Math.min(w.length, r.length) >= 2 && (w.startsWith(r) || r.startsWith(w))))));
    return hit.length === 1 ? hit[0]!.id : null;
  };
  return (embg, name) => (embg && byEmbg.get(embg.replace(/\D/g, ''))) || byName.get(norm(name)) || fuzzy(name) || null;
}

/**
 * The recipient's partner, created when there is none yet (the calculation came before the statement): a natural
 * person with the Cyrillic name, ЕМБГ (partner data) and the account from the PDF – the statement's payment then finds
 * it by that account. A partner with the same account is reused.
 */
async function recipientPartner(firmId: string, find: (embg: string | null | undefined, name: string) => string | null, r: { embg?: string | null; name: string; acct?: string | null }): Promise<string | null> {
  const hit = find(r.embg, r.name);
  if (hit || !r.name.trim()) return hit;
  return db().transaction(async (tx) => {
    const p = await ensurePartner(tx, firmId, { name: latToCyr(r.name).toUpperCase(), bankAccount: r.acct || null, vatRegistered: false });
    if (p.created && r.embg) {
      const [x] = await tx.select({ data: partners.data }).from(partners).where(eq(partners.id, p.id));
      await tx.update(partners).set({ data: { ...((x?.data ?? {}) as object), embg: r.embg, person: true } }).where(eq(partners.id, p.id));
    }
    return p.id;
  });
}

/** „🔗 Поврзи ги примачите“: recipients of the year's payments without a partner → matched again (ЕМБГ / name), re-booked. */
export async function relinkPddAction(_p: ActionState, _f: FormData): Promise<ActionState> {
  let n = 0, left = 0;
  try {
    const { firm, year } = await firmAction('pddSave');
    const pidOf = await partnerMatcher(firm.id);
    const L = await db().select().from(pddPayments).where(and(eq(pddPayments.firmId, firm.id), sql`${pddPayments.date} between ${year + '-01-01'} and ${year + '-12-31'}`));
    for (const d of L) {
      let changed = false;
      const rows: PddRow[] = [];
      for (const r of d.rows) rows.push(await (async (): Promise<PddRow> => {
        if (r.pid) return { tid: r.tid, mode: r.mode, amt: r.amt, name: r.name, embg: r.embg, acct: r.acct, pid: r.pid };
        const pid = await recipientPartner(firm.id, pidOf, r);
        if (pid) changed = true; else left++;
        return { tid: r.tid, mode: r.mode, amt: r.amt, name: r.name, embg: r.embg, acct: r.acct, pid };
      })());
      // also re-booked when nothing new was linked: the ПДД lines get the person as partner too (older bookings had none)
      if (!changed && !rows.some((r) => r.pid)) continue;
      const res = await persistPdd({ id: d.id, date: d.date, note: d.note ?? '', rows });
      if ('error' in res) return res;
      n++;
    }
  } catch (e) { return actionError(e); }
  revalidatePath('/pdd');
  return { ok: `Прекнижени ${n} пресметки (комитент и на обврската и на ПДД).${left ? ` ${left} примачи и понатаму без комитент – отворете ја пресметката и изберете го комитентот (друго име во изводот).` : ''}` };
}

/**
 * „📄 Увези аконтативна пресметка“: one or MANY УЈП е-ПДД PDFs at once → one booked payment each (gross mode, the
 * type of the income code – added to the firm's types when new, konta by its group –, the recipients matched to
 * partners by ЕМБГ or name). A calculation already imported (its number in the note) is skipped, never booked twice.
 */
export async function importAkontAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const done: string[] = [], skip: string[] = [], bad: string[] = [];
  let lastId = '';
  try {
    const { firm } = await firmAction('pddSave');
    const files = f.getAll('pdf').filter((x): x is File => x instanceof File && x.size > 0);
    // „Вид“ chosen on the form (bonus, rent…) – else by the income code in each PDF
    const forced = String(f.get('tid') ?? '');
    if (!files.length) return { error: 'Изберете еден или повеќе PDF „Аконтативна пресметка“ од е-ПДД.' };
    const pidOf = await partnerMatcher(firm.id);
    const prev = await db().select({ note: pddPayments.note }).from(pddPayments).where(eq(pddPayments.firmId, firm.id));
    const seen = new Set(prev.map((x) => /Аконтативна пресметка бр\. (\d+)/.exec(x.note ?? '')?.[1]).filter(Boolean));
    for (const file of files.sort((x, y) => x.name.localeCompare(y.name))) {
      if (file.size > 10_000_000) { bad.push(`${file.name}: преголем`); continue; }
      const A = parseAkontativna(await pdfTextItems(new Uint8Array(await file.arrayBuffer())));
      if (!A) { bad.push(`${file.name}: не е аконтативна пресметка`); continue; }
      if (A.edb && firm.edb && A.edb !== firm.edb.replace(/\D/g, '')) { bad.push(`${file.name}: за друга фирма (ЕДБ ${A.edb})`); continue; }
      if (A.number && seen.has(A.number)) { skip.push(file.name); continue; }
      // the types: the firm's, plus one for every new income code of this PDF (its name, rates and group konta)
      const [fr] = await db().select({ settings: firms.settings }).from(firms).where(eq(firms.id, firm.id));
      let T = typesOf(fr?.settings);
      const add: PddType[] = [];
      for (const r of A.rows) {
        if (forced && T.some((t) => t.id === forced)) break;
        if (!r.code || T.some((t) => t.pod.startsWith(r.code + '.')) || add.some((t) => t.pod.startsWith(r.code + '.'))) continue;
        const k = pddKontaOfGroup(r.vid);
        if (!k) { bad.push(`${file.name}: нов вид приход „${r.code} ${r.pod}“ – внесете ги контата во „Видови приход и конта“`); continue; }
        const base = r.gross - r.ded;
        add.push({ id: r.code.toLowerCase().replace(/\./g, '_'), sh: r.pod.replace(/^S\d+\.\d+\.\s*/, '').slice(0, 40), vid: r.vid, pod: r.pod,
          ded: r.gross ? Math.round((r.ded / r.gross) * 100) : 0, tax: base ? Math.round((r.tax / base) * 100) : 10, ...k });
      }
      if (bad.some((b) => b.startsWith(file.name + ':'))) continue;
      if (add.length) {
        await db().transaction(async (tx) => {
          const [x] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, firm.id)).for('update');
          const S = (x?.settings ?? {}) as { pddTypes?: Partial<PddType>[] };
          await tx.update(firms).set({ settings: { ...S, pddTypes: [...(S.pddTypes ?? []), ...add] } }).where(eq(firms.id, firm.id));
        });
        T = [...T, ...add];
      }
      const rows: PddRow[] = [];
      for (const r of A.rows) rows.push({
        tid: (T.find((t) => forced && t.id === forced) ?? T.find((t) => r.code && t.pod.startsWith(r.code + '.')) ?? T.find((t) => t.id === 's1_15') ?? T[0]!).id,
        mode: 'g', amt: r.gross, name: r.name, embg: r.embg, acct: r.acct, pid: await recipientPartner(firm.id, pidOf, r),
      });
      const res = await persistPdd({ date: A.date || A.payDate, note: `Аконтативна пресметка бр. ${A.number}${A.payDate ? ' · плаќање до ' + A.payDate.split('-').reverse().join('.') : ''}`, rows });
      if ('error' in res) { bad.push(`${file.name}: ${res.error}`); continue; }
      lastId = res.id;
      if (A.number) seen.add(A.number);
      done.push(`${file.name} (${A.rows.length} ${A.rows.length === 1 ? 'примач' : 'примачи'})`);
    }
  } catch (e) { return actionError(e); }
  revalidatePath('/pdd');
  // one PDF: straight to its booking to check it; several: the list with the summary
  if (done.length === 1 && !bad.length && !skip.length) redirect(`/pdd?ed=${lastId}&imp=1`);
  const msg = [done.length ? `Прокнижени ${done.length}: ${done.join(', ')}.` : '', skip.length ? `Веќе увезени (прескокнати) ${skip.length}: ${skip.join(', ')}.` : '', bad.length ? `Не се увезени: ${bad.join('; ')}.` : ''].filter(Boolean).join(' ');
  return bad.length && !done.length ? { error: msg } : { ok: msg };
}

export async function deletePddAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('del');
    await db().transaction(async (tx) => {
      const [x] = await tx.select().from(pddPayments).where(and(eq(pddPayments.id, id), eq(pddPayments.firmId, firm.id))).limit(1);
      if (!x) throw new Error('Книжењето не постои.');
      await unpostSource(tx, { firmId: firm.id, sourceType: 'pdd', sourceId: id, userId: u.id });
      await tx.delete(pddPayments).where(eq(pddPayments.id, id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'pddDel', entityType: 'pdd_payment', entityId: id, data: { date: x.date } });
    });
    revalidatePath('/pdd');
    return { ok: 'Избришано.' };
  } catch (e) {
    if (e instanceof Error && e.message === 'Книжењето не постои.') return { error: e.message };
    return actionError(e);
  }
}

const KONTO = /^\d{3,10}$/;

/** Firm income types (legacy `pddTypesSave`, needs `settings`). */
export async function savePddTypesAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('settings');
    const ids = form.getAll('id').map(String);
    const g = (f: string, i: number) => String(form.getAll(f)[i] ?? '').trim();
    const T: PddType[] = ids.map((id, i) => ({
      id: id !== 'new' && /^[a-z0-9_]{1,40}$/i.test(id) ? id :'u' + Date.now().toString(36) + i,
      sh: g('sh', i), vid: g('vid', i), pod: g('pod', i), ded: +g('ded', i).replace(',', '.') || 0, tax: +g('tax', i).replace(',', '.') || 0,
      kExp: g('kExp', i), kLiab: g('kLiab', i), kTax: g('kTax', i),
    })).filter((t) => t.sh || t.pod);
    for (const t of T) {
      if (![t.kExp, t.kLiab, t.kTax].every((k) => KONTO.test(k))) return { error: `„${t.sh || t.pod}“: контата мора да имаат 3–10 цифри.` };
      if (t.ded < 0 || t.ded > 100 || t.tax < 0 || t.tax > 100) return { error: `„${t.sh || t.pod}“: процентите мора да се 0–100.` };
    }
    await db().transaction(async (tx) => {
      const [f] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, firm.id)).for('update');
      await tx.update(firms).set({ settings: { ...(f?.settings ?? {}), pddTypes: T } }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'pddTypesSave', entityType: 'firm', entityId: firm.id, data: { types: T.length } });
    });
    revalidatePath('/pdd');
    return { ok: 'Видовите приход се зачувани.' };
  } catch (e) { return actionError(e); }
}
