/**
 * Legacy `tplRun(keys, ctx, kind)`: a program document from the office's own Word template („📄 Шаблони“), filled with
 * the current firm + the document's values. `?k=<template key>&src=<kd|osn|aml|emp|user|firm>:<id>&fmt=word|pdf`;
 * `pdf` returns the print view (HTML → „⬇ PDF“ on the server), `word` the filled .docx.
 */
import { and, eq } from 'drizzle-orm';
import { KD_SVC } from '@wise/core/firms/kdog';
import { amlNextReview, capitalSum, tplAmlVars, tplKdVars, tplOsnVars, tplPersonVars, tplSrcParse, AML_LV, type AmlFile, type AmlLevel, type CapItem } from '@wise/core/office';
import { firmAllowed } from '@wise/core';
import { amlRecords, audit, employees, firms, formationCases, serviceContracts, users, type Firm } from '@wise/db';
import { Forbidden, getUser, requireCan } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { amlOffice } from '@/lib/aml';
import { fmt } from '@/lib/fmt';
import { today } from '@/lib/office';
import { DOCX_MIME, attachmentName, fillOwnTemplate, ownTemplate } from '@/lib/own-template';
import { fname, htmlResponse, printDoc } from '@/lib/payroll/html';
import { rowToContract } from '@/app/(app)/kdogovori/lib';

const text = (s: string, status = 400) => new Response(s, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const u0 = await getUser();
  if (!u0) return new Response('unauthorized', { status: 401 });
  const k = String(q.get('k') ?? '').slice(0, 200);
  const src = tplSrcParse(q.get('src') ?? 'firm:');
  if (!k || !src) return text('Непознат документ.');
  // `firm:<id>` — a document for another client (e.g. the DPA per client in ЗЗЛП), if the user may see that firm.
  let firm0 = await currentFirm(u0);
  if (src.t === 'firm' && src.id) {
    const [f] = await db().select().from(firms).where(eq(firms.id, src.id)).limit(1);
    firm0 = f && firmAllowed(u0.principal, f.id, f.ownerId) ? f : null;
  }
  if (!firm0) return text('Изберете фирма.');
  let firm: Firm = firm0;
  try {
    const u = await requireCan('office', firm.id);
    const t = await ownTemplate([k]);
    if (!t) return text('Нема прикачен сопствен шаблон за овој документ (Канцеларија → Шаблони).', 404);
    let vars: Record<string, string | number | null | undefined> = {};
    let base = t.name;
    if (src.t === 'kd') {
      const [r] = await db().select().from(serviceContracts).where(and(eq(serviceContracts.id, src.id), eq(serviceContracts.firmId, firm.id))).limit(1);
      if (!r) return text('Договорот не постои.', 404);
      const c = rowToContract(r);
      vars = tplKdVars({ ...c, fee: fmt(Number(c.fee) || 0), services: KD_SVC.filter(([id]) => c.svc.includes(id)).map(([, n]) => n) });
      base = 'Dogovor_' + c.number;
    } else if (src.t === 'osn') {
      const [c] = await db().select().from(formationCases).where(eq(formationCases.id, src.id)).limit(1);
      if (!c) return text('Основањето не постои.', 404);
      vars = tplOsnVars({ ...c, capEur: capitalSum(c.capItems as CapItem[], Number(c.eurRate)).eur }, { name: u.name });
      base = `${t.name}_${c.name}`;
    } else if (src.t === 'aml') {
      const [r] = await db().select().from(amlRecords).where(eq(amlRecords.firmId, firm.id)).limit(1);
      const A = (r?.data ?? null) as AmlFile | null;
      const lv = r?.level as AmlLevel | undefined;
      vars = tplAmlVars(A, { level: lv ? AML_LV[lv]?.[0] : null, next: r?.nextReview ?? (A && lv ? amlNextReview(A, lv, today()) : null) }, await amlOffice());
    } else if (src.t === 'emp') {
      const [e] = await db().select().from(employees).where(and(eq(employees.id, src.id), eq(employees.firmId, firm.id))).limit(1);
      if (!e) return text('Вработениот не постои.', 404);
      vars = tplPersonVars(e);
      base = `${t.name}_${e.name}`;
    } else if (src.t === 'user') {
      const [x] = await db().select({ name: users.name, role: users.role }).from(users).where(eq(users.id, src.id)).limit(1);
      if (!x) return text('Корисникот не постои.', 404);
      // legacy `zzPerson`: ЕМБГ / position from the office firm's employee with the same name
      const off = (await db().select().from(firms)).find((f) => (f.settings as { officeFirm?: boolean }).officeFirm);
      const e = off ? (await db().select().from(employees).where(eq(employees.firmId, off.id))).find((y) => y.name.trim().toLowerCase() === x.name.trim().toLowerCase()) : undefined;
      if (off) firm = off;
      vars = tplPersonVars({ name: x.name, embg: e?.embg, position: e?.position });
      base = `${t.name}_${x.name}`;
    } else {
      vars = tplAmlVars(null, {}, await amlOffice());
    }
    const R = await fillOwnTemplate(t, firm, vars);
    await db().transaction((tx) => audit(tx, { userId: u.id, firmId: firm.id, action: 'tplUse', entityType: 'word_template', entityId: t.id, data: { name: t.name, kind: t.kind, src: src.t, missing: R.missing } }));
    const name = `${fname(base).slice(0, 70)}_${fname(firm.name).slice(0, 30)}`;
    if (q.get('fmt') === 'word') return new Response(Buffer.from(R.docx), { headers: { 'content-type': DOCX_MIME, 'content-disposition': attachmentName(name + '.docx') } });
    const warn = R.missing.length ? `<div class="pbar" style="color:#a00">⚠ Полиња без вредност во шаблонот: ${R.missing.slice(0, 6).join(', ')}${R.missing.length > 6 ? ' …' : ''}</div>` : '';
    return htmlResponse(printDoc(name, R.html()).replace('<div class="page">', `${warn}<div class="page">`));
  } catch (e) {
    if (e instanceof Forbidden) return text(e.message, 403);
    throw e;
  }
}
