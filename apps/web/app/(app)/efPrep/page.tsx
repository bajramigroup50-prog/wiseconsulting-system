/**
 * Legacy `VIEWS.efPrep` 15215 (v499) — 🧾 е-Фактура – подготовка (сите фирми): steps, per-firm EUJP-ID / certificate /
 * status, and the buyers' data check (EDB 13 digits, address, city) for buyers invoiced this year (`efCheck`). `?run=1` checks all firms.
 */
import { OpenFirm } from '@/components/sales/open-firm';
import Link from 'next/link';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { EF_STATUS, einvoiceBuyerProblems } from '@wise/core/finance';
import { invoices, partners } from '@wise/db';
import { booksPage } from '@/lib/books';
import { currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { today } from '@/lib/finance';
import { allowedFirms } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { saveEfAction } from './actions';
import { can, efOf } from './status';

export default async function EfPrepPage({ searchParams }: { searchParams: Promise<{ run?: string; open?: string }> }) {
  const sp = await searchParams;
  const { u } = await booksPage('efPrep');
  if (u.role === 'klient') return <><Hd t="е-Фактура" /><div className="empty">Нема пристап.</div></>;
  const year = await currentYear();
  const F = await allowedFirms(u);
  const run = sp.run === '1';
  let res: Map<string, { inv: number; buyers: number; bad: { name: string; edb: string; E: string[] }[] }> = new Map();
  if (run && F.length) {
    const ids = F.map((f) => f.id);
    const yr = sql`${invoices.date} between ${year + '-01-01'} and ${year + '-12-31'}`;
    const [cnt, B] = await Promise.all([
      db().select({ f: invoices.firmId, n: sql<number>`count(*)::int` }).from(invoices)
        .where(and(inArray(invoices.firmId, ids), yr, inArray(invoices.kind, ['invoice', 'credit']), eq(invoices.status, 'posted'))).groupBy(invoices.firmId),
      db().selectDistinct({ f: invoices.firmId, id: partners.id, name: partners.name, edb: partners.edb, address: partners.address, city: partners.city, foreign: partners.foreign })
        .from(invoices).innerJoin(partners, eq(partners.id, invoices.partnerId))
        .where(and(inArray(invoices.firmId, ids), yr, isNotNull(invoices.partnerId), inArray(invoices.kind, ['invoice', 'credit']), eq(invoices.status, 'posted'))),
    ]);
    res = new Map(F.map((f) => {
      const P = B.filter((b) => b.f === f.id);
      return [f.id, { inv: cnt.find((c) => c.f === f.id)?.n ?? 0, buyers: P.length, bad: P.filter((p) => !p.foreign).map((p) => ({ name: p.name, edb: p.edb ?? '', E: einvoiceBuyerProblems(p) })).filter((x) => x.E.length) }];
    }));
  }
  const td = today();
  const tot = [...res.values()].reduce((a, r) => a + r.bad.length, 0);
  const rdy = F.filter((f) => ['ok', 'prod'].includes(efOf(f.settings).st ?? '')).length;
  const q = (o: Record<string, string>) => '/efPrep?' + new URLSearchParams({ ...(run ? { run: '1' } : {}), ...o }).toString();
  return (
    <>
      <Hd t="🧾 е-Фактура – подготовка" sub="сите фирми" />
      <div className="card"><h2 style={{ margin: '0 0 6px' }}>Чекори</h2>
        <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li><b>Канцеларијата во тест:</b> регистрација на <a href="https://eujptest.ujp.gov.mk/ureg" target="_blank" rel="noopener">eujptest.ujp.gov.mk/ureg</a> (EUJP-ID) и регистрација на сертификатот на <a href="https://efakturatest.ujp.gov.mk/certificates" target="_blank" rel="noopener">efakturatest.ujp.gov.mk/certificates</a>.</li>
          <li><b>Документација:</b> од efakturawiki.ujp.gov.mk преземете ја спецификацијата (JSON пример, API) – испратете ја за поврзување на програмата.</li>
          <li><b>Сертификат за секој клиент:</b> квалификуван (КИБС / Халком / Телеком) – токен (USB) или датотека (.p12/.pfx). Проверете важност.</li>
          <li><b>Купувачите:</b> ЕДБ (13 цифри), адреса, град и ДДВ статус мора да се точни – УЈП ги проверува (табелата долу).</li>
          <li><b>Продукција:</b> по донесување на законот – клиентите по ред, пред рокот (предлог: ДДВ обврзници од 01.04.2027).</li>
        </ol>
        <p className="mini" style={{ margin: '6px 0 0' }}>Статус на законот (04.10.2026): предлог-закон, доброволно од 01.10.2026. Роботот за законски промени секој ден проверува и ве известува.</p>
      </div>
      <div className="card"><div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <Link className="btn pri" href="/efPrep?run=1">{run ? '↻ Освежи' : '🔍 Провери ги сите фирми'}</Link>
        <span className="mini">Купувачи: само тие на кои им е издадена фактура во {year}. Странските купувачи се прескокнуваат.</span>
      </div></div>
      {run && (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '10px 0', alignItems: 'stretch' }}>
          {([['Фирми', F.length], ['ДДВ обврзници', F.filter((f) => f.vatRegistered).length], ['Подготвени (тест)', rdy], ['Купувачи со грешки', tot]] as const).map(([l, v]) => (
            <div key={l} className="card" style={{ flex: 1, minWidth: 150, margin: 0 }}><div className="muted" style={{ fontSize: 12 }}>{l}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div></div>
          ))}
        </div>
      )}
      <ActionForm action={saveEfAction} reset={false} className="card tw">
        <table className="dense">
          <thead><tr><th>Фирма</th><th>ДДВ</th>{run && <><th className="n">Фактури {year}</th><th className="n">Купувачи</th><th>Купувачи со грешки</th></>}<th>EUJP-ID</th><th>Сертификат</th><th>Статус</th></tr></thead>
          <tbody>{F.map((f) => {
            const ef = efOf(f.settings);
            const r = res.get(f.id);
            const ed = can(u.principal, 'office', f.id);
            return [
              <tr key={f.id}>
                <td style={{ minWidth: 170 }}><b>{f.name}</b><div className="mini">ЕДБ {f.edb || '—'}</div>{ed && <input type="hidden" name="fid" value={f.id} />}</td>
                <td>{f.vatRegistered ? 'да' : 'не'}</td>
                {run && <><td className="n">{r?.inv ?? 0}</td><td className="n">{r?.buyers ?? 0}</td>
                  <td>{r?.bad.length ? <Link className="btn sm ghost" style={{ color: 'var(--bad)' }} href={q(sp.open === f.id ? {} : { open: f.id })}>⚠ {r.bad.length} {sp.open === f.id ? '▲' : '▼'}</Link> : r?.buyers ? <span className="pill good">✓</span> : null}</td></>}
                <td><input name={'efId_' + f.id} defaultValue={ef.id ?? ''} placeholder="EUJP-ID" style={{ width: 120 }} disabled={!ed} /></td>
                <td><select name={'efCert_' + f.id} defaultValue={ef.cert ?? ''} style={{ width: 'auto' }} disabled={!ed}>
                  {[['', '—'], ['token', 'Токен (USB)'], ['p12', 'Датотека .p12'], ['none', 'Нема']].map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                </select><input name={'efCertTo_' + f.id} type="date" defaultValue={ef.certTo ?? ''} title="Сертификатот важи до" style={{ width: 'auto', marginLeft: 4 }} disabled={!ed} />
                  {ef.certTo && ef.certTo < td && <span className="pill bad">истечен</span>}</td>
                <td><select name={'efSt_' + f.id} defaultValue={ef.st ?? 'no'} style={{ width: 'auto' }} disabled={!ed}>
                  {Object.entries(EF_STATUS).map(([k, [n]]) => <option key={k} value={k}>{n}</option>)}
                </select></td>
              </tr>,
              run && sp.open === f.id && r?.bad.length ? (
                <tr key={f.id + '-bad'}><td colSpan={8} style={{ background: 'var(--panel)' }}>
                  <b>Купувачи за поправка – {f.name}</b> <OpenFirm id={f.id} href="/partneri" label="✎ Отвори партнери" />
                  <table className="dense"><tbody>{r.bad.map((x, i) => <tr key={i}><td>{x.name}</td><td>{x.edb}</td><td style={{ color: 'var(--bad)' }}>{x.E.join(', ')}</td></tr>)}</tbody></table>
                </td></tr>
              ) : null,
            ];
          })}</tbody>
        </table>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button className="btn pri">Зачувај</button></div>
      </ActionForm>
    </>
  );
}
