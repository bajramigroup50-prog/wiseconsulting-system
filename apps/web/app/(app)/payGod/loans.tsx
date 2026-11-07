/**
 * „⚖ Задршки од плата“ (its own menu item, also Годишен извештај → 💳 Кредити и задршки): the register of withholding
 * orders per employee — order received („Ред“), legal cap, account, decision attached, paid / rest, report per order
 * and „🧾 Задршки за месецот – кому се плаќа“.
 */
import Link from 'next/link';
import { and, eq, inArray } from 'drizzle-orm';
import { LOAN_CAP_LABEL, loanCap, payLoanStatus, ppAccTxt, type PayLoan } from '@wise/core';
import { fileLinks, loanDeductions, PAY_LOAN_FILE_ENTITY } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { firmEmployees } from '@/lib/payroll/server';
import { ActionForm } from '@/components/action-form';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { Hd } from '@/components/hd';
import { payLoanCloseAction, payLoanDelAction, payLoanSaveAction } from './actions';
import { reapplyAction } from '../payOds/actions';

const KINDS = ['Судска забрана / извршител', 'Издршка (алиментација)', 'Кредит (административна забрана)', 'Задршка по решение', 'Друго'];

export async function Loans({ firmId, edit, base }: { firmId: string; edit?: string; base: string }) {
  const E = await firmEmployees(firmId);
  const withL = E.map((e) => ({ e, L: (((e.data ?? {}) as { loans?: PayLoan[] }).loans ?? []) })).filter((x) => x.L.length);
  const from = withL.flatMap((x) => x.L.map((l) => l.from.slice(0, 7))).sort()[0];
  /* the deductions per employee, month and order (the tagged lines „Задршка: … #id“), from every run since the oldest order */
  const ded = from ? await loanDeductions(db(), firmId, new Map(withL.map((x) => [x.e.id, x.L])), from) : new Map();
  // „Ред“: the order received per employee (ЗИ: executed oldest first; the next starts when one is paid)
  const rows = withL.flatMap(({ e, L }) => payLoanStatus(L, ded.get(e.id) ?? new Map()).map((s, i) => ({ e, s, pos: i + 1 })));
  const F = rows.length ? await db().select({ fileId: fileLinks.fileId, id: fileLinks.entityId }).from(fileLinks).where(and(eq(fileLinks.entityType, PAY_LOAN_FILE_ENTITY), inArray(fileLinks.entityId, rows.map((r) => r.s.id)))) : [];
  const ed = rows.find((r) => r.s.id === edit);
  const v = ed?.s;
  return (
    <>
      <Hd t="⚖ Задршки од плата" sub="извршители · издршка · кредити (административни забрани)">
        <a className="btn pri" href={`/payGod/zadrski?m=${new Date().toISOString().slice(0, 7)}`} target="_blank" rel="noopener">🧾 Задршки за месецот – кому се плаќа</a>
        <Link className="btn" href="/payGod">← Годишен извештај</Link>
      </Hd>
      <ActionForm action={payLoanSaveAction} className="card" reset={!ed}>
        <h2 style={{ fontSize: 15 }}>{ed ? `✎ ${ed.e.name} – ${v!.creditor}` : '+ Ново решение за задршка'}</h2>
        {v && <input type="hidden" name="id" value={v.id} />}
        <div className="form">
          <label className="f">Вработен<select name="emp" defaultValue={ed?.e.id ?? ''} required><option value="">—</option>{E.map((e) => <option key={e.id} value={e.id}>{e.no} {e.name}</option>)}</select></label>
          <label className="f">Вид<select name="kind" defaultValue={v?.kind ?? KINDS[0]}>{[...new Set([...KINDS, ...(v ? [v.kind] : [])])].map((k) => <option key={k}>{k}</option>)}</select></label>
          <label className="f">Доверител (извршител / банка)<input name="creditor" defaultValue={v?.creditor ?? ''} placeholder="Извршител Петар Петров" /></label>
          <label className="f">Сметка на доверителот<input name="acc" defaultValue={v?.acc ?? ''} placeholder="МК07… или 300-0000000000-00" /></label>
          <label className="f">Број на решение / предмет<input name="caseNo" defaultValue={v?.caseNo ?? ''} placeholder="И.бр. 123/26" /></label>
          <label className="f">Повик на број (одобрување)<input name="ref" defaultValue={v?.ref ?? ''} /></label>
          <label className="f">Вкупен долг<input name="total" type="number" step="any" defaultValue={v?.total ?? ''} /></label>
          <label className="f">Месечна рата (вие ја одредувате, на пр. 1/3 од платата)<input name="monthly" type="number" step="any" defaultValue={v?.monthly || ''} /></label>
          <label className="f">или % од нето платата<input name="pct" type="number" step="any" min={0} max={100} defaultValue={v?.pct ?? ''} /></label>
          <label className="f">Законска граница<select name="cap" defaultValue={v ? loanCap(v) : ''}><option value="">автоматски според видот</option>{Object.entries(LOAN_CAP_LABEL).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
          <label className="f">Се одбива од (прием на решението)<input name="from" type="date" defaultValue={v?.from ?? ''} /></label>
          <label className="f wide">Забелешка<input name="note" defaultValue={v?.note ?? ''} /></label>
          <UploadField firmId={firmId} capture accept="image/*,application/pdf" label="📎 Прикачи го решението (PDF / слика)" />
        </div>
        <div className="row" style={{ gap: 8 }}><button className="btn pri">{ed ? 'Зачувај' : '+ Додај'}</button>{ed && <Link className="btn" href={base}>Откажи</Link>}</div>
        <p className="note">Секоја нова плата добива посебна ставка „Задршка: доверител (бр. на решение)“: ратата или процентот, најмногу остатокот на долгот и <b>најмногу до законската граница</b> (ЗИ чл. 117: издршка до 1/2 од платата, другите побарувања заедно до 1/3, вкупно никогаш над 1/2; повеќе решенија по редот на прием). Налозите за плата (КТД) имаат и налог до секој доверител; книжењето е на 2492 по доверител.</p>
      </ActionForm>
      <ActionForm action={reapplyAction} className="card" reset={false}>
        <div className="row" style={{ gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <span className="mini" style={{ flexBasis: '100%' }}>Новата плата ја внесува ратата <b>автоматски</b>. Ако платата за месецот е веќе направена (непрокнижена) пред да го внесете решението:</span>
          <label className="f">Месец<input name="month" type="month" defaultValue={new Date().toISOString().slice(0, 7)} /></label>
          <button className="btn">⟳ Внеси ги задршките во платата</button>
        </div>
      </ActionForm>
      {rows.length ? (
        <div className="tw"><table>
          <thead><tr><th>Вработен</th><th>Ред</th><th>Вид / доверител</th><th>Од</th><th>Граница</th><th className="n">Долг</th><th className="n">Рата</th><th className="n">Отплатено</th><th className="n">Останува</th><th className="n">Месеци</th><th>Решение</th><th /></tr></thead>
          <tbody>{rows.map(({ e, s, pos }) => {
            const ff = F.filter((x) => x.id === s.id);
            return (
              <tr key={s.id} style={s.closed ? { opacity: 0.55 } : undefined}>
                <td>{e.no} {e.name}</td><td className="n">{pos}</td>
                <td><b>{s.creditor}</b><div className="mini">{s.kind}{s.caseNo ? ` · ${s.caseNo}` : ''}{s.acc ? ` · ${ppAccTxt(s.acc, '2026-11-09')}` : ' · ⚠ нема сметка'}</div>{s.note ? <small className="mut">{s.note}</small> : null}</td>
                <td>{dmy(s.from)}</td><td className="mini">{LOAN_CAP_LABEL[loanCap(s)]}</td>
                <td className="n">{fmt(s.total)}</td><td className="n">{s.monthly ? fmt(s.monthly) : ''}{s.monthly > 0 ? <div className="mini">{Math.ceil(s.total / s.monthly)} рати · отплатени {s.months.length}</div> : null}{s.pct ? <div className="mini">{s.pct}% од нето</div> : null}</td><td className="n">{fmt(s.paid)}</td>
                <td className="n">{s.closed ? <span className="pill">затворено</span> : s.rest > 0.009 ? <b>{fmt(s.rest)}</b> : <span className="pill ok">отплатен</span>}</td><td className="n" title={s.months.join(', ')}>{s.months.length}</td>
                <td>{ff.length ? ff.map((f, i) => <a key={f.fileId} className="btn sm" href={`/api/files/${f.fileId}`} target="_blank" rel="noopener">👁{ff.length > 1 ? i + 1 : ''}</a>) : <span className="mini">—</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <Link className="btn sm" href={`${base}${base.includes('?') ? '&' : '?'}m=${s.id}`} title="Промени / прикачи решение">✎</Link>
                  <a className="btn sm" href={`/payGod/izvestaj?id=${s.id}&emp=${e.id}`} target="_blank" rel="noopener" title="Извештај до извршителот / вработениот">🖨</a>
                  <RowAction label={s.closed ? '↺' : '⏹'} title={s.closed ? 'Отвори повторно' : 'Затвори (не се одбива повеќе)'} confirm={s.closed ? undefined : 'Решението да не се одбива повеќе?'} action={payLoanCloseAction.bind(null, e.id, s.id, !s.closed)} />
                  <RowAction label="🗑" title="Избриши" confirm="Да се избрише од регистарот?" action={payLoanDelAction.bind(null, e.id, s.id)} />
                </td>
              </tr>
            );
          })}</tbody>
          <tfoot><tr><td colSpan={5}>Вкупно</td><td className="n">{fmt(rows.reduce((a, r) => a + r.s.total, 0))}</td><td /><td className="n">{fmt(rows.reduce((a, r) => a + r.s.paid, 0))}</td><td className="n">{fmt(rows.reduce((a, r) => a + (r.s.closed ? 0 : r.s.rest), 0))}</td><td colSpan={3} /></tr></tfoot>
        </table></div>
      ) : <div className="card empty">Нема внесени кредити или задршки.</div>}
    </>
  );
}
