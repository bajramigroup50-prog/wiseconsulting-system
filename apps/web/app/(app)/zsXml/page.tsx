/**
 * Legacy `VIEWS.zsXml` 11053 (+ import box wrapper 17039, `crmXmlImport` 17027, ACT `crmXmlDl`/`crmXClr`) — phase 6
 * "XML и поднесување": checks, XML download, import of an accepted XML, submission status.
 * FIX(P8 #14): the import records what it replaced and "remove imported amounts" restores it (hand-typed amounts
 * are no longer wiped). FIX(P8 #10/#11): the old `<GodisnaSmetka>` XML (`vjetore`/`gsXml`) and the old statistics
 * list are not ported — the ЦРМ XML is the only export.
 */
import Link from 'next/link';
import { crmRules } from '@wise/core';
import { ConfirmLink } from '@/components/yearend/confirm-link';
import { forms3538 } from '@wise/db';
import { dmy } from '@/lib/fmt';
import { accountNames, phaseDone, yePage } from '@/lib/yearend';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { ActionForm } from '@/components/yearend/action-form';
import { ZsHead } from '@/components/yearend/ph-bar';
import { clearCrmXmlAction, importCrmXmlAction, setStatementStatus } from '../zsProc/actions';

const ST: [string, string][] = [['draft', 'Нацрт'], ['ready', 'Подготвена'], ['submitted', 'Поднесена во ЦРМ'], ['accepted', 'Прифатена']];

export default async function ZsXmlPage() {
  const c = await yePage('zsXml');
  if (!c) return <NoFirm t="XML и поднесување" />;
  const { L, firm, year, findings } = c;
  const { de, f35 } = forms3538(L, await accountNames(firm.id));
  const errs = L.ent === 'npo' ? [] : crmRules(L.Y.co.zs, de).filter((r) => r[2] !== 'warn');
  const le = String(firm.embs ?? '').replace(/\D/g, '');
  const leOk = /^((0[4-9][0-9]{6})|([4-9][0-9]{6}))$/.test(le);
  const miss35 = f35.filter((r) => !r.aop);
  const st = L.statement;
  // Legacy `crmXmlDl` 11066: hard ЦРМ rule errors → confirm before the download.
  const ask = errs.length ? `Има ${errs.length} наоди од контролите на ЦРМ (${errs.slice(0, 3).map((r) => String(r[1] ?? r[0])).join('; ')}${errs.length > 3 ? ' …' : ''}) – ЦРМ може да ја одбие сметката. Сепак да се преземе XML?` : undefined;
  const blocked = findings.open.length > 0;
  const checks: [boolean, React.ReactNode][] = [
    [!blocked, blocked ? <>{findings.open.length} неразрешени наоди во <Link href="/zsKontrola">Контрола</Link> – XML не се издава</> : 'Контролата е чиста'],
    [leOk, leOk ? `ЕМБС ${le}` : <>ЕМБС не е валиден (7 или 8 цифри) – <Link href="/firmi">Фирми</Link></>],
    [!errs.length, errs.length ? <>{errs.length} правила на ЦРМ не се исполнети – <Link href="/zsKontrola">Контрола</Link></> : 'Правилата на ЦРМ се исполнети'],
    [!miss35.length, miss35.length ? <>Образец 35: {miss35.length} дејности без АОП – <Link href="/zs_sp">Образец 35</Link></> : 'Образец 35 е комплетен'],
    [L.Y.closed, L.Y.closed ? 'Годината е затворена' : <>Годината не е затворена – <Link href="/mbyllja">Затворање</Link></>],
  ];
  return (
    <>
      <ZsHead id="zsXml" t="XML за ЦРМ и поднесување" year={year} ent={L.ent} done={phaseDone(L)} />
      <div className="cols">
        <div className="card"><h2>Проверка пред поднесување</h2>
          <ul className="steps">{checks.map(([ok, t], i) => <li key={i}>{ok ? <span className="pill good">✓</span> : <span className="pill warn">!</span>} <span>{t}</span></li>)}</ul>
          <div className="row" style={{ marginTop: 10 }}>
            {blocked ? <button className="btn pri" disabled>⬇ XML за ЦРМ</button> : <ConfirmLink className="btn pri" href="/zsXml/download" confirm={ask}>⬇ XML за ЦРМ</ConfirmLink>}
            {!blocked && <ConfirmLink className="btn" href="/zsXml/download?prev=1" confirm={ask}>⬇ XML со претходна година</ConfirmLink>}
          </div>
          {errs.length > 0 && (
            <table className="dense" style={{ marginTop: 8 }}><thead><tr><th>Правило на ЦРМ</th><th></th></tr></thead>
              <tbody>{errs.map((r, i) => <tr key={i}><td>{String(r[1] ?? r[0])}</td><td><span className="pill bad">✕</span></td></tr>)}</tbody></table>
          )}
          <p className="note">XML-от се прикачува на e-submit.crm.com.mk (Годишна сметка, операција 450, обрасци 35–38). Рок: електронски до 15 март.</p>
        </div>
        <div className="card"><h2>Статус на годишната сметка</h2>
          <p>Моментален статус: <b>{ST.find(([k]) => k === (st?.status ?? 'draft'))?.[1]}</b>{st?.submittedAt && <> · поднесена {dmy(st.submittedAt.toISOString())}</>}</p>
          <div className="row" style={{ gap: 6 }}>
            {ST.filter(([k]) => k !== (st?.status ?? 'draft')).map(([k, n]) => <RowAction key={k} className="btn sm" action={setStatementStatus.bind(null, k as 'draft')} label={n} confirm={`Статусот да се промени во „${n}“?`} />)}
          </div>
          <p className="note">При промена на статусот се зачувува снимка од АОП износите.</p>
        </div>
      </div>
      <ActionForm action={importCrmXmlAction} submit="Увези XML">
        <h2>Увоз на прифатена годишна сметка (XML од ЦРМ)</h2>
        <p className="note">Износите од XML (обрасци 35–38) се зачувуваат како рачни износи за {year}; колоната „претходна година“ се зачувува за {year - 1} ако таа година нема книжења. Може да се отстранат – рачно внесените износи пред увозот се враќаат.</p>
        <input type="file" name="file" accept=".xml,text/xml,application/xml" />
      </ActionForm>
      {st?.crmImport && <div className="row"><RowAction className="btn danger" action={clearCrmXmlAction} label="Отстрани ги увезените износи" confirm="Да се отстранат износите од увезениот XML?" /></div>}
    </>
  );
}
