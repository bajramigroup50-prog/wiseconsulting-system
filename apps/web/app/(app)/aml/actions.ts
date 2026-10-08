'use server';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { AML_IND, amlNextReview, amlRisk, isAmlLevel, type AmlFile, type BeneficialOwner } from '@wise/core/office';
import { amlRecords, audit } from '@wise/db';
import { amlAutoFor } from '@/lib/aml';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fdate, fv, officeAction, officeError, today } from '@/lib/office';

/** Legacy `amlPut` (`appaml/{fid}`) + risk re-evaluation. Stored server-side only (no localStorage — FIX #5). */
export async function saveAml(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const bo: BeneficialOwner[] = [];
    for (let i = 0; i < 4; i++) {
      const name = fv(f, `bo${i}_name`);
      if (!name) continue;
      bo.push({ name, embg: fv(f, `bo${i}_embg`) ?? undefined, cit: fv(f, `bo${i}_cit`) ?? 'Македонско', share: Number(fv(f, `bo${i}_share`)) || undefined,
        legal: f.get(`bo${i}_legal`) === 'on', pep: f.get(`bo${i}_pep`) === 'on', ver: fdate(f, `bo${i}_ver`) });
    }
    const lv = fv(f, 'lvOver');
    const A: AmlFile = {
      bo, pep: f.get('pep') === 'on', pepAsked: f.get('pepAsked') === 'on' ? true : undefined, hrc: f.get('hrc') === 'on', nonFace: f.get('nonFace') === 'on',
      crDate: fdate(f, 'crDate'),
      rep: { name: fv(f, 'rep_name') ?? undefined, embg: fv(f, 'rep_embg') ?? undefined, idNo: fv(f, 'rep_idNo') ?? undefined, idValid: fdate(f, 'rep_idValid') ?? undefined, ver: f.get('rep_ver') === 'on' },
      purpose: fv(f, 'purpose') ?? undefined, source: fv(f, 'source') ?? undefined, wealth: fv(f, 'wealth') ?? undefined,
      ind: Object.fromEntries(AML_IND.map(([k]) => [k, f.get(`ind_${k}`) === 'on'])),
      lvOver: isAmlLevel(lv) ? lv : null,
      lastReview: f.get('reviewed') === 'on' ? today() : fdate(f, 'lastReview'),
    };
    const td = today();
    const [old] = await db().select({ data: amlRecords.data }).from(amlRecords).where(eq(amlRecords.firmId, firm.id)).limit(1);
    A.created = (old?.data as AmlFile | undefined)?.created ?? td;
    const X = await amlAutoFor(firm, Number(td.slice(0, 4)));
    const r = amlRisk(A, X, { eurRate: X.eurRate, today: td, nkd: X.nkd });
    const next = amlNextReview(A, r.level, td);
    const data = A as Record<string, unknown>;
    await db().transaction(async (tx) => {
      await tx.insert(amlRecords).values({ firmId: firm.id, data, level: r.level, score: r.score, lastReview: A.lastReview ?? null, nextReview: next, updatedBy: u.id })
        .onConflictDoUpdate({ target: amlRecords.firmId, set: { data, level: r.level, score: r.score, lastReview: A.lastReview ?? null, nextReview: next, updatedBy: u.id } });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'amlSave', entityType: 'aml_record', entityId: firm.id, data: { level: r.level, score: r.score } });
    });
    revalidatePath('/aml');
    return { ok: `Зачувано. Ризик: ${r.level} (${r.score} поени).` };
  } catch (e) { return officeError(e); }
}
