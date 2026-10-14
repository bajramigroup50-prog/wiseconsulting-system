'use client';
/**
 * ПП30 „Примач“ picker: search partners (with their accounts and unpaid purchase invoices) and employees (net salary).
 * Picking one fills name + seat, account (IBAN when the IBAN box is ticked), bank (from the account's bank code) and
 * the payment method; ticking open invoices fills Износ (Σ open, exact), Цел на дознаката and Повикување на број.
 * Public revenues (taxes, contributions) are paid with ПП50 — the templates are offered as links.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { fromIban, mkBankName, toIban } from '@wise/core/bank/mk-banks';
import { ppInvoicesFill, ppNacin, ppPartyText } from '@wise/core/bank/pp-fill';

export interface PpPickOption {
  key: string; kind: 'partner' | 'employee'; name: string; address: string; city: string;
  accounts: { acc: string; bank: string; def: boolean }[];
  invoices: { refId: string; number: string; date: string; due?: string | null; open: number }[];
}

const fmt = (n: number) => n.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d: string) => d.split('-').reverse().join('.');
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');

export function PpRecipientPicker({ options, taxes, initialRefIds }: { options: PpPickOption[]; taxes: { key: string; name: string }[]; initialRefIds?: string[] }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<PpPickOption | null>(() => (initialRefIds?.length ? options.find((o) => o.invoices.some((i) => initialRefIds.includes(i.refId))) ?? null : null));
  const [picked, setPicked] = useState<string[]>(initialRefIds ?? []);
  const [acc, setAcc] = useState('');
  const list = useMemo(() => {
    const t = norm(q.trim());
    const L = t ? options.filter((o) => norm(o.name + ' ' + o.city + ' ' + o.accounts.map((a) => a.acc).join(' ')).includes(t)) : options;
    return L.slice(0, 40);
  }, [q, options]);

  const field = (form: HTMLFormElement | null, k: string) => form?.elements.namedItem(k) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  const setF = (form: HTMLFormElement | null, k: string, v: string) => { const el = field(form, k); if (el) el.value = v; };
  const ibanOn = (form: HTMLFormElement | null) => !!(field(form, 'iban') as HTMLInputElement | null)?.checked;

  const applyAccount = (form: HTMLFormElement | null, a: { acc: string; bank: string } | undefined) => {
    const v = a?.acc ?? '';
    setAcc(v);
    setF(form, 'recipAcc', ibanOn(form) ? toIban(v) : v);
    setF(form, 'recipBank', a?.bank || mkBankName(v));
    setF(form, 'nacin', ppNacin(field(form, 'payerAcc')?.value, v));
  };
  const applyInvoices = (form: HTMLFormElement | null, o: PpPickOption, ids: string[]) => {
    setPicked(ids);
    const I = o.invoices.filter((x) => ids.includes(x.refId));
    setF(form, 'refIds', ids.join(','));
    setF(form, 'refId', ids[0] ?? '');
    if (!I.length) return;
    const f = ppInvoicesFill(I);
    setF(form, 'amount', f.amount == null ? '' : f.amount.toFixed(2));
    setF(form, 'purpose', f.purpose ?? '');
    setF(form, 'refCredit', f.refCredit ?? '');
    setF(form, 'code', '930');
  };
  const choose = (form: HTMLFormElement | null, o: PpPickOption) => {
    setSel(o); setOpen(false); setQ('');
    setF(form, 'recip', ppPartyText(o));
    applyAccount(form, o.accounts.find((a) => a.def) ?? o.accounts[0]);
    if (o.kind === 'employee') {
      setF(form, 'code', '101');
      const purpose = field(form, 'purpose');
      if (purpose && !purpose.value.trim()) purpose.value = 'Исплата на нето плата';
      applyInvoices(form, o, []);
    } else {
      // the oldest unpaid invoice is ticked; more can be added
      const first = o.invoices[0];
      applyInvoices(form, o, first ? [first.refId] : []);
    }
  };

  return (
    <div className="f wide" style={{ position: 'relative' }}>
      <span>🔎 Примач од шифрарник (комитенти со жиро сметка, вработени)</span>
      <input type="search" value={q} placeholder={sel ? sel.name : 'пребарај по назив, град или сметка…'} aria-label="Пребарај примач"
        onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const o = list[0]; if (o) choose(e.currentTarget.form, o); } if (e.key === 'Escape') setOpen(false); }} />
      <input type="hidden" name="refIds" defaultValue={(initialRefIds ?? []).join(',')} />
      {open && (
        <div className="card" role="listbox" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, maxHeight: 320, overflow: 'auto', padding: 4, margin: 0 }}
          onMouseLeave={() => setOpen(false)}>
          {list.length === 0 && <div className="note" style={{ padding: 6 }}>Нема примач со жиро сметка или отворена фактура.</div>}
          {list.map((o) => (
            <button type="button" key={o.key} className="btn ghost" role="option" aria-selected={sel?.key === o.key} style={{ display: 'block', width: '100%', textAlign: 'left', whiteSpace: 'normal' }}
              onClick={(e) => choose(e.currentTarget.form, o)}>
              <b>{o.name}</b>{o.city ? ', ' + o.city : ''} <span className="pill">{o.kind === 'employee' ? 'вработен' : 'комитент'}</span>
              <span className="mini"> {o.accounts.find((a) => a.def)?.acc || 'нема сметка'}{o.invoices.length ? ` · ${o.invoices.length} неплатени (${fmt(o.invoices.reduce((s, x) => s + Math.round(x.open * 100), 0) / 100)})` : ''}</span>
            </button>
          ))}
          {taxes.length > 0 && <div className="mini" style={{ padding: 6 }}>Даноци и придонеси се плаќаат со ПП50: {taxes.map((t) => <Link key={t.key} href={`/ppNal?tax=${t.key}`} style={{ marginRight: 8 }}>{t.name}</Link>)}</div>}
        </div>
      )}
      {sel && sel.accounts.length > 1 && (
        <label className="f">Сметка на {sel.name}
          <select value={acc} onChange={(e) => applyAccount(e.target.form, sel.accounts.find((a) => a.acc === e.target.value))}>
            {sel.accounts.map((a) => <option key={a.acc} value={a.acc}>{a.acc} – {a.bank || 'банка?'}{a.def ? ' (основна)' : ''}</option>)}
          </select>
        </label>
      )}
      {sel && !sel.accounts.length && <div className="callout warn" style={{ marginTop: 6 }}>„{sel.name}“ нема жиро сметка – внесете ја (ќе се запамети кај комитентот при следно читање на фактура / извод, или на картичката на комитентот).</div>}
      {sel && sel.invoices.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div className="mini">Неплатени влезни фактури – штиклирајте што се плаќа:</div>
          <table className="dense"><tbody>
            {sel.invoices.map((i) => (
              <tr key={i.refId}>
                <td><input type="checkbox" checked={picked.includes(i.refId)} aria-label={'Фактура ' + i.number}
                  onChange={(e) => applyInvoices(e.target.form, sel, e.target.checked ? [...picked, i.refId] : picked.filter((x) => x !== i.refId))} /></td>
                <td>ф-ра {i.number || 'без број'}</td><td>{dmy(i.date)}</td><td>{i.due ? 'рок ' + dmy(i.due) : ''}</td><td className="n">{fmt(i.open)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </div>
  );
}

/** „Сметките во IBAN формат“: ticking converts both accounts to IBAN (MKkk + 15 digits), unticking back to 15 digits. */
export function PpIbanToggle({ defaultChecked }: { defaultChecked: boolean }) {
  return (
    <label className="chk" style={{ marginTop: 6 }}>
      <input type="checkbox" name="iban" defaultChecked={defaultChecked} onChange={(e) => {
        const F = e.target.form;
        for (const k of ['payerAcc', 'recipAcc']) {
          const el = F?.elements.namedItem(k) as HTMLInputElement | null;
          if (el && el.value.trim()) el.value = e.target.checked ? toIban(el.value) : fromIban(el.value);
        }
      }} /> Сметките во IBAN формат (задолжително од 01.11.2026)
    </label>
  );
}
