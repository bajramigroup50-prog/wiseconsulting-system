import 'server-only';
/**
 * 🤝 IFAC – server helpers: the letter HTML with the office memo (the same `firmOf` / office firm as the contract), and
 * the firm's signed contract the new letter takes over (number, fees, services, signatory).
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { ROLES, type Role } from '@wise/core';
import { isosTitle, type IsosListRow } from '@wise/core/office/ifac-isos';
import { staffNormalize } from '@wise/core/office/ifac-sqm';
import { elHtml, type ElContract, type ElLetter } from '@wise/core/office/ifac';
import type { KdOffice } from '@wise/core/firms/kdog';
import { ethicsStaff, ifacRecords, serviceContracts, type Firm } from '@wise/db';
import { db } from '@/lib/db';
import { firmOf, imgUrl, officeFirm, rowToContract } from '../kdogovori/lib';

export async function letterHtml(l: ElLetter, firm: Firm, O: KdOffice, draftMark = true): Promise<string> {
  const off = await officeFirm(O, firm);
  return elHtml(l, { firm: firmOf(firm), firmId: firm.id, O, off: off ? firmOf(off) : null, img: imgUrl, draftMark });
}

/** The newest contract of the firm (signed first) as the letter's starting data. */
export async function contractFor(firmId: string): Promise<ElContract | null> {
  const R = await db().select().from(serviceContracts).where(and(eq(serviceContracts.firmId, firmId))).orderBy(desc(serviceContracts.date));
  const r = R.find((x) => x.status === 'signed') ?? R.find((x) => x.status !== 'ended');
  if (!r) return null;
  const k = rowToContract(r);
  return { number: k.number, feeMode: k.feeMode, fee: k.fee, feeYear: k.feeYear, feeHour: k.feeHour, docDay: k.docDay, payDay: k.payDay, svc: k.svc, rep: k.rep, repRole: k.repRole };
}

/**
 * The list for ИСОС (ЗВСР чл. 32 ст. 9): every office employee with the title in the ИСОС registers and the register
 * number from the staff record of the year (or the previous year's when this year's is not entered yet).
 */
export async function isosListRows(year: number, demo: boolean): Promise<IsosListRow[]> {
  const [staff, R] = await Promise.all([
    db().transaction((tx) => ethicsStaff(tx, demo)),
    db().select().from(ifacRecords).where(and(eq(ifacRecords.kind, 'staff'), inArray(ifacRecords.year, [year, year - 1]))),
  ]);
  return staff.map((u) => {
    const r = R.find((x) => x.subject === u.id && x.year === year) ?? R.find((x) => x.subject === u.id && x.year === year - 1);
    const d = r ? staffNormalize(r.data) : null;
    return { name: u.name, title: isosTitle(d?.isos, ROLES[u.role as Role]?.n ?? u.role), reg: d?.licence ?? '' };
  });
}
