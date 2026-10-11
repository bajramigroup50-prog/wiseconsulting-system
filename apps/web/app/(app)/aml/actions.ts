'use server';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { AML_IND, amlDeadline, amlNextReview, amlRiskFull, isAmlLevel, type AmlCdd, type BeneficialOwner } from '@wise/core/office';
import { amlRecords, amlReports, audit } from '@wise/db';
import { AML_CDD_ENTITY, amlAutoFor, amlGuard } from '@/lib/aml';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fdate, fv, linkFiles, officeAction, officeError, today } from '@/lib/office';

const pick = <T extends string>(v: string | null, ok: readonly T[]): T | '' => (v && (ok as readonly string[]).includes(v) ? (v as T) : '');

/**
 * Legacy `amlPut` (`appaml/{fid}`) + risk re-evaluation. Stored server-side only (no localStorage — FIX #5).
 * Server additions: the full CDD file of чл. 15–19 (client, representative, authorised person, beneficial owners with
 * the ЦРСМ check, PEP declaration, sanctions screening, EDD, relationship start / end), the risk history, the
 * documents (office files) and — when the ЦРСМ check shows a discrepancy or the CDD cannot be completed — the
 * report to УФР (чл. 32, чл. 46) created with its deadline. Management approval (EDD) only by the owner.
 */
export async function saveAml(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { firm } = await officeAction('office');
    const u = await amlGuard();
    const bo: BeneficialOwner[] = [];
    for (let i = 0; i < 6; i++) {
      const name = fv(f, `bo${i}_name`);
      if (!name) continue;
      bo.push({ name, embg: fv(f, `bo${i}_embg`) ?? undefined, cit: fv(f, `bo${i}_cit`) ?? 'Македонско', share: Number(fv(f, `bo${i}_share`)) || undefined,
        legal: f.get(`bo${i}_legal`) === 'on', pep: f.get(`bo${i}_pep`) === 'on', ver: fdate(f, `bo${i}_ver`) });
    }
    const lv = fv(f, 'lvOver');
    const td = today();
    const [old0] = await db().select({ data: amlRecords.data, level: amlRecords.level }).from(amlRecords).where(eq(amlRecords.firmId, firm.id)).limit(1);
    const old = (old0?.data ?? {}) as AmlCdd;
    if (f.get('mgrOk') === 'on' && u.role !== 'admin') return { error: 'Одобрението за засилена анализа го дава раководството (сопственикот) – чл. 39, 42.' };
    const A: AmlCdd = {
      bo, pep: f.get('pep') === 'on', pepAsked: f.get('pepAsked') === 'on' ? true : undefined, hrc: f.get('hrc') === 'on', nonFace: f.get('nonFace') === 'on',
      crDate: fdate(f, 'crDate'),
      rep: { name: fv(f, 'rep_name') ?? undefined, embg: fv(f, 'rep_embg') ?? undefined, idNo: fv(f, 'rep_idNo') ?? undefined, idType: fv(f, 'rep_idType') ?? undefined, idValid: fdate(f, 'rep_idValid') ?? undefined, ver: f.get('rep_ver') === 'on' },
      repX: { idIssuer: fv(f, 'rep_idIssuer') ?? '', address: fv(f, 'rep_address') ?? '', cit: fv(f, 'rep_cit') ?? '', dob: fdate(f, 'rep_dob') ?? '', verMethod: fv(f, 'rep_verMethod') ?? '', verDate: fdate(f, 'rep_verDate'), role: fv(f, 'rep_role') ?? '' },
      proxy: { name: fv(f, 'px_name') ?? '', embg: fv(f, 'px_embg') ?? '', idNo: fv(f, 'px_idNo') ?? '', basis: fv(f, 'px_basis') ?? '' },
      client: { legalForm: fv(f, 'cl_legalForm') ?? '', seat: fv(f, 'cl_seat') ?? '', crNo: fv(f, 'cl_crNo') ?? '', activity: fv(f, 'cl_activity') ?? '', bankAccounts: fv(f, 'cl_bank') ?? '' },
      purpose: fv(f, 'purpose') ?? undefined, source: fv(f, 'source') ?? undefined, wealth: fv(f, 'wealth') ?? undefined, services: fv(f, 'services') ?? undefined,
      relStart: fdate(f, 'relStart'), relEnd: fdate(f, 'relEnd'), cddDone: fdate(f, 'cddDone'),
      crsm: { date: fdate(f, 'crsm_date'), result: pick(fv(f, 'crsm_result'), ['match', 'mismatch', 'none'] as const), discReported: fdate(f, 'crsm_disc'), note: fv(f, 'crsm_note') ?? '' },
      pepDecl: { date: fdate(f, 'pepd_date'), isPep: f.get('pep') === 'on', fn: fv(f, 'pepd_fn') ?? '', relation: fv(f, 'pepd_rel') ?? '' },
      sanc: { date: fdate(f, 'sanc_date'), lists: fv(f, 'sanc_lists') ?? '', result: pick(fv(f, 'sanc_result'), ['none', 'possible', 'hit'] as const), by: fv(f, 'sanc_date') ? (fv(f, 'sanc_by') ?? u.name) : '', note: fv(f, 'sanc_note') ?? '' },
      edd: { reason: fv(f, 'edd_reason') ?? '', measures: fv(f, 'edd_measures') ?? '', monitoring: fv(f, 'edd_mon') ?? '', mgrBy: old.edd?.mgrBy ?? '' },
      simplified: f.get('simplified') === 'on', simplifiedReason: fv(f, 'simplifiedReason') ?? '',
      refused: fdate(f, 'ref_date') ? { date: fdate(f, 'ref_date'), reason: fv(f, 'ref_reason') ?? '' } : undefined,
      ind: Object.fromEntries(AML_IND.map(([k]) => [k, f.get(`ind_${k}`) === 'on'])),
      lvOver: isAmlLevel(lv) ? lv : null,
      lastReview: f.get('reviewed') === 'on' ? td : fdate(f, 'lastReview'),
    };
    A.pepAsked = A.pepAsked || !!A.pepDecl?.date || undefined;
    A.created = old.created ?? td;
    A.mgrOk = f.get('mgrOk') === 'on' ? td : old.mgrOk ?? null;
    if (f.get('mgrOk') === 'on') A.edd = { ...A.edd, mgrBy: u.name };
    if (A.relEnd && A.relStart && A.relEnd < A.relStart) return { error: 'Крајот на деловниот однос е пред почетокот.' };
    const X = await amlAutoFor(firm, Number(td.slice(0, 4)));
    const r = amlRiskFull(A, X, { eurRate: X.eurRate, today: td, nkd: X.nkd });
    if (A.simplified && r.level !== 'low') return { error: 'Поедноставена анализа е дозволена само при документиран низок ризик (чл. 38).' };
    const prevH = old.hist ?? [];
    const last = prevH[prevH.length - 1];
    A.hist = !last || last.level !== r.level || last.score !== r.score || f.get('reviewed') === 'on'
      ? [...prevH, { date: td, level: r.level, score: r.score, by: u.name, factors: r.factors.map(([t]) => t) }].slice(-50) : prevH;
    const next = amlNextReview(A, r.level, td);
    const data = A as Record<string, unknown>;
    const ids = f.getAll('fileIds');
    const extra: string[] = [];
    await db().transaction(async (tx) => {
      await tx.insert(amlRecords).values({ firmId: firm.id, data, level: r.level, score: r.score, lastReview: A.lastReview ?? null, nextReview: next, updatedBy: u.id })
        .onConflictDoUpdate({ target: amlRecords.firmId, set: { data, level: r.level, score: r.score, lastReview: A.lastReview ?? null, nextReview: next, updatedBy: u.id } });
      await linkFiles(tx, ids, null, AML_CDD_ENTITY, firm.id);
      // чл. 32: a discrepancy with the beneficial-owner register goes to УФР without delay
      if (A.crsm?.result === 'mismatch' && old.crsm?.result !== 'mismatch') {
        await tx.insert(amlReports).values({ firmId: firm.id, firmName: firm.name, text: `Несогласување на податоците за вистинскиот сопственик со Регистарот (ЦРСМ). ${A.crsm.note ?? ''}`.trim(), createdBy: u.id, createdByName: u.name,
          data: { kind: 'bo', from: td, due: amlDeadline('bo', td), form: { legal: `${firm.name}, ЕДБ ${firm.edb ?? ''}, ЕМБС ${firm.embs ?? ''}`, subjects: bo.map((b) => `${b.name} ${b.embg ?? ''} ${b.share ? `${b.share}%` : ''}`).join('\n'), desc: A.crsm.note ?? '' } } });
        extra.push('креирана пријава за несогласување до УФР (чл. 32)');
      }
      // чл. 46: CDD could not be completed → relationship refused / terminated, notify УФР, analyse whether to file an STR
      if (A.refused?.date && !old.refused?.date) {
        await tx.insert(amlReports).values({ firmId: firm.id, firmName: firm.name, text: `Деловниот однос е одбиен / прекинат – анализата не може да се спроведе. ${A.refused.reason ?? ''}`.trim(), createdBy: u.id, createdByName: u.name,
          data: { kind: 'ref', from: A.refused.date, due: amlDeadline('ref', A.refused.date), form: { legal: `${firm.name}, ЕДБ ${firm.edb ?? ''}`, desc: A.refused.reason ?? '' } } });
        extra.push('креирано известување до УФР за одбиен/прекинат однос (чл. 46) – направете и писмена анализа дали треба STR');
      }
      await audit(tx, { userId: u.id, action: 'amlSave', entityType: 'aml_record', entityId: firm.id, data: { client: firm.id, level: r.level, score: r.score, files: ids.length } });
    });
    revalidatePath('/aml');
    return { ok: `Зачувано. Ризик: ${r.level} (${r.score} поени).${extra.length ? ` ⚠ ${extra.join('; ')}.` : ''}` };
  } catch (e) { return officeError(e); }
}
