'use client';
/** „🔁 Рекнижење во маса“ — the found lines with checkboxes, the change (konto / partner / both), preview and confirm. */
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { RcChange, RcLine } from '@wise/core/reclass';
import { PartnerPicker, type PickerPartner } from '@/components/partner-picker';
import { applyAction, previewAction, type RcPreviewState } from './actions';

type Line = RcLine & { partner: string; locked: boolean };
const f2 = (n: number) => n.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d: string) => d.split('-').reverse().join('.');
const PATH: Record<string, string> = { manual: 'рачен налог', doc: 'корекција на документ', bank: 'преку изводот' };

export function RcClient({ lines, total, more, partners, chart }: {
  lines: Line[]; total: { n: number; debit: number; credit: number }; more: boolean; partners: PickerPartner[]; chart: { code: string; name: string }[];
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<number>>(() => new Set());
  const [mode, setMode] = useState<'k' | 'p' | 'kp'>('k');
  const [konto, setKonto] = useState('');
  const [pmode, setPmode] = useState<'set' | 'clear'>('set');
  const [pid, setPid] = useState('');
  const [pv, setPv] = useState<RcPreviewState | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const pName = useMemo(() => new Map(partners.map((p) => [p.id, p.name])), [partners]);
  const kName = useMemo(() => new Map(chart.map((c) => [c.code, c.name])), [chart]);
  const open = lines.filter((l) => !l.locked);
  const chosen = lines.filter((l) => sel.has(l.id));
  const sD = chosen.reduce((s, l) => s + l.debit, 0), sP = chosen.reduce((s, l) => s + l.credit, 0);
  const k = konto.trim().split(/\s/)[0] ?? '';

  const change = (): RcChange | string => {
    const c: RcChange = {};
    if (mode !== 'p') { if (!/^\d{1,10}$/.test(k)) return 'Внесете ново конто.'; if (!kName.has(k)) return `Контото ${k} не постои во контниот план.`; c.account = k; }
    if (mode !== 'k') { if (pmode === 'set' && !pid) return 'Изберете нов комитент.'; c.partnerId = pmode === 'set' ? pid : null; }
    return c;
  };
  const toggle = (id: number) => { setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); setPv(null); };
  const all = (on: boolean) => { setSel(on ? new Set(open.map((l) => l.id)) : new Set()); setPv(null); };

  const preview = () => {
    const c = change();
    setMsg(null);
    if (typeof c === 'string') { setMsg({ error: c }); return; }
    start(async () => { const r = await previewAction([...sel], c); if (r.error) setMsg({ error: r.error }); setPv(r.error ? null : r); });
  };
  const apply = () => {
    const c = change();
    if (typeof c === 'string' || !pv?.ok) return;
    if (!window.confirm(`Да се рекнижат ${pv.ok} ставки во ${pv.journals} налози? Целото рекнижење може да се врати со „↶ Врати“.`)) return;
    start(async () => {
      const r = await applyAction([...sel], c);
      setMsg(r);
      if (r.ok) { setSel(new Set()); setPv(null); router.refresh(); }
    });
  };
  const pl = (id: string | null) => (id ? pName.get(id) ?? '?' : '—');

  return (
    <>
      <div className="card">
        <div className="hd"><h2>Пронајдени ставки: {total.n}{more ? ' (прикажани првите 3000 – стеснете го филтерот)' : ''}</h2>
          <span className="note">Должи {f2(total.debit)} · Побарува {f2(total.credit)}</span></div>
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <button type="button" className="btn sm" onClick={() => all(true)} disabled={!open.length}>☑ Избери ги сите ({open.length})</button>
          <button type="button" className="btn sm ghost" onClick={() => all(false)} disabled={!sel.size}>Откажи го изборот</button>
          <span className="mini">Избрани: <b>{sel.size}</b> · Должи {f2(sD)} · Побарува {f2(sP)}</span>
        </div>
        <div className="tw" style={{ maxHeight: 460, overflow: 'auto' }}><table>
          <thead><tr><th /><th>Датум</th><th>Налог</th><th>Вид</th><th>Конто</th><th>Комитент</th><th>Опис</th><th className="n">Должи</th><th className="n">Побарува</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} style={l.locked ? { opacity: 0.55 } : undefined} title={l.locked ? 'Заклучен период / налог – не се менува' : undefined}>
                <td><input type="checkbox" checked={sel.has(l.id)} disabled={l.locked} onChange={() => toggle(l.id)} aria-label={`Избери ${l.number} ${l.account}`} /></td>
                <td>{dmy(l.date)}</td><td>{l.number}</td><td className="mini">{l.kind}</td>
                <td title={kName.get(l.account)}>{l.account}</td><td>{l.partner}</td>
                <td className="mini">{[l.jdesc, l.note, l.doc].filter(Boolean).join(' · ').slice(0, 90)}</td>
                <td className="n">{l.debit ? f2(l.debit) : ''}</td><td className="n">{l.credit ? f2(l.credit) : ''}</td>
              </tr>
            ))}
            {!lines.length && <tr><td colSpan={9} className="empty">Нема ставки за овој филтер.</td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <div className="hd"><h2>Промена за избраните ставки</h2></div>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="f">Што се менува<select value={mode} onChange={(e) => { setMode(e.target.value as 'k'); setPv(null); }}>
            <option value="k">конто</option><option value="p">комитент</option><option value="kp">конто и комитент</option></select></label>
          {mode !== 'p' && <label className="f">Ново конто<input value={konto} onChange={(e) => { setKonto(e.target.value); setPv(null); }} list="rc-konta" style={{ width: 140 }} aria-label="Ново конто" />
            <small className="mut">{k ? kName.get(k) ?? 'нема во контниот план' : ''}</small></label>}
          {mode !== 'k' && <label className="f">Нов комитент
            <span className="row" style={{ gap: 6 }}>
              <select value={pmode} onChange={(e) => { setPmode(e.target.value as 'set'); setPv(null); }}><option value="set">постави</option><option value="clear">без комитент</option></select>
              {pmode === 'set' && <PartnerPicker partners={partners} value={pid} onChange={(v) => { setPid(v); setPv(null); }} width={260} />}
            </span></label>}
          <button type="button" className="btn" disabled={!sel.size || pending} onClick={preview}>{pending && !pv ? 'Се проверува…' : `👁 Преглед (${sel.size})`}</button>
        </div>
        {msg?.error && <div className="callout bad" role="alert" style={{ marginTop: 8 }}>{msg.error}</div>}
        {msg?.ok && <div className="callout good" role="status" style={{ marginTop: 8 }}>{msg.ok}</div>}
      </div>

      {pv?.rows && (
        <div className="card">
          <div className="hd"><h2>Преглед пред рекнижење</h2>
            <span className="note">{pv.ok} ставки ќе се рекнижат во {pv.journals} налози{pv.blocked ? `, ${pv.blocked} се прескокнуваат` : ''}</span></div>
          <div className="tw"><table>
            <thead><tr><th>Конто</th><th>Назив</th><th className="n">Должи пред</th><th className="n">Побарува пред</th><th className="n">Должи потоа</th><th className="n">Побарува потоа</th><th className="n">Разлика (салдо)</th></tr></thead>
            <tbody>{pv.totals!.map((t) => (
              <tr key={t.konto}><td>{t.konto}</td><td className="mini">{kName.get(t.konto)}</td><td className="n">{f2(t.debitBefore)}</td><td className="n">{f2(t.creditBefore)}</td>
                <td className="n">{f2(t.debitAfter)}</td><td className="n">{f2(t.creditAfter)}</td>
                <td className="n" style={{ color: t.diff < 0 ? 'var(--bad)' : t.diff > 0 ? 'var(--good)' : undefined }}>{t.diff ? f2(t.diff) : '—'}</td></tr>))}</tbody>
          </table></div>
          <div className="tw" style={{ maxHeight: 380, overflow: 'auto', marginTop: 10 }}><table>
            <thead><tr><th>Датум</th><th>Налог</th><th>Конто: старо → ново</th><th>Комитент: стар → нов</th><th className="n">Износ</th><th>Како / зошто не</th></tr></thead>
            <tbody>{pv.rows.map((r) => (
              <tr key={r.id} style={r.to ? undefined : { background: 'color-mix(in srgb, var(--bad) 8%, transparent)' }}>
                <td>{dmy(r.date)}</td><td>{r.number}</td>
                <td>{r.account}{r.to && r.to.account !== r.account ? <> → <b>{r.to.account}</b></> : ''}</td>
                <td>{pl(r.partnerId)}{r.to && (r.to.partnerId ?? null) !== (r.partnerId ?? null) ? <> → <b>{pl(r.to.partnerId)}</b></> : ''}</td>
                <td className="n">{f2(r.debit || r.credit)} {r.debit ? 'Д' : 'П'}</td>
                <td className="mini">{r.to ? <span className="pill good">{PATH[r.path ?? ''] ?? 'ок'}</span> : <span style={{ color: 'var(--bad)' }}>{r.reason}</span>}</td>
              </tr>))}</tbody>
          </table></div>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button type="button" className="btn pri" disabled={!pv.ok || pending} onClick={apply}>{pending ? 'Се рекнижува…' : `✔ Потврди рекнижење (${pv.ok} ставки)`}</button>
            <button type="button" className="btn ghost" onClick={() => setPv(null)} disabled={pending}>Откажи</button>
          </div>
        </div>
      )}
    </>
  );
}
