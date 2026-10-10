/**
 * Legacy `VIEWS.zsDos` (11132) + `zyCard` — Досие – годишни сметки по години: for each year the generated files (XML,
 * balance sheet, income statement, notes, ДБ) and the official confirmations (ЦРМ, УЈП); a year is complete when all
 * are there. Files can be ticked and sent by e-mail.
 * Gap: legacy `zyGen` (render and save every generated file in one click) — here each one is made in its own
 * print / export screen (links per row) and uploaded; „Во пакет за банка“ is not ported.
 */
import Link from 'next/link';
import { and, eq, inArray } from 'drizzle-orm';
import { can } from '@wise/core';
import { ZY_ROLES, ZY_SOURCE, zyComplete, zyNeed } from '@wise/core/firms/zsdos';
import { fileLinks, files, firmEntity, YE_DOSSIER_ENTITY } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { ActionForm } from '@/components/action-form';
import { Hd, dmy } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { mailYearDocs, unlinkYearDoc, uploadYearDocs } from './actions';

export default async function ZsDosPage() {
  const { u, firm, year } = await booksPage('zsDos');
  if (!firm) return <NoFirm t="Досие – годишни сметки по години" />;
  const ent = firmEntity(firm);
  const need = zyNeed(ent);
  const yrs = Array.from({ length: 13 }, (_, i) => year - i);
  const L = await db().select({ key: fileLinks.entityId, role: fileLinks.role, id: files.id, name: files.name, at: files.createdAt })
    .from(fileLinks).innerJoin(files, eq(files.id, fileLinks.fileId))
    .where(and(eq(fileLinks.entityType, YE_DOSSIER_ENTITY), inArray(fileLinks.entityId, yrs.map((y) => `${firm.id}:${y}`))));
  const byY = new Map<number, typeof L>();
  for (const r of L) { const y = +r.key.split(':')[1]!; byY.set(y, [...(byY.get(y) ?? []), r]); }
  const write = can(u.principal, 'write', firm.id), del = can(u.principal, 'del', firm.id);
  return (
    <>
      <Hd t="Досие – годишни сметки по години" sub={firm.name}>
        <Link className="btn" href="/zsProc">📋 Завршна сметка</Link>
        <Link className="btn" href="/zsRok">📅 Рокови</Link>
      </Hd>
      <div className="callout">За тековната година генерираните датотеки (XML, биланси, белешки{ent === 'co' ? ', ДБ' : ''}) ги изработувате во нивните екрани и ги прикачувате тука; кога ќе стигне официјалната сметка од ЦРМ (и потврдата од УЈП), прикачете ја – годината станува комплетна. За минатите години прикачете ги PDF-ите што ги имате.</div>
      {write && L.length > 0 && (
        <ActionForm action={mailYearDocs} reset={false} style={{ position: 'sticky', top: 0, zIndex: 3 }}>
          <b>✉ Испрати ги штиклираните датотеки</b>
          <div className="form">
            <label className="f">До<input name="to" type="email" defaultValue={firm.email ?? ''} required /></label>
            <label className="f">Наслов<input name="subject" defaultValue={`Годишна сметка – ${firm.name}`} /></label>
            <label className="f wide">Порака<textarea name="body" rows={3} defaultValue={'Почитувани,\n\nВо прилог Ви ги доставуваме документите од годишната сметка.'} /></label>
          </div>
          <p className="mini" style={{ margin: 0 }}>Штиклирајте ги датотеките подолу (☑), па „Испрати“.</p>
          <div className="row"><button className="btn pri">✉ Испрати</button></div>
          {yrs.map((y) => {
            const F = byY.get(y) ?? [];
            if (!F.length) return null;
            return (
              <div key={y} className="row" style={{ gap: '4px 12px', flexWrap: 'wrap' }}>
                <b className="mini">{y}:</b>
                {F.map((o) => <label key={o.id} className="chk" style={{ margin: 0 }}><input type="checkbox" name="sel" value={o.id} /> {o.name.slice(0, 34)}</label>)}
              </div>
            );
          })}
        </ActionForm>
      )}
      {yrs.map((y) => {
        const F = byY.get(y) ?? [];
        const done = zyComplete(ent, F.map((o) => o.role));
        return (
          <details className="card" key={y} open={y === year || y === year - 1}>
            <summary style={{ cursor: 'pointer' }}><b>{y}</b> · {F.length ? F.length + ' датотеки' : 'празно'} {done && <span className="pill good">комплетна</span>}</summary>
            <div className="tw"><table className="dense">
              <thead><tr><th>Документ</th><th>Состојба</th><th></th></tr></thead>
              <tbody>
                {ZY_ROLES.filter(([r]) => need.includes(r) || r === 'oth' || F.some((o) => o.role === r)).map(([r, n, k]) => {
                  const X = F.filter((o) => o.role === r);
                  return (
                    <tr key={r}>
                      <td>{n}{k === 2 && <span className="mini"> (официјално)</span>}{ZY_SOURCE[r] && y === year && <> <Link className="btn sm ghost" href={ZY_SOURCE[r]!} target="_blank">изработи</Link></>}</td>
                      <td>{X.length ? X.map((o) => (
                        <span key={o.id} style={{ marginRight: 8 }}>
                          <a className="btn sm" href={`/api/files/${o.id}`} target="_blank" rel="noreferrer">{o.name.slice(0, 34)}</a> <span className="mini">{dmy(o.at)}</span>
                          {del && <RowAction action={unlinkYearDoc.bind(null, y, r, o.id)} label="✕" confirm={`Да се отстрани „${o.name}“ од досието за ${y}?`} />}
                        </span>
                      )) : need.includes(r) ? <span className="pill warn">недостасува</span> : <span className="mini">—</span>}</td>
                      <td />
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            {write && (
              <ActionForm action={uploadYearDocs} className="">
                <input type="hidden" name="year" value={y} />
                <div className="form">
                  <label className="f">Вид на документ<select name="role" required defaultValue="">
                    <option value="" disabled>— изберете —</option>
                    {ZY_ROLES.map(([r, n]) => <option key={r} value={r}>{n}</option>)}
                  </select></label>
                  <UploadField firmId={firm.id} accept=".pdf,image/*,.xml" label="📎 Прикачи" />
                </div>
                <button className="btn sm pri">Зачувај во досието</button>
              </ActionForm>
            )}
            <p className="mini" style={{ margin: '6px 0 0' }}>{done ? <span className="pill good">✓ Годишната сметка {y} е комплетна во досието</span> : 'Годината е комплетна кога се зачувани генерираните датотеки и се прикачени официјалните потврди.'}</p>
          </details>
        );
      })}
    </>
  );
}
