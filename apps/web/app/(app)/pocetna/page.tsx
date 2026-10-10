/** Legacy `VIEWS.pocetna` 6319 (final chain → 13245) — Финансово › Почетна состојба. */
import Link from 'next/link';
import { and, asc, eq, sql } from 'drizzle-orm';
import { bankAccounts, effectiveChart, journalLines, journals } from '@wise/db';
import { booksPage, canDo, partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deleteOpening, transferFromPrevYear } from './actions';
import { OpeningEditor, type ORow } from './opening-editor';

export default async function PocetnaPage({ searchParams }: { searchParams: Promise<{ full?: string }> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('pocetna');
  if (!firm) return <NoFirm t="Почетна состојба" />;
  const full = sp.full === '1';
  const src = full ? { t: 'bbimp', id: `bbimp-${year}` } : { t: 'opening', id: `open-${year}` };
  const [ex] = await db().select().from(journals)
    .where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, src.t), eq(journals.sourceId, src.id))).limit(1);
  const [lines, chart, P, closed] = await Promise.all([
    ex ? db().select().from(journalLines).where(eq(journalLines.journalId, ex.id)).orderBy(asc(journalLines.lineNo)) : [],
    effectiveChart(db(), firm.id),
    partnerOptions(firm.id),
    db().select({ id: journals.id }).from(journals)
      .where(and(eq(journals.firmId, firm.id), eq(journals.kind, 'close'), sql`${journals.date} between ${year - 1 + '-01-01'} and ${year - 1 + '-12-31'}`)).limit(1),
  ]);
  const names = new Map(chart.map((a) => [a.code, a.name]));
  const rows: ORow[] = lines.map((l) => ({
    account: l.account, name: names.get(l.account) ?? '', partnerId: l.partnerId ?? '', partnerName: '', partnerCode: '',
    debit: Number(l.debit) ? String(Number(l.debit)) : '', credit: Number(l.credit) ? String(Number(l.credit)) : '', note: l.note ?? '',
  }));
  const banks = await db().select({ konto: bankAccounts.konto }).from(bankAccounts).where(eq(bankAccounts.firmId, firm.id));
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id), close = canDo(u, 'close', firm.id);

  return (
    <>
      <Hd t={full ? `Бруто биланс ${year}` : 'Почетна состојба'} sub={full ? 'за завршна сметка' : 'налог за отворање'}>
        {!full && close && (closed.length
          ? <RowAction className="btn" action={transferFromPrevYear} label={`Пренос од ${year - 1}`} confirm={`Да се пренесат салдата од ${year - 1}? Постојната почетна состојба за ${year} ќе се замени.`} />
          : <Link className="btn" href="/mbyllja" title={`Изберете ја ${year - 1} горе и затворете ја на екранот „Затворање“ (данок од ДБ), па направете пренос`}>Затвори ја {year - 1} →</Link>)}
        {ex && <Link className="btn" href={`/nalozi?n=${encodeURIComponent(ex.number)}`}>Налог {ex.number}</Link>}
        {/* legacy `openPdf` 7333: „НАЛОГ ЗА ПОЧЕТНА СОСТОЈБА“ */}
        {ex ? <a className="btn" href={`/print/nalog?n=${encodeURIComponent(ex.number)}&t=${encodeURIComponent(full ? `БРУТО БИЛАНС ${year}` : `НАЛОГ ЗА ПОЧЕТНА СОСТОЈБА на ден ${ex.date.split('-').reverse().join('.')}`)}`} target="_blank" rel="noopener">PDF</a> : <button className="btn" disabled>PDF</button>}
        {ex && del && <RowAction className="btn danger" action={deleteOpening.bind(null, full)} label="🗑 Избриши" confirm={`Да се избрише ${full ? 'увезениот бруто биланс' : 'почетната состојба'} за ${year}?`} />}
      </Hd>
      <div className="card" style={{ padding: '10px 14px', ...(full ? { border: '2px solid var(--accent)' } : {}) }}>
        <Link href={full ? '/pocetna' : '/pocetna?full=1'} style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 600, color: 'inherit', textDecoration: 'none' }}>
          <input type="checkbox" readOnly checked={full} style={{ width: 18, height: 18, flex: 'none', margin: 0 }} />
          <span>📊 Бруто биланс за ЦЕЛА {year} година – за завршна сметка</span>
        </Link>
        <p className="note" style={{ margin: '6px 0 0' }}>
          {full
            ? <>Се земаат <b>сите класи</b> (0–9, вклучително 4 расходи и 7 приходи), 951/961 остануваат како што се, и се книжи како налог „Бруто биланс {year}“ на <b>31.12.{year}</b>. Увезете го бруто билансот <b>пред затворање</b>. Почетната состојба не се менува. Не може да се увезе ако за {year} веќе има книжени документи.</>
            : 'Штиклирајте ако за оваа година (на пр. водена во друга програма) сакате да ја направите завршната сметка од нејзиниот бруто биланс.'}
        </p>
      </div>
      {!full && <div className="callout">За фирма што доаѓа од друг сметководител: внесете ги салдата од нивниот завршен бруто биланс (или биланс на состојба) на денот од кој почнувате. Побарувањата од купувачи (12..) и обврските кон добавувачи (22..) внесете ги по партнер, за да работи аналитиката и затворањето со изводи. Залихата по артикли внесете ја со приемница во „Залиха“ со датумот на почетната состојба.</div>}
      {write
        ? <OpeningEditor key={`${full}-${year}-${ex?.updatedAt?.toISOString() ?? ''}`} year={year} full={full} initialDate={ex?.date ?? `${year}-01-01`} initialRows={rows}
            chart={chart.map((a) => [a.code, a.name])} partners={P} saved={lines.length} firmId={firm.id} bankKontos={banks.map((b) => b.konto)} />
        : <div className="card empty">Немате дозвола за внес. {ex ? `Зачувани се ${lines.length} ставки.` : ''}</div>}
    </>
  );
}
