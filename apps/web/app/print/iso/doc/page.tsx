/**
 * A system document (ПОЛ / ПОС) for print, under document control (ISO 9001 §7.5): the mark, title, version, author,
 * approval, review date, distribution and the change history, the text; every page carries „ПОЛ-01 · в.1.0 · стр. 1/3“.
 */
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { can } from '@wise/core';
import type { IsoRev } from '@wise/core/office/iso';
import { getOfficeProfile, isoRecords, users } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { viewAllowed } from '@/lib/nav';
import { docPageCss } from '../page-css';

export const metadata = { title: 'Документ на системот' };


export default async function PrintIsoDoc({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const u = await requireUser();
  if (!viewAllowed(u.role, 'iso') || !can(u.principal, 'office', null)) notFound();
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(sp.id ?? '')) notFound();
  const [r] = await db().select().from(isoRecords).where(eq(isoRecords.id, sp.id!)).limit(1);
  if (!r || r.kind !== 'policy') notFound();
  const [O, U] = await Promise.all([getOfficeProfile(db()), db().select({ id: users.id, name: users.name }).from(users)]);
  const d = r.data ?? {}, mark = `${String(d.docNo ?? '—')} · в.${String(d.version ?? '—')}`;
  const revs = (Array.isArray(d._rev) ? d._rev : []) as IsoRev[];
  const inForce = r.status === 'done' && !!d.approvedOn;
  const cell = { border: '1px solid #999', padding: '2px 5px', verticalAlign: 'top' } as const;
  return (
    <div className="pdfdoc" style={{ fontFamily: "'Times New Roman',Georgia,serif", fontSize: '11pt', lineHeight: 1.5 }}>
      <style dangerouslySetInnerHTML={{ __html: docPageCss(mark, O.name ?? '') }} />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt', fontFamily: 'Arial,Helvetica,sans-serif' }}><tbody>
        <tr><td style={{ ...cell, width: '30%' }} rowSpan={2}><b>{O.name}</b></td><td style={{ ...cell, textAlign: 'center', fontSize: '12pt' }} colSpan={3}><b>{r.title}</b></td></tr>
        <tr><td style={cell}>Ознака: <b>{String(d.docNo ?? '')}</b></td><td style={cell}>Верзија: <b>{String(d.version ?? '')}</b></td><td style={cell}>{inForce ? `Во сила од ${dmy(String(d.approvedOn))}` : <b style={{ color: '#b42318' }}>НАЦРТ – не е одобрен</b>}</td></tr>
        <tr><td style={cell}>Изработил: {String(d.author ?? '')}</td><td style={cell} colSpan={2}>Одобрил: {String(d.approvedBy ?? '')}</td><td style={cell}>Следен преглед: {d.reviewOn ? dmy(String(d.reviewOn)) : '—'}</td></tr>
        <tr><td style={cell} colSpan={4}>Дистрибуција: {String(d.distribution ?? 'сите вработени (програмата)')} · Важечка е само верзијата во програмата; отпечатената копија е информативна.</td></tr>
      </tbody></table>
      <div style={{ whiteSpace: 'pre-line', textAlign: 'justify', marginTop: '6mm' }}>{String(d.text ?? '')}</div>
      {revs.length > 0 && <>
        <h3 style={{ fontSize: '10.5pt', margin: '8mm 0 2mm' }}>Историја на измени</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt' }}><thead><tr><th style={cell}>Верзија</th><th style={cell}>Датум</th><th style={cell}>Изменил</th><th style={cell}>Опис на измената</th></tr></thead>
          <tbody>{revs.map((x, i) => <tr key={i}><td style={cell}>{x.v}</td><td style={cell}>{dmy(x.on)}</td><td style={cell}>{U.find((y) => y.id === x.by)?.name ?? ''}</td><td style={cell}>{x.note ?? (i === 0 ? 'прва верзија' : '')}</td></tr>)}</tbody></table>
      </>}
      <table style={{ width: '100%', marginTop: '14mm', fontSize: '10pt' }}><tbody><tr>
        <td>Изработил: ______________________</td><td style={{ textAlign: 'right' }}>Одобрил: ______________________</td>
      </tr></tbody></table>
    </div>
  );
}
