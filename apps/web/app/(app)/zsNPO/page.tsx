/**
 * Legacy `VIEWS.zsNPO` 10463 (+ `npoCompute`, `npoTable`, `npoIzj`, ACT `npoClose`/`npoUnclose`) — Годишна сметка –
 * непрофитни организации (Сл. весник 117/05), tabs: Биланс на приходи и расходи / Биланс на состојба (with the
 * previous year) / ДБ-НП/ВП (rows 01–08) / Мала НПО (книга на приходи и расходи, книга за благајна, изјава за ЦРМ) /
 * Сметковен план и затворање. The close is the common year close (`/mbyllja`, NPO scheme).
 * FIX(P8 #12): the screen is shown by entity type (`yeEntityOf`), not by "the chart contains 730".
 * „Примени сметковен план и шеми за НПО“ (`npoPlan`) adds the three-digit NPO chart and schemes.
 */
import Link from 'next/link';
import { NPO_BS, NPO_PR } from '@wise/core';
import { NPO_ACC } from '@wise/core/yearend/npo';
import { canDo } from '@/lib/books';
import { RowAction } from '@/components/row-action';
import { npoPlanAction } from './actions';
import { cashBook, npoDbRows, npoIncomeBook, npoSmall } from '@wise/core/yearend/books';
import { loadYear } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { accountNames, phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { PdfButton } from '@/components/pdf-button';
import { XlsxButton } from '@/components/vp-tools';
import { NpoDbTable, NpoTable } from '@/components/yearend/entity-tables';
import { NotClosedNote, ZsHead } from '@/components/yearend/ph-bar';

const TABS = [['pr', 'Биланс на приходи и расходи'], ['bs', 'Биланс на состојба'], ['db', 'ДБ-НП/ВП (данок)'], ['small', 'Мала НПО (под 2.500 €)'], ['plan', 'Сметковен план и затворање']] as const;
type Tab = (typeof TABS)[number][0];
const EUR = 61.5;

export default async function ZsNpoPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const sp = await searchParams;
  const c = await yePage('zsNPO', 'zsNPO');
  if (!c) return <NoFirm t="Годишна сметка – НПО" />;
  const { L, firm, year } = c;
  const N = L.Y.npo!;
  const T: Tab = (TABS.some(([k]) => k === sp.t) ? sp.t : 'pr') as Tab;
  const P = T === 'pr' || T === 'bs' ? (await loadYear(db(), firm.id, year - 1).catch(() => null))?.Y.npo?.V ?? null : null;
  const co = L.Y.npoChart !== 'npo';
  const canSet = canDo(c.u, 'settings', firm.id);
  const small = npoSmall(N.inc, N.V['042'] || 0, EUR);
  const names = T === 'small' ? await accountNames(firm.id) : {};
  const IB = T === 'small' ? npoIncomeBook(L.lines, names) : [];
  const CB = T === 'small' ? cashBook(L.lines) : [];
  return (
    <>
      <ZsHead id="zsNPO" t="Годишна сметка – непрофитна организација" year={year} ent={L.ent} done={phaseDone(L)}>
        <Link className="btn" href="/zsRok">📅 Каде и кога се поднесува</Link>
        {(T === 'pr' || T === 'bs') && <Link className="btn pri" href="/pecati/npo" target="_blank">🖨 PDF (образец)</Link>}
      </ZsHead>
      {L.ent !== 'npo' && <div className="callout warn">Фирмата не е означена како непрофитна организација. Поставете го видот во „🧩 Модули по дејност“.</div>}
      <NotClosedNote closed={L.Y.closed} year={year} />
      <div className="ftabs" style={{ marginBottom: 10 }}>{TABS.map(([k, n]) => <Link key={k} className={`btn sm${k === T ? ' pri' : ''}`} href={`/zsNPO?t=${k}`}>{n}</Link>)}</div>
      {T === 'pr' && (
        <div className="card">
          <NpoTable R={NPO_PR} V={N.V} P={P} year={year} />
          <p className="note">Контрола: 239 = {fmt(N.V['239'])} · 252 = {fmt(N.V['252'])} {Math.abs((N.V['239'] || 0) - (N.V['252'] || 0)) < 0.01 ? <span className="pill good">се совпаѓаат</span> : <span className="pill bad">разлика</span>}</p>
        </div>
      )}
      {T === 'bs' && (
        <div className="card">
          <NpoTable R={NPO_BS} V={N.V} P={P} year={year} />
          <p className="note">{Math.abs((N.V['042'] || 0) - (N.V['069'] || 0)) < 0.01 ? <span className="pill good">Актива = Пасива</span> : <span className="pill bad">Актива {fmt(N.V['042'])} ≠ Пасива {fmt(N.V['069'])} – разлика {fmt((N.V['042'] || 0) - (N.V['069'] || 0))}</span>}{N.closed ? '' : ' · годината не е затворена: тековниот вишок е прикажан во 067 (недостигот во 037).'}</p>
        </div>
      )}
      {T === 'db' && <div className="card"><NpoDbTable N={N} rows={npoDbRows(L.Y.co.balances.pre, co)} /></div>}
      {T === 'small' && (
        <>
          <div className={`callout${small ? '' : ' warn'}`}>{small
            ? <>✓ Вкупниот приход ({fmt(N.inc)}) и имотот се под 2.500 € (~{fmt(2500 * EUR)} ден.) – организацијата <b>не мора да води двојно книговодство ниту да составува финансиски извештаи</b>; води книга за благајна и книга на приходи и расходи и до ЦРМ доставува изјава/одлука.</>
            : <>Приходот или имотот се над 2.500 € (~{fmt(2500 * EUR)} ден.) – задолжителна е целосна годишна сметка (биланс на состојба, биланс на приходи и расходи и белешки).</>}</div>
          <div className="card" id="npoIB">
            <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>Книга на приходи и расходи {year}</h2><div className="row">
              <PdfButton selector="#npoIB" title={`Kniga_prihodi_rashodi_${year}`} className="btn sm" />
              <XlsxButton className="btn sm" name={`Kniga_prihodi_rashodi_${year}.xlsx`} sheets={[{ name: 'Приходи и расходи', rows: [['Р.бр', 'Датум', 'Документ', 'Опис', 'Приход', 'Расход'], ...IB.map((r) => [r.no, r.date, r.doc, r.text, r.inc || '', r.exp || ''])] }]} />
            </div></div>
            <div className="tw"><table className="dense"><thead><tr><th>Р.бр</th><th>Датум</th><th>Документ</th><th>Опис</th><th className="n">Приход</th><th className="n">Расход</th></tr></thead>
              <tbody>{IB.map((r) => <tr key={r.no}><td>{r.no}</td><td>{dmy(r.date)}</td><td>{r.doc}</td><td>{r.text}</td><td className="n">{r.inc ? fmt(r.inc) : ''}</td><td className="n">{r.exp ? fmt(r.exp) : ''}</td></tr>)}
                <tr className="tot"><td colSpan={4}>Вкупно</td><td className="n">{fmt(N.inc)}</td><td className="n">{fmt(N.exp)}</td></tr></tbody></table></div>
          </div>
          <div className="card" id="npoCB">
            <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>Книга за благајна {year}</h2><div className="row">
              <PdfButton selector="#npoCB" title={`Kniga_blagajna_${year}`} className="btn sm" />
              <XlsxButton className="btn sm" name={`Kniga_blagajna_${year}.xlsx`} sheets={[{ name: 'Благајна', rows: [['Датум', 'Документ', 'Опис', 'Влез', 'Излез', 'Салдо'], ...CB.map((r) => [r.date, r.doc, r.text, r.inn || '', r.out || '', r.bal])] }]} />
            </div></div>
            <div className="tw"><table className="dense"><thead><tr><th>Датум</th><th>Документ</th><th>Опис</th><th className="n">Влез</th><th className="n">Излез</th><th className="n">Салдо</th></tr></thead>
              <tbody>{CB.length ? CB.map((r, i) => <tr key={i}><td>{dmy(r.date)}</td><td>{r.doc}</td><td>{r.text}</td><td className="n">{r.inn ? fmt(r.inn) : ''}</td><td className="n">{r.out ? fmt(r.out) : ''}</td><td className="n">{fmt(r.bal)}</td></tr>)
                : <tr><td colSpan={6} className="note">Нема готовински промет.</td></tr>}</tbody></table></div>
          </div>
          <div className="row" style={{ gap: 8 }}><PdfButton selector="#npoIzj .pdfdoc" title={`Izjava_NPO_${year}`} className="btn pri" /><span className="note">🖨 Изјава за ЦРМ (под 2.500 €)</span></div>
          <div className="card" id="npoIzj"><div className="pdfdoc">
            <h2 style={{ textAlign: 'center' }}>ИЗЈАВА</h2><p style={{ textAlign: 'center' }}>за {year} година</p>
            <p style={{ fontSize: '12pt', lineHeight: 1.7, textAlign: 'justify' }}>Јас, долупотпишаниот/ата ____________________, како овластено лице за застапување на <b>{firm.name}</b>, ЕДБ {firm.edb}, ЕМБС {firm.embs}, со седиште на {[firm.address, firm.city].filter(Boolean).join(', ')}, изјавувам дека вкупната вредност на имотот и вкупниот годишен приход на организацијата во {year} година се помали од 2.500 евра во денарска противвредност (вкупен приход: {fmt(N.inc)} денари), поради што согласно Законот за сметководството на непрофитните организации организацијата не составува финансиски извештаи и води книга за благајната и книга на приходи и расходи.</p>
            <p style={{ marginTop: 40 }}>Место и датум: {firm.city}, __________</p>
            <p style={{ marginTop: 40, textAlign: 'right' }}>______________________________<br />Овластено лице (потпис и печат)</p>
          </div></div>
        </>
      )}
      {T === 'plan' && (
        <>
          <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Контен план</h2>
            <p style={{ margin: '0 0 8px' }}>{co ? <>✓ Се користи <b>вашиот контен план</b> (истите конта како кај фирмите, вклучително 715 приходи од услуги на здружение, 767/7690 донации и членарини, 443 донации, 296/298, 815, 826) – контата автоматски се распоредуваат во позициите на билансите за НПО.</> : 'Се користи трицифрениот сметковен план за НПО.'}</p>
            <p className="note" style={{ margin: '0 0 8px' }}><b>Опционално:</b> Сметковен план и биланси според Правилникот за сметковниот план и билансите на непрофитните организации (Сл. весник 117/05, 11/06). „Примени“ ги додава трицифрените конта на НПО во контниот план на фирмата и ги поставува шемите за автоматско книжење (купувачи 120, добавувачи 220, благајна 101, приходи 710/715, плати 460/28…). Банковната сметка во изводите поставете ја на 100.</p>
            {!co && <span className="pill good">Применет</span>}{' '}
            {canSet && <RowAction className={`btn${co ? ' pri' : ''}`} action={npoPlanAction} label={co ? 'Примени сметковен план и шеми за НПО' : 'Примени повторно'}
              confirm={`Да се додадат контата на НПО (${NPO_ACC.length}) во контниот план на фирмата и да се постават шемите за книжење за НПО? Постојните книжења не се менуваат.`} />}
          </div>
          <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Затворање на годината {year} (НПО)</h2>
            <p className="note" style={{ margin: '0 0 8px' }}>Расходите (класа 4) и приходите (класа 7) се пренесуваат на 800; данокот од стопанска дејност (ако има) на 810; нетовишокот на {co ? '951' : '970'}, а недостигот на {co ? '961' : '092'}. Шемата е стандардна пракса – проверете ја распределбата на вишокот со одлука на органот на организацијата.</p>
            <div className="mini">Приходи {fmt(N.inc)} · Расходи {fmt(N.exp)} · {N.sur >= 0 ? 'Вишок' : 'Недостиг'} {fmt(Math.abs(N.sur))}{N.tax ? ' · Данок ' + fmt(N.tax) : ''}</div>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>{N.closed ? <span className="pill good">Годината е затворена</span> : null}<Link className="btn pri" href="/mbyllja">{N.closed ? 'Затворање (отвори повторно)' : 'Затвори ја годината'}</Link></div>
          </div>
        </>
      )}
      {N.un.length > 0 && <div className="callout warn">Конта со салдо што не се распоредени во образците: {N.un.slice(0, 12).map((x) => `${x.k} (${fmt(x.s)})`).join(', ')}{N.un.length > 12 ? ' …' : ''}</div>}
    </>
  );
}
