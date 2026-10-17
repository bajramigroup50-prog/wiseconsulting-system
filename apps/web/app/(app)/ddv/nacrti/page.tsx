/**
 * P37 „🧾 ДДВ-04 – нацрти“ (UX Phase 3): after a VAT period ends the scheduled job computes the return of every VAT firm
 * from the books (the existing ДДВ-04 computation) — payable / refund and the problems: books ≠ налози, invoice numbers
 * missing, purchases still in draft, open autopilot problems, client documents waiting. Closing stays a click: one firm
 * on ДДВ-04, or in bulk here for the drafts WITHOUT problems. Under `ddv`: a 🔒 book-only colleague with ДДВ sees the
 * drafts of the firms he works on.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can } from '@wise/core';
import { AUTO_META } from '@wise/core/office/automations';
import { autoLastRun, listDrafts, VAT_KIND } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { allowedFirms, officePage, today } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { AutoStatus } from '@/components/auto-status';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { Hd } from '@/components/hd';
import { SelectAll } from '@/components/select-all';
import { PickFirm } from '../../lawrep/pick-firm';
import { closeSelectedVatDrafts } from './actions';

const n = (v: unknown) => Number(v) || 0;

export default async function VatDraftsPage() {
  const { u } = await officePage('ddv');
  if (u.role === 'klient' || u.role === 'teren') notFound();
  const F = await allowedFirms(u, { year: 'all' });
  const [D, last] = await Promise.all([listDrafts(db(), { kind: VAT_KIND, firmIds: F.map((f) => f.id) }), autoLastRun(db(), 'vat').catch(() => null)]);
  const td = today();
  const rows = D.map((d) => ({ d, f: F.find((f) => f.id === d.firmId)! })).filter((x) => x.f)
    .sort((a, b) => Number(a.d.problems.length > 0) - Number(b.d.problems.length > 0) || a.f.name.localeCompare(b.f.name, 'mk'));
  const clean = rows.filter((r) => !r.d.problems.length).length;
  return (
    <>
      <Hd t="🧾 ДДВ-04 – нацрти" sub={`${rows.length} пријави · без проблеми ${clean}`}>
        <AutoStatus label="Подготвено автоматски" at={last?.at} when={AUTO_META.vat.when} />
        <Link className="btn" href="/ddv">ДДВ-04</Link>
      </Hd>
      <p className="note">Пријавите се пресметани од книгите како <b>нацрт</b> – ништо не е книжено ниту поднесено. Пријава со проблем се средува во фирмата (ДДВ-04, влезни / излезни фактури) и се затвора таму; пријавите <b>без проблеми</b> може да се затворат заедно: секоја повторно се пресметува пред затворањето и се одбива ако нешто се сменило. Поднесувањето во е-Даноци останува рачно.</p>
      {rows.length ? (
        <ActionForm action={closeSelectedVatDrafts} reset={false} className="card tw">
          <table className="dense">
            <thead><tr><th><SelectAll name="id" /></th><th>Фирма</th><th>Период</th><th>Рок</th><th className="n">За плаќање</th><th className="n">Поврат</th><th>Проблеми</th><th /></tr></thead>
            <tbody>{rows.map(({ d, f }) => {
              const due = String(d.data.due ?? '');
              const ok = !d.problems.length && can(u.principal, 'write', f.id);
              return (
                <tr key={d.id}>
                  <td>{ok && <input type="checkbox" name="id" value={d.id} aria-label={`Означи ${f.name}`} />}</td>
                  <td><b>{f.name}</b></td>
                  <td>{String(d.data.label ?? d.period)}</td>
                  <td><span className={due && due < td ? 'pill bad' : 'mini'}>{due ? dmy(due) : ''}</span></td>
                  <td className="n">{n(d.data.payable) ? <b>{fmt(n(d.data.payable))}</b> : ''}</td>
                  <td className="n">{n(d.data.refund) ? fmt(n(d.data.refund)) : ''}</td>
                  <td className="mini">{d.problems.length ? d.problems.map((p, i) => <div key={i}>⚠ {p}</div>) : <span className="pill good">без проблеми</span>}</td>
                  <td><PickFirm id={f.id} to={`/ddv?p=${encodeURIComponent(d.period)}`} label="Отвори" /></td>
                </tr>
              );
            })}</tbody>
          </table>
          <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
            <ConfirmSubmit confirm={'Да се затворат {n} ДДВ периоди (книжење на ДДВ-04)?\n\nСекоја пријава повторно се пресметува; по затворањето документите со ДДВ од периодот не може да се менуваат додека периодот не се отвори.'}>🔒 Затвори ги избраните (без проблеми)</ConfirmSubmit>
          </div>
        </ActionForm>
      ) : <div className="card empty">Нема нацрти на ДДВ-04. {u.role === 'admin' && <>Автоматизацијата се вклучува во <Link href="/avtomatizacii">⚙ Автоматизации</Link>.</>}</div>}
    </>
  );
}
