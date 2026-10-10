/** Legacy `VIEWS.konto` 6822 — Шифрарник › Контен план (built-in chart + firm overrides). */
import Link from 'next/link';
import { Fragment } from 'react';
import { CLS } from '@wise/core';
import { effectiveChart } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { deleteAccount, resetAccount } from './actions';
import { AccountForm } from './account-form';
import { ImportButton } from '@/components/doc-tools';
import { importAccountsAction } from '../_stock/parity-actions';

export default async function KontoPage({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string; nov?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await booksPage('konto');
  if (!firm) return <NoFirm t="Контен план" />;
  const A = await effectiveChart(db(), firm.id);
  const q = (sp.q ?? '').trim().toLowerCase();
  const rows = q ? A.filter((a) => a.code.startsWith(q) || a.name.toLowerCase().includes(q)) : A;
  const write = canDo(u, 'write', firm.id);
  const edit = sp.edit ? A.find((a) => a.code === sp.edit) : undefined;

  return (
    <>
      <Hd t="Контен план" sub={`${A.length} конта`}>
        {write && <ImportButton action={importAccountsAction} name="Konten_plan" label="Увоз од Excel" template={[['10000', 'Жиро сметка']]}
          fields={[{ key: 'code', label: 'Конто', re: '^(конто|број|code|sifra|шифра)', req: true }, { key: 'name', label: 'Назив', re: '^(назив|name|naziv|опис)', req: true }]}
          confirmText="Да се увезат {n} конта од „{file}“? Постоечко конто = нов назив." />}
        {write && <Link className="btn pri" href="/konto?nov">+ Конто</Link>}
      </Hd>
      <p className="note">Контниот план на фирмата може да се менува тука: додадете аналитички конта или поправете називи според вашиот контен план. Измените важат само за оваа фирма.</p>
      {write && (sp.nov !== undefined || edit) && <AccountForm code={edit?.code ?? null} name={edit?.name ?? ''} />}
      <form className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input name="q" defaultValue={sp.q ?? ''} placeholder="🔍 Конто (почеток) или назив…" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn">Барај</button>
        {q && <Link className="btn" href="/konto">Прикажи сè</Link>}
      </form>
      <div className="tw"><table>
        <thead><tr><th>Конто</th><th>Назив</th><th></th></tr></thead>
        <tbody>
          {rows.map((a, i) => (
            <Fragment key={a.code}>
              {(i === 0 || rows[i - 1]!.code[0] !== a.code[0]) && <tr className="sub"><td colSpan={3}>Класа {CLS[+a.code[0]! as 0]}</td></tr>}
              <tr>
                <td className="num" style={{ textAlign: 'left' }}>{a.code}</td>
                <td>{a.name}{a.overridden && <> <span className="pill info">{a.global ? 'изменет назив' : 'сопствено'}</span></>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {write && <Link className="btn sm" href={`/konto?edit=${a.code}${q ? '&q=' + encodeURIComponent(q) : ''}`}>Измени</Link>}{' '}
                  {write && a.overridden && a.global && <RowAction action={resetAccount.bind(null, a.code)} label="Врати" title="Врати го стандардниот назив" />}{' '}
                  {write && <RowAction action={deleteAccount.bind(null, a.code)} label="Избриши" confirm={`Да се избрише контото ${a.code} од контниот план на фирмата?`} style={{ color: 'var(--bad)' }} />}
                </td>
              </tr>
            </Fragment>
          ))}
          {!rows.length && <tr><td colSpan={3} className="mut">Нема конто што одговара.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
