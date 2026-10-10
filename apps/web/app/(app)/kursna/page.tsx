/**
 * Legacy `VIEWS.kursna` 6499 — Шифрарник › Курсна листа (сите фирми): office-wide middle rates by date.
 * FIX(4.4 #4): this list (table `fx_rates`) is the single office rate source used by `fxRate` for bank
 * statements, cash vouchers and FX documents — no hard-coded EUR 61.5 / `BLG_FX0`.
 */
import Link from 'next/link';
import { asc, desc } from 'drizzle-orm';
import { can, FX_DATE0, FX_DEF, fxRate } from '@wise/core';
import { FX_IMPORT_TEMPLATE, fxCurrencies, fxExportRows } from '@wise/core/bank/fin-parity';
import { fxRates, loadFxSources } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { viewAllowed } from '@/lib/nav';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { notFound } from 'next/navigation';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { ExportBar } from '@/components/parity-fin/export-bar';
import { TableImport } from '@/components/parity-fin/table-import';
import { deleteFxAction, importFxAction, saveFxAction } from './actions';

const NAME = Object.fromEntries(FX_DEF.map((x) => [x[0], x[1]]));

export default async function KursnaPage({ searchParams }: { searchParams: Promise<{ nov?: string; edit?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  if (!viewAllowed(u.role, 'kursna')) notFound();
  const ed = can(u.principal, 'fxSave');
  const R = await db().select().from(fxRates).orderBy(desc(fxRates.date), asc(fxRates.cur));
  const curs = fxCurrencies(R);
  const last = (c: string) => R.find((r) => r.cur === c);
  const dates = [...new Set(R.map((r) => r.date))];
  const today = new Date().toISOString().slice(0, 10);
  const editDate = sp.edit && dates.includes(sp.edit) ? sp.edit : null;
  // Legacy `fxNew` 7961: every currency, pre-filled with `getFx` (firm codebook → office list → FX_DEF).
  const fxSrc = ed && sp.nov !== undefined && !editDate ? await loadFxSources(db(), (await currentFirm(u))?.id ?? null) : null;
  const draft = ed && (sp.nov !== undefined || editDate)
    ? {
      date: editDate ?? today,
      orig: editDate,
      rows: editDate
        ? R.filter((r) => r.date === editDate).map((r) => ({ cur: r.cur, rate: Number(r.rate) }))
        : curs.map((c) => ({ cur: c, rate: fxRate(c, today, fxSrc ?? undefined) })),
    }
    : null;

  return (
    <>
      <Hd t="Курсна листа" sub="заедничка за сите фирми · среден курс" excel={false}>
        <ExportBar pdf={false} name="Kursna_lista" title="Курсна листа" rows={fxExportRows(R)} />
        {ed && <TableImport action={importFxAction} template={{ name: 'Kursna_lista_obrazec.xlsx', rows: FX_IMPORT_TEMPLATE }}
          confirm="Курсните листи за датумите од датотеката ќе бидат заменети. Продолжи?" note="Колони: Датум, Валута, Курс (среден курс за 1 единица во МКД)" />}
        {ed && <Link className="btn pri" href="/kursna?nov">+ Нова курсна листа</Link>}
      </Hd>
      <div className="callout">Курсевите важат за <b>сите фирми</b>: благајна (странски сметки), девизни изводи, увозни фактури. Секој документ го зема курсот на својот датум (последната листа до тој датум). Ако некоја фирма има свој курс во „Странски валути“, се зема нејзиниот.
        {!R.length && ` Сè уште нема внесена листа – се користи стандардната од ${dmy(FX_DATE0)}.`}</div>

      {draft && (
        <BankForm action={saveFxAction} className="card" style={{ borderColor: 'var(--accent)' }}>
          <div className="hd"><h2>Курсна листа на ден</h2>
            <div className="row">{draft.orig && <input type="hidden" name="orig" value={draft.orig} />}<input type="date" name="date" defaultValue={draft.date} required aria-label="Датум" /><Link className="btn" href="/kursna">Откажи</Link><button className="btn pri">Зачувај</button></div></div>
          <div className="tw"><table className="dense">
            <thead><tr><th>Валута</th><th>Назив</th><th className="n">Среден курс (1 единица = МКД)</th></tr></thead>
            <tbody>{[...draft.rows, { cur: '', rate: 0 }, { cur: '', rate: 0 }].map((r, i) => (
              <tr key={i}>
                <td><input name="cur" defaultValue={r.cur} style={{ width: 70 }} maxLength={3} aria-label="Валута" /></td>
                <td>{NAME[r.cur] ?? ''}</td>
                <td className="n"><input name="rate" defaultValue={r.rate || ''} inputMode="decimal" style={{ width: 120, textAlign: 'right' }} aria-label="Курс" /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </BankForm>
      )}

      <div id="finArea">
      <div className="card"><h2>Тековни курсеви</h2>
        <div className="tw"><table className="dense">
          <thead><tr><th>Валута</th><th>Назив</th><th className="n">Среден курс</th><th>Важи од</th><th className="n">100 единици</th></tr></thead>
          <tbody>{curs.map((c) => {
            const l = last(c);
            const r = l ? Number(l.rate) : FX_DEF.find((x) => x[0] === c)?.[2];
            return (
              <tr key={c}><td><b>{c}</b></td><td>{NAME[c] ?? ''}</td><td className="n">{r ? r.toFixed(4) : ''}</td>
                <td>{l ? dmy(l.date) : <span className="mut">стандарден {dmy(FX_DATE0)}</span>}</td><td className="n">{r ? fmt(r * 100) : ''}</td></tr>
            );
          })}</tbody>
        </table></div>
      </div>

      {dates.length > 0 && (
        <div className="card"><h2>Историја ({dates.length} листи)</h2>
          <div className="tw" style={{ maxHeight: 340 }}><table className="dense">
            <thead><tr><th>Датум</th>{curs.slice(0, 8).map((c) => <th key={c} className="n">{c}</th>)}<th></th></tr></thead>
            <tbody>{dates.map((d) => (
              <tr key={d}><td>{dmy(d)}</td>
                {curs.slice(0, 8).map((c) => { const x = R.find((y) => y.date === d && y.cur === c); return <td key={c} className="n">{x ? Number(x.rate).toFixed(4) : ''}</td>; })}
                <td className="noprint">{ed && <><Link className="btn sm" href={`/kursna?edit=${d}`}>Измени</Link><RowAction action={deleteFxAction.bind(null, d)} label="🗑" confirm={`Да се избрише курсната листа од ${dmy(d)}?`} className="btn sm ghost danger" /></>}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
      </div>
    </>
  );
}
