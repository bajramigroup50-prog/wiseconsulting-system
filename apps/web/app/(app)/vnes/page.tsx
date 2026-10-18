/**
 * Финансово › „📋 Преглед на внес по месеци“ — for every month of the working year: booked outgoing / incoming invoices,
 * read (scanned) invoices not saved yet, journals imported from the old program with their VAT, bank statements per
 * account, and what to look at: possible double entry (invoices + imported VAT in one month), unsaved reads, a month
 * without a statement, a month without sales (`@wise/db` `entryOverview`).
 */
import Link from 'next/link';
import { entryOverview, type EntryMonth } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

const MONTHS = ['јануари', 'февруари', 'март', 'април', 'мај', 'јуни', 'јули', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const WARN: Record<EntryMonth['warn'][number], string> = {
  dupOut: 'Можно двојно: има книжени излезни фактури И увезен налог со излезен ДДВ',
  dupIn: 'Можно двојно: има книжени влезни фактури И увезен налог со претходен ДДВ',
  scans: 'Скенирани фактури што не се зачувани (спремни / за проверка / задржани)',
  bankGap: 'Нема извод за сметка што има изводи во претходните месеци (месецот е поминат или е меѓу два со изводи)',
  noSales: 'Нема излезни фактури ниту увезен излезен ДДВ (а подоцнежните месеци имаат)',
};

const scanCell = (s: EntryMonth['scanSales'], href: string) => {
  const n = s.ready + s.check + s.held;
  if (!n) return <span className="mut">—</span>;
  return <Link href={href} title={`спремни ${s.ready} · за проверка ${s.check} · задржани (минат период) ${s.held}`}>
    <span className="pill warn">{n} незачувани</span><div className="mini">{[s.ready && `${s.ready} спремни`, s.check && `${s.check} провери`, s.held && `${s.held} ⏸`].filter(Boolean).join(' · ')}</div>
  </Link>;
};

export default async function VnesPage() {
  const { firm, year } = await booksPage('vnes');
  if (!firm) return <NoFirm t="Преглед на внес по месеци" />;
  const O = await db().transaction((tx) => entryOverview(tx, firm, year));
  const M = O.months;
  const now = new Date().toISOString().slice(0, 7);
  const sum = (f: (x: EntryMonth) => number) => M.reduce((s, x) => s + f(x), 0);
  const issues = M.reduce((s, x) => s + x.warn.length, 0);
  const mm = (m: number) => String(m).padStart(2, '0');
  return (
    <>
      <Hd t="Преглед на внес по месеци" sub={`${firm.name} · ${year} – што е внесено секој месец, што фали и што може да е двојно`} />
      {O.readNotImported > 0 && <div className="callout bad">⚠ <b>{O.readNotImported} прочитани изводи не се во книгите</b> (изводот е избришан или увозот не е завршен) – <Link href="/arhiva?nal=@bank">Архива → Изводи – не се увезени</Link>; увезете ги повторно во <Link href="/banka">Банка</Link> (без нов AI).</div>}
      <div className={`callout ${issues ? 'warn' : 'good'}`}>
        {issues ? <>⚠ <b>{issues}</b> работи за проверка – видете ја колоната „Проверка“.</> : <>✓ Нема ништо за проверка.</>}
        {' '}За секој период користете <b>само еден</b> извор на фактури: или книжени фактури (скенирани / внесени), или увезен налог од старата програма – не двете.
      </div>
      {M.some((x) => x.warn.includes('scans')) && <div className="row" style={{ gap: 8, margin: '0 0 8px' }}>
        <Link className="btn" href="/skan/proverka?k=sale">📋 За физичка проверка – излезни</Link>
        <Link className="btn" href="/skan/proverka">📋 За физичка проверка – влезни</Link>
      </div>}
      <div className="tw"><table className="dense">
        <thead>
          <tr>
            <th rowSpan={2}>Месец</th>
            <th colSpan={3} style={{ textAlign: 'center' }}>Излезни</th>
            <th colSpan={3} style={{ textAlign: 'center' }}>Влезни</th>
            <th colSpan={2} style={{ textAlign: 'center' }}>Увезени налози (стара програма)</th>
            {O.accounts.length > 0 && <th colSpan={O.accounts.length} style={{ textAlign: 'center' }}>Изводи</th>}
            <th rowSpan={2}>Проверка</th>
          </tr>
          <tr>
            <th className="n">Фактури</th><th className="n">ДДВ</th><th>Скенирани</th>
            <th className="n">Фактури</th><th className="n">ДДВ</th><th>Скенирани</th>
            <th className="n">Налози</th><th className="n">ДДВ излез / влез</th>
            {O.accounts.map((a) => <th key={a.id} className="n" title={a.name}>{a.name.length > 14 ? a.name.slice(0, 13) + '…' : a.name}</th>)}
          </tr>
        </thead>
        <tbody>{M.map((x) => {
          const future = `${year}-${mm(x.m)}` > now;
          return (
            <tr key={x.m} style={future ? { opacity: 0.55 } : x.warn.length ? { background: 'var(--warn-soft, #fff8e6)' } : undefined}>
              <td><b>{mm(x.m)}</b> {MONTHS[x.m - 1]}</td>
              <td className="n">{x.sales.n ? <Link href={`/izlez?m=${mm(x.m)}`}>{x.sales.n}</Link> : <span className="mut">0</span>}</td>
              <td className="n">{x.sales.vat ? fmt(x.sales.vat) : ''}</td>
              <td>{scanCell(x.scanSales, '/skan/proverka?k=sale')}</td>
              <td className="n">{x.purchases.n ? <Link href="/vlez">{x.purchases.n}</Link> : <span className="mut">0</span>}</td>
              <td className="n">{x.purchases.vat ? fmt(x.purchases.vat) : ''}</td>
              <td>{scanCell(x.scanPurchases, '/skan/proverka')}</td>
              <td className="n">{x.imported.n ? <Link href="/nalozi">{x.imported.n}</Link> : <span className="mut">0</span>}</td>
              <td className="n">{x.imported.outVat || x.imported.inVat ? `${fmt(x.imported.outVat)} / ${fmt(x.imported.inVat)}` : ''}</td>
              {O.accounts.map((a) => <td key={a.id} className="n">{x.bank[a.id] ? <Link href="/banka">{x.bank[a.id]}</Link> : <span className="mut">0</span>}</td>)}
              <td>{x.warn.length ? x.warn.map((w) => <div key={w} className="mini">⚠ {WARN[w]}</div>) : future ? '' : <span className="pill good">✓</span>}</td>
            </tr>
          );
        })}</tbody>
        <tfoot><tr>
          <td>Вкупно {year}</td>
          <td className="n">{sum((x) => x.sales.n)}</td><td className="n">{fmt(sum((x) => x.sales.vat))}</td><td />
          <td className="n">{sum((x) => x.purchases.n)}</td><td className="n">{fmt(sum((x) => x.purchases.vat))}</td><td />
          <td className="n">{sum((x) => x.imported.n)}</td><td className="n">{fmt(sum((x) => x.imported.outVat))} / {fmt(sum((x) => x.imported.inVat))}</td>
          {O.accounts.map((a) => <td key={a.id} className="n">{sum((x) => x.bank[a.id] ?? 0)}</td>)}
          <td />
        </tr></tfoot>
      </table></div>
      <p className="note">„Скенирани“ = прочитани фактури што уште не се зачувани (по датумот на фактурата). „Увезени налози“ = налози увезени од старата програма; ДДВ излез = побарува на излезните ДДВ конта, влез = должи на влезните. Изводи = број на изводи во месецот по сметка.</p>
    </>
  );
}
