/** Legacy `VIEWS.periodicni` … **13597** — recurring invoices (monthly service fees, rent …), issued as drafts. */
import Link from 'next/link';
import { and, asc, desc, eq } from 'drizzle-orm';
import { r2 } from '@wise/core';
import { REC_EVERY, REC_EVERY_LBL, recIsDue, type RecEvery } from '@wise/core/office';
import { firmDocs, partners, recurringInvoices } from '@wise/db';
import { partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { officePage, today } from '@/lib/office';
import { fmt } from '@/lib/fmt';
import { ActionForm } from '@/components/action-form';
import { Pill } from '@/components/file-chips';
import { Hd, dmy } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deleteRecurring, importRecurringAction, runRecurring, saveRecurring } from './actions';
import { oxTemplate, REC_IMPORT } from '@wise/core/industry';
import { XlsxImport } from '@/components/list-tools';

const total = (items: { qty: number; price: number; vat: number }[]) => r2(items.reduce((a, l) => a + l.qty * l.price * (1 + l.vat / 100), 0));

export default async function PeriodicniPage({ searchParams }: { searchParams: Promise<{ id?: string; nov?: string; bulk?: string }> }) {
  const sp = await searchParams;
  const { firm } = await officePage('periodicni', { perm: 'office' });
  if (!firm) return <NoFirm t="🔁 Периодични фактури" />;
  const td = today();
  const [L, P, drafts] = await Promise.all([
    db().select({ r: recurringInvoices, partner: partners.name }).from(recurringInvoices).innerJoin(partners, eq(partners.id, recurringInvoices.partnerId))
      .where(eq(recurringInvoices.firmId, firm.id)).orderBy(asc(partners.name)),
    partnerOptions(firm.id),
    db().select().from(firmDocs).where(and(eq(firmDocs.firmId, firm.id), eq(firmDocs.type, 'invoice_draft'))).orderBy(desc(firmDocs.createdAt)).limit(20),
  ]);
  const e = sp.id ? L.find((x) => x.r.id === sp.id)?.r : undefined;
  const items = [...(e?.items ?? []), ...Array(5).fill(null)].slice(0, Math.max(3, (e?.items.length ?? 0) + 1)) as ({ name: string; qty: number; price: number; vat: number; unit?: string } | null)[];
  const due = L.filter(({ r }) => recIsDue({ ...r, every: r.every as RecEvery, day: r.day === 'L' ? 'L' : Number(r.day) }, td));
  return (
    <>
      <Hd t="🔁 Периодични фактури" sub={`${firm.name} · ${L.length} дефиниции · ${due.length} за издавање`}>
        <Link className="btn pri" href="/periodicni?nov">+ Нова</Link>
        <Link className="btn" href="/periodicni?nov&bulk">👥 За повеќе комитенти</Link>
        <RowAction className="btn" action={runRecurring} label={`🧾 Издади доспеани (${due.length})`} />
      </Hd>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}><XlsxImport action={importRecurringAction} template={oxTemplate(REC_IMPORT, [['Купувач ДОО', '4030000000000', 'месечно', '1', '01.11.2026', '', 15, 'Сметководствени услуги за {месец}', 'Сметководствени услуги', 1, 6000, 18, 'да']])} templateName="Periodicni_obrazec.xlsx" label="📥 Периодични од Excel" /></div>
      {(sp.nov !== undefined || e) && (
        <ActionForm action={saveRecurring} reset={false}>
          <h2>{e ? 'Измена' : sp.bulk !== undefined ? '🔁 Месечна фактура за повеќе комитенти' : 'Нова периодична фактура'}</h2>
          {e && <input type="hidden" name="id" value={e.id} />}
          <div className="form">
            {sp.bulk === undefined && <label className="f">Купувач<select name="partnerId" defaultValue={e?.partnerId ?? ''} required><option value="" disabled>— изберете —</option>{P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
            <label className="f">Период<select name="every" defaultValue={e?.every ?? 'month'}>{(Object.keys(REC_EVERY) as RecEvery[]).map((k) => <option key={k} value={k}>{REC_EVERY_LBL[k]}</option>)}</select></label>
            <label className="f">Ден во месецот<select name="day" defaultValue={e?.day ?? '1'}>{Array.from({ length: 31 }, (_, i) => <option key={i} value={String(i + 1)}>{i + 1}</option>)}<option value="L">последен работен ден</option></select></label>
            <label className="f">{e ? 'Следна фактура на' : 'Прва фактура на'}<input name="next" type="date" defaultValue={e?.next ?? ''} /></label>
            <label className="f">Заклучно со<input name="end" type="date" defaultValue={e?.end ?? ''} /></label>
            <label className="f">Рок за плаќање (дена)<input name="dueDays" type="number" min={0} defaultValue={e?.dueDays ?? 15} /></label>
            <label className="f wide">Опис на фактурата (може {'{месец}'})<input name="note" defaultValue={e?.note ?? 'Фактура за {месец}'} /></label>
            <label className="chk"><input type="checkbox" name="active" defaultChecked={e?.active ?? true} /> Активна</label>
            <label className="chk"><input type="checkbox" name="mail" defaultChecked={e?.mail ?? false} /> Прати по е-пошта</label>
          </div>
          <table className="dense"><thead><tr><th>Ставка (може „… за месец“ или „{'{месец}'}“)</th><th>Количина</th><th>Ед. мера</th><th>Цена без ДДВ</th><th>ДДВ %</th></tr></thead><tbody>
            {items.map((l, i) => (
              <tr key={i}>
                <td><input name={`it${i}_name`} defaultValue={l?.name ?? ''} /></td><td><input name={`it${i}_qty`} defaultValue={l?.qty ?? ''} style={{ width: 80 }} /></td>
                <td><input name={`it${i}_unit`} defaultValue={l?.unit ?? ''} style={{ width: 70 }} /></td><td><input name={`it${i}_price`} defaultValue={l?.price ?? ''} style={{ width: 110 }} /></td>
                <td><select name={`it${i}_vat`} defaultValue={String(l?.vat ?? 18)}>{['18', '10', '5', '0'].map((v) => <option key={v}>{v}</option>)}</select></td>
              </tr>
            ))}
          </tbody></table>
          {sp.bulk !== undefined && !e && (
            <div className="tw" style={{ maxHeight: 320, overflow: 'auto', marginTop: 8 }}><table className="dense">
              <thead><tr><th></th><th>Комитент</th><th className="n">Своја цена</th></tr></thead>
              <tbody>{P.map((p) => <tr key={p.id}><td><input type="checkbox" name="bulkP" value={p.id} /></td><td>{p.name}</td><td className="n"><input name={`own_${p.id}`} inputMode="decimal" placeholder="од ставката" style={{ width: 110 }} /></td></tr>)}</tbody>
            </table></div>
          )}
          <div className="row savebar"><button className="btn pri">Зачувај</button><Link className="btn" href="/periodicni">Затвори</Link></div>
        </ActionForm>
      )}
      {L.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Купувач</th><th>Период</th><th>Ден</th><th>Следна</th><th className="n">Износ</th><th>Последна издадена</th><th>Статус</th><th></th></tr></thead>
          <tbody>{L.map(({ r, partner }) => (
            <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
              <td><b>{partner}</b><div className="mini" style={{ display: 'block' }}>{r.items.map((i) => i.name).join(', ')}</div></td>
              <td>{REC_EVERY_LBL[r.every as RecEvery] ?? r.every}</td><td>{r.day === 'L' ? 'посл. раб.' : r.day}</td>
              <td style={r.active && r.next && r.next <= td ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{dmy(r.next)}</td>
              <td className="n">{fmt(total(r.items))}</td><td>{dmy(r.last)}</td>
              <td>{r.active ? <Pill c="good">активна</Pill> : <Pill>неактивна</Pill>}{r.mail && ' ✉'}</td>
              <td style={{ whiteSpace: 'nowrap' }}><Link className="btn sm" href={`/periodicni?id=${r.id}`}>Измени</Link> <RowAction action={deleteRecurring.bind(null, r.id)} label="✕" confirm="Да се избрише дефиницијата?" /></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <div className="card empty">Нема периодични фактури.</div>}
      {drafts.length > 0 && (
        <div className="card"><h2 style={{ fontSize: 15 }}>Издадени нацрт-фактури</h2>
          <p className="note">Нацртите се претвораат во фактури (број, книжење) во модулот Излезни фактури.</p>
          <table className="dense"><tbody>{drafts.map((d) => {
            const x = d.data as { note?: string; due?: string; items?: { qty: number; price: number; vat: number }[] };
            return <tr key={d.id}><td>{dmy(d.date)}</td><td>{x.note}</td><td>валута {dmy(x.due)}</td><td className="n">{fmt(total(x.items ?? []))}</td><td><Pill c="info">{d.status}</Pill></td></tr>;
          })}</tbody></table></div>
      )}
    </>
  );
}
