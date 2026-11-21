'use server';
/**
 * Donations & sponsorships: save / delete the contract, the confirmation of the realised donation, the signed scan,
 * and the booking proposal (statement lines → donation konto; in kind → own nalog). Every write checks the permission
 * and writes `audit_log` in the same transaction.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import { DON_KIND_LBL, donEntries, donKonto, nextDonNo, type DonKind, type DonRole } from '@wise/core/donations';
import { audit, bankLines, donations, DONATION_FILE_ENTITY, fileLinks, files, IndustryError, partners, postJournal, savePublicInterest, setDonationIds, setLineKonto, unpostSource } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { isDate } from '@/lib/finance';
import { donData } from './data';

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const num = (f: FormData, k: string) => Number(s(f, k).replace(/\s/g, '').replace(',', '.'));
const UUID = /^[0-9a-f-]{36}$/i;
const NF = 'Договорот не постои.';

export async function saveDonationAction(_p: ActionState, f: FormData): Promise<ActionState> {
  let id = s(f, 'id');
  try {
    const { u, firm, year } = await firmAction('donSave');
    const kind: DonKind = s(f, 'kind') === 'sponsorship' ? 'sponsorship' : 'donation';
    const role: DonRole = s(f, 'role') === 'given' ? 'given' : 'received';
    const partnerId = s(f, 'partnerId');
    if (!UUID.test(partnerId)) return { error: role === 'received' ? 'Изберете донатор / спонзор од комитентите.' : 'Изберете примател од комитентите.' };
    const [p] = await db().select({ id: partners.id }).from(partners).where(and(eq(partners.id, partnerId), eq(partners.firmId, firm.id))).limit(1);
    if (!p) return { error: 'Изберете комитент.' };
    const date = s(f, 'date');
    if (!isDate(date)) return { error: 'Внесете датум.' };
    const amount = num(f, 'amount');
    if (!(amount > 0)) return { error: 'Внесете износ (за донација во добра – вредноста).' };
    const inKind = f.get('inKind') === '1';
    if (inKind && !s(f, 'inKindDesc')) return { error: 'Опишете ги добрата / услугите.' };
    const termDate = s(f, 'termDate') || null;
    if (termDate && (!isDate(termDate) || termDate < date)) return { error: 'Рокот е пред датумот на договорот.' };
    const D = await donData(firm, year);
    const konto = s(f, 'konto') || donKonto(kind, role, D.chartMode, inKind);
    if (!/^\d{3,10}$/.test(konto)) return { error: 'Контото мора да има 3–10 цифри.' };
    const moveIds = f.getAll('mv').map(String).filter((x) => UUID.test(x));
    // a statement line belongs to one contract only
    const other = D.list.find((x) => x.id !== id && x.moveIds.some((m) => moveIds.includes(m)));
    if (other) return { error: `Ставката од изводот е веќе поврзана со договор ${other.number ?? ''}.` };
    const number = s(f, 'number') || nextDonNo(D.list.filter((x) => x.kind === kind && x.role === role).map((x) => ({ no: x.number, date: x.date })), date.slice(0, 4));
    const row = {
      kind, role, partnerId, partnerName: null, number, date, place: s(f, 'place') || null, amount: amount.toFixed(2), inKind, inKindDesc: inKind ? s(f, 'inKindDesc') : null,
      purpose: s(f, 'purpose') || null, area: s(f, 'area') || null, counter: kind === 'sponsorship' ? s(f, 'counter') || null : null, termDate,
      cash: !inKind && f.get('cash') === '1', signed: f.get('signed') === '1', konto, moveIds,
    };
    await db().transaction(async (tx) => {
      if (id) {
        const [x] = await tx.update(donations).set(row).where(and(eq(donations.id, id), eq(donations.firmId, firm.id))).returning({ id: donations.id });
        if (!x) throw new Error(NF);
      } else id = (await tx.insert(donations).values({ ...row, firmId: firm.id, createdBy: u.id }).returning({ id: donations.id }))[0]!.id;
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'donSave', entityType: 'donation', entityId: id, data: { kind, role, number, amount: row.amount, moves: moveIds.length } });
    });
  } catch (e) {
    if (e instanceof Error && e.message === NF) return { error: e.message };
    return actionError(e);
  }
  revalidatePath('/donacii');
  redirect(`/donacii?ed=${id}`);
}

export async function deleteDonationAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('del');
    await db().transaction(async (tx) => {
      const [d] = await tx.select({ journalId: donations.journalId }).from(donations).where(and(eq(donations.id, id), eq(donations.firmId, firm.id))).limit(1);
      if (d?.journalId) throw new Error('Донацијата во добра е прокнижена – прво избришете го налогот.');
      const [x] = await tx.delete(donations).where(and(eq(donations.id, id), eq(donations.firmId, firm.id))).returning({ number: donations.number });
      if (x) await audit(tx, { userId: u.id, firmId: firm.id, action: 'donDel', entityType: 'donation', entityId: id, data: { number: x.number } });
    });
    revalidatePath('/donacii');
    return { ok: 'Избришано.' };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Донацијата')) return { error: e.message };
    return actionError(e);
  }
}

/** The confirmation of the realised donation / sponsorship (number, date, amount; default = linked lines). */
export async function saveConfAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('donSave');
    const id = s(f, 'id');
    const D = await donData(firm, year);
    const d = D.list.find((x) => x.id === id);
    if (!d) return { error: NF };
    const confDate = s(f, 'confDate');
    if (!isDate(confDate)) return { error: 'Внесете датум на потврдата.' };
    if (confDate < d.date) return { error: 'Потврдата е пред датумот на договорот.' };
    const a = num(f, 'confAmount');
    if (!(a > 0)) return { error: 'Внесете реализиран износ.' };
    const confNumber = s(f, 'confNumber') || nextDonNo(D.list.filter((x) => x.confNumber && x.id !== id).map((x) => ({ no: x.confNumber, date: x.confDate })), confDate.slice(0, 4));
    await db().transaction(async (tx) => {
      await tx.update(donations).set({ confNumber, confDate, confAmount: a.toFixed(2), confNote: s(f, 'confNote') || null }).where(and(eq(donations.id, id), eq(donations.firmId, firm.id)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'donConf', entityType: 'donation', entityId: id, data: { confNumber, confDate, amount: a } });
    });
    revalidatePath('/donacii');
    return { ok: `Потврдата бр. ${confNumber} е зачувана.` };
  } catch (e) { return actionError(e); }
}

/**
 * Booking proposal: the linked statement lines get the donation konto and the donor / recipient as partner
 * (the statement is re-posted); an in-kind donation gets its own nalog Д asset / П 767x (recipient) or Д 443x / П goods (donor).
 */
export async function bookDonationAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('donBook');
    const id = s(f, 'id');
    const D = await donData(firm, year);
    const d = D.list.find((x) => x.id === id);
    if (!d) return { error: NF };
    const konto = d.konto || donKonto(d.kind, d.role, D.chartMode, d.inKind);
    const known = (k: string) => D.codes.has(k) || [...D.codes].some((c) => c.startsWith(k) && c.length > k.length);
    if (!known(konto)) return { error: `Контото ${konto} го нема во контниот план на фирмата – додадете го или сменете го контото во договорот.` };
    if (d.inKind) {
      const other = s(f, 'assetKonto');
      if (!/^\d{3,10}$/.test(other)) return { error: 'Внесете конто за добрата / услугите (спротивно конто).' };
      if (!known(other)) return { error: `Контото ${other} го нема во контниот план на фирмата – внесете друго спротивно конто за добрата.` };
      const amt = Number(d.confAmount ?? d.amount);
      const date = d.confDate || d.date;
      const note = `${DON_KIND_LBL[d.kind]} во добра, дог. ${d.number ?? ''}`;
      const n = await db().transaction(async (tx) => {
        const j = await postJournal(tx, {
          firmId: firm.id, date, kind: 'manual', description: note, sourceType: 'donation', sourceId: d.id, userId: u.id, auditAction: 'donBook',
          lines: donEntries({ kind: d.kind, role: d.role, amount: amt, inKind: true, konto, assetKonto: other, note, chart: D.chartMode }).map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, note: l.note, doc: d.number, partnerId: l.partner ? d.partnerId : null })),
          requirePartner: false,
        });
        await tx.update(donations).set({ journalId: j.id }).where(eq(donations.id, d.id));
        return j.number;
      });
      revalidatePath('/donacii');
      return { ok: `✓ Прокнижено со налог ${n}.` };
    }
    if (!d.moveIds.length) return { error: 'Поврзете ги уплатите од изводот со договорот (во формата) – или книжете рачно.' };
    let n = 0;
    await db().transaction(async (tx) => {
      const L = await tx.select({ id: bankLines.id }).from(bankLines).where(and(eq(bankLines.firmId, firm.id), inArray(bankLines.id, d.moveIds)));
      for (const l of L) { await setLineKonto(tx, { firmId: firm.id, userId: u.id, lineId: l.id, konto, partnerId: d.partnerId, learn: false }); n++; }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'donBook', entityType: 'donation', entityId: d.id, data: { konto, lines: n } });
    });
    revalidatePath('/donacii');
    revalidatePath('/banka');
    return { ok: `✓ ${n} ставки од изводот се книжат на конто ${konto} (налогот на изводот е повторно прокнижен).` };
  } catch (e) {
    if (e instanceof Error && e.name === 'BankError') return { error: e.message };
    return actionError(e);
  }
}

/** Remove the nalog of an in-kind donation. */
export async function unbookDonationAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('donBook');
    await db().transaction(async (tx) => {
      const [d] = await tx.select({ journalId: donations.journalId }).from(donations).where(and(eq(donations.id, id), eq(donations.firmId, firm.id))).limit(1);
      if (!d?.journalId) return;
      await unpostSource(tx, { firmId: firm.id, sourceType: 'donation', sourceId: id, userId: u.id });
      await tx.update(donations).set({ journalId: null }).where(eq(donations.id, id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'donUnbook', entityType: 'donation', entityId: id, data: {} });
    });
    revalidatePath('/donacii');
    return { ok: 'Налогот е избришан.' };
  } catch (e) {
    return actionError(e);
  }
}

export async function attachDonSignedAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('donSave');
    const id = s(f, 'id');
    const ids = f.getAll('fileIds').map(String).filter((x) => UUID.test(x));
    if (!ids.length) return { error: 'Прикачете го потпишаниот документ.' };
    await db().transaction(async (tx) => {
      const [d] = await tx.select({ id: donations.id }).from(donations).where(and(eq(donations.id, id), eq(donations.firmId, firm.id))).limit(1);
      if (!d) throw new Error(NF);
      const F = await tx.select({ id: files.id }).from(files).where(and(eq(files.firmId, firm.id), inArray(files.id, ids)));
      for (const x of F) await tx.insert(fileLinks).values({ fileId: x.id, entityType: DONATION_FILE_ENTITY, entityId: id, role: 'signed' }).onConflictDoNothing();
      await tx.update(donations).set({ signed: true }).where(eq(donations.id, id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'donAtt', entityType: 'donation', entityId: id, data: { files: F.length } });
    });
    revalidatePath('/donacii');
    return { ok: 'Потпишаниот документ е прикачен.' };
  } catch (e) {
    if (e instanceof Error && e.message === NF) return { error: e.message };
    return actionError(e);
  }
}

/** УЈП-ИДС/ПР: fulfilment date of the contract (the 30-day deadline runs from it) and the date it was submitted. */
export async function saveIdsAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('donSave');
    const fd = s(f, 'fulfilledDate'), fl = s(f, 'idsFiled');
    if ((fd && !isDate(fd)) || (fl && !isDate(fl))) return { error: 'Невалиден датум.' };
    await db().transaction(async (tx) => {
      await setDonationIds(tx, { firmId: firm.id, userId: u.id }, s(f, 'id'), { fulfilledDate: fd || null, idsFiled: fl || null });
      if (f.has('piNo')) await savePublicInterest(tx, { firmId: firm.id, userId: u.id }, { no: s(f, 'piNo'), date: s(f, 'piDate') || null });
    });
    revalidatePath('/donacii');
    revalidatePath('/rokovi');
    return { ok: fl ? 'Извештајот УЈП-ИДС/ПР е означен како поднесен.' : 'Зачувано.' };
  } catch (e) {
    if (e instanceof IndustryError) return { error: e.message };
    return actionError(e);
  }
}
