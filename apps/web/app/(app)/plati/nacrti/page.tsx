/**
 * P36 „📝 Плати – нацрти“ (UX Phase 3): the payroll runs the scheduled job prepared as DRAFTS for every firm — copies of
 * the previous month (employees, hours by the calendar, parameters). Gross / net next to the previous month, the
 * differences highlighted. Nothing is posted until „Прокнижи ги избраните“; a draft can be opened and changed on
 * Плата like any run. Under `plati`: a 🔒 book-only colleague with Плата sees the drafts of the firms he works on.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can } from '@wise/core';
import { AUTO_META, payDiffFlag } from '@wise/core/office/automations';
import { autoLastRun, payDraftRows } from '@wise/db';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { MK_MONTHS } from '@/lib/payroll/html';
import { allowedFirms, officePage } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { AutoStatus } from '@/components/auto-status';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { Hd } from '@/components/hd';
import { SelectAll } from '@/components/select-all';
import { PickFirm } from '../../lawrep/pick-firm';
import { postSelectedPayDrafts } from './actions';

const mon = (m: string) => `${MK_MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
const n = (v: unknown) => Number(v) || 0;

function Delta({ cur, prev }: { cur: number; prev: number | null }) {
  if (prev == null) return <span className="mini">—</span>;
  const d = cur - prev;
  return <span className={payDiffFlag(cur, prev) ? 'pill warn' : 'mini'} title="Разлика во однос на претходниот месец">{d > 0 ? '+' : ''}{fmt(d)}</span>;
}

export default async function PayDraftsPage() {
  const { u } = await officePage('plati');
  if (u.role === 'klient' || u.role === 'teren') notFound();
  const F = await allowedFirms(u, { year: 'all' });
  const [R, last] = await Promise.all([payDraftRows(db(), F.map((f) => f.id)), autoLastRun(db(), 'payroll').catch(() => null)]);
  const rows = R.filter((x) => x.run?.status === 'draft').map((x) => ({ ...x, f: F.find((f) => f.id === x.d.firmId)! })).filter((x) => x.f)
    .sort((a, b) => a.d.period.localeCompare(b.d.period) || a.f.name.localeCompare(b.f.name, 'mk'));
  return (
    <>
      <Hd t="📝 Плати – нацрти" sub={`${rows.length} пресметки чекаат потврда`}>
        <AutoStatus label="Подготвено автоматски" at={last?.at} when={AUTO_META.payroll.when} />
        <Link className="btn" href="/plati">Плата</Link>
      </Hd>
      <p className="note">Програмата ги подготви платите како <b>нацрт</b> – копија од претходниот месец (вработени, плати и постојани задршки; часовите според календарот). <b>Ништо не е книжено.</b> Проверете ги разликите (обоени) – отворете ја фирмата и сменете ја пресметката ако треба – потоа штиклирајте и „Прокнижи ги избраните“. Прокнижуваат само штиклираните; заклучен период, отворени известувања за промени или веќе книжен МПИН се одбиваат.</p>
      {last?.summary && <p className="mini">Последно: {last.summary}</p>}
      {rows.length ? (
        <ActionForm action={postSelectedPayDrafts} reset={false} className="card tw">
          <table className="dense">
            <thead><tr><th><SelectAll name="id" /></th><th>Фирма</th><th>Месец</th><th className="n">Вработени</th><th className="n">Бруто</th><th className="n">Δ бруто</th><th className="n">Нето</th><th className="n">Δ нето</th><th>Претходен месец</th><th /></tr></thead>
            <tbody>{rows.map(({ d, f }) => {
              const P = (d.data.prev ?? null) as { gross?: number; net?: number; emps?: number } | null;
              const pe = P ? n(P.emps) : null;
              const ok = can(u.principal, 'savePay2', f.id);
              return (
                <tr key={d.id}>
                  <td>{ok && <input type="checkbox" name="id" value={d.id} aria-label={`Означи ${f.name}`} />}</td>
                  <td><b>{f.name}</b></td>
                  <td>{mon(d.period)}</td>
                  <td className="n">{n(d.data.emps)}{pe != null && pe !== n(d.data.emps) && <> <span className="pill warn" title="Различен број вработени од претходниот месец">претх. {pe}</span></>}</td>
                  <td className="n">{fmt(n(d.data.gross))}</td>
                  <td className="n"><Delta cur={n(d.data.gross)} prev={P ? n(P.gross) : null} /></td>
                  <td className="n"><b>{fmt(n(d.data.net))}</b></td>
                  <td className="n"><Delta cur={n(d.data.net)} prev={P ? n(P.net) : null} /></td>
                  <td className="mini">{d.data.prevMonth ? `${mon(String(d.data.prevMonth))}: бруто ${fmt(n(P?.gross))} · нето ${fmt(n(P?.net))}` : '—'}</td>
                  <td><PickFirm id={f.id} to={`/plati/${d.period}`} label="Отвори" /></td>
                </tr>
              );
            })}</tbody>
          </table>
          <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
            <ConfirmSubmit confirm={'Да се прокнижат {n} означени пресметки на плата?\n\nСе книжи налог за секоја фирма. Неозначените остануваат нацрт.'}>✅ Прокнижи ги избраните</ConfirmSubmit>
          </div>
        </ActionForm>
      ) : <div className="card empty">Нема нацрти што чекаат. {u.role === 'admin' && <>Автоматизацијата се вклучува во <Link href="/avtomatizacii">⚙ Автоматизации</Link>.</>}</div>}
    </>
  );
}
