'use client';
/**
 * „Изводи во налогот“ — the statement work inside an open bank nalog (no separate window): every statement with its
 * header (number, bank balances, ✓ saldo) and ALL its lines; konto / partner edited inline, invoice picker, row menu
 * (flip, delete, learn rule, unbook). Saving goes through the /banka server actions, which re-post the statement and
 * revalidate /nalozi (the journal table below refreshes in place); „Зачувај ги сите промени“ saves the edited lines
 * at once with one re-post per statement. Only edited lines change.
 */
import { useMemo, useState, useTransition } from 'react';
import { BankForm, type FormState } from '@/components/bank-form';
import {
  bookAllAction, deleteLineAction, flipLineAction, linkLineAction, setKontoAction, setPartnerAction, unlinkLineAction, updateStatementAction,
} from '../banka/actions';
import { lineDocsAction, saveStatementLinesAction, type LineDoc } from './statement-actions';
import { PartnerPicker } from '@/components/partner-picker';
import { KontoHintNote } from '@/components/konto-field';
import { BankManualEntry } from '@/components/bank-manual-entry';
import { wrongSideWarning } from '@wise/core/bank/side';

export interface PanelLine {
  id: string; date: string; name: string; purpose: string; amount: number; amountCur: number | null; cur: string | null; osnov: string;
  /** Own konto of the line ('' = none) and the effective konto (invoice link → the customer / supplier konto). */
  konto: string; effK: string; partnerId: string; newPartner: string;
  /** Partner matched from the statement's counterparty name (Latin ↔ Cyrillic), preselected when the line has none. */
  guessPid: string;
  linked: boolean; refLabel: string; refType: string; manual: boolean; prob: string;
  sugg: { konto: string; partnerId: string; why: string; ok: boolean } | null;
}
export interface PanelStatement {
  id: string; number: string; date: string; acct: string; bankKonto: string; fx: boolean; cur: string;
  /** Bank account id (the „✍️ Рачна ставка“ dialog adds the line to this statement). */
  acctId?: string;
  opening: number | null; closing: number | null; status: string;
  /** Why it is read-only (locked period / locked nalog), '' = editable. */
  locked: string;
  lines: PanelLine[];
}

const PK = /^(12[0-8]|22[0-8])/;
const nf = new Intl.NumberFormat('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (v: number | null | undefined) => (v == null ? '' : nf.format(v));
const dmy = (d: string) => d.split('-').reverse().join('.');
const n2 = (v: number | null) => (v == null ? '' : String(v));

type Edit = { konto: string; partnerId: string; pText?: string };

export function StatementsPanel({ statements, chart, partners, write, del, flip }: {
  statements: PanelStatement[]; chart: [string, string][]; partners: { id: string; code: string | null; name: string }[];
  write: boolean; del: boolean; flip: boolean;
}) {
  const kName = useMemo(() => new Map(chart), [chart]);
  const chartRows = useMemo(() => chart.map(([code, name]) => ({ code, name })), [chart]);
  const pById = useMemo(() => new Map(partners.map((p) => [p.id, p])), [partners]);
  const pLabel = (id: string) => { const p = pById.get(id); return p ? (p.code ? `${p.code} · ` : '') + p.name : ''; };
  const pByLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of partners) { m.set(p.name, p.id); m.set((p.code ? `${p.code} · ` : '') + p.name, p.id); }
    return m;
  }, [partners]);
  // collapsed when the nalog has more than 3 statements; the first statement with problems opens itself
  const [open, setOpen] = useState<Set<string>>(() => {
    if (statements.length <= 3) return new Set(statements.map((s) => s.id));
    const first = statements.find((s) => s.lines.some((l) => l.prob));
    return new Set(first ? [first.id] : []);
  });
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [msg, setMsg] = useState<FormState | null>(null);
  const [picker, setPicker] = useState<{ line: string; docs?: LineDoc[]; error?: string } | null>(null);
  const [pending, start] = useTransition();
  /** „✍️ Рачна ставка“: the statement the fast-entry dialog adds to (null = closed). */
  const [manual, setManual] = useState<string | null>(null);
  /** Bumped by „Откажи“ so the (uncontrolled) partner inputs show the saved partner again. */
  const [gen, setGen] = useState(0);

  const lineById = useMemo(() => new Map(statements.flatMap((s) => s.lines.map((l) => [l.id, { l, s }] as const))), [statements]);
  const origK = (l: PanelLine) => l.konto || l.effK;
  const cur = (l: PanelLine): Edit => edits[l.id] ?? { konto: origK(l), partnerId: l.partnerId || (PK.test(origK(l)) ? l.guessPid : '') };
  const dirty = (l: PanelLine) => {
    const e = edits[l.id];
    if (!e) return false;
    const k = e.konto.trim().split(/\s/)[0] ?? '';
    return !!k && (k !== origK(l) || e.partnerId !== l.partnerId);
  };
  const dirtyLines = [...lineById.values()].filter(({ l, s }) => !s.locked && dirty(l)).map(({ l }) => l);
  const setEdit = (l: PanelLine, p: Partial<Edit>) => setEdits((E) => ({ ...E, [l.id]: { ...(E[l.id] ?? cur(l)), ...p } }));
  const drop = (ids: string[]) => setEdits((E) => { const n = { ...E }; for (const id of ids) delete n[id]; return n; });

  const run = (f: () => Promise<FormState>, done?: () => void) => start(async () => {
    const r = await f();
    setMsg(r);
    if (!r.error) done?.();
  });
  const fd = (o: Record<string, string | string[]>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
    return f;
  };
  /** One line: konto (with partner) through `setKontoAction`; a linked line whose konto stays only changes its partner. */
  const saveLine = (l: PanelLine, learn = false) => {
    const e = cur(l);
    const k = e.konto.trim().split(/\s/)[0] ?? '';
    if (!k) { setMsg({ error: 'Внесете конто.' }); return; }
    if (l.linked && k === origK(l) && !learn) run(() => setPartnerAction({}, fd({ line: l.id, partner: e.partnerId })), () => drop([l.id]));
    else run(() => setKontoAction({}, fd({ line: l.id, konto: k, partner: PK.test(k) ? e.partnerId : '', ...(learn ? { learn: 'on' } : {}) })), () => drop([l.id]));
  };
  const saveAll = () => {
    const items = dirtyLines.map((l) => {
      const e = cur(l);
      const k = e.konto.trim().split(/\s/)[0] ?? '';
      return { lineId: l.id, konto: l.linked && k === origK(l) ? null : k, partnerId: PK.test(k) ? e.partnerId || null : null };
    });
    run(() => saveStatementLinesAction({}, fd({ items: JSON.stringify(items) })), () => drop(items.map((i) => i.lineId)));
  };
  const openPicker = (l: PanelLine) => {
    if (picker?.line === l.id) { setPicker(null); return; }
    setPicker({ line: l.id });
    start(async () => { const r = await lineDocsAction(l.id); setPicker({ line: l.id, ...(r.error ? { error: r.error } : { docs: r.docs ?? [] }) }); });
  };

  const saveBar = write && (
    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
      <button type="button" className="btn pri" disabled={pending || !dirtyLines.length} onClick={saveAll}
        title="Ги зачувува сите изменети ставки; секој извод се прекнижува еднаш">💾 Зачувај ги сите промени{dirtyLines.length ? ` (${dirtyLines.length})` : ''}</button>
      {dirtyLines.length > 0 && <button type="button" className="btn" disabled={pending} onClick={() => { setEdits({}); setGen((g) => g + 1); }}>↺ Откажи</button>}
      {pending && <span className="note">се зачувува…</span>}
    </div>
  );

  return (
    <div className="card" id="izvodi-nalog">
      <datalist id="nalBkK2">{chart.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</datalist>
      <datalist id="nalBkP">{partners.map((p) => <option key={p.id} value={(p.code ? `${p.code} · ` : '') + p.name} />)}</datalist>
      <div className="hd" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2>Изводи во налогот ({statements.length})</h2>
        <span className="row" style={{ gap: 6 }}>
          {statements.length > 1 && <>
            <button type="button" className="btn sm" onClick={() => setOpen(new Set(statements.map((s) => s.id)))}>Отвори ги сите</button>
            <button type="button" className="btn sm" onClick={() => setOpen(new Set())}>Затвори ги сите</button>
          </>}
          {write && statements.some((s) => s.acctId && !s.locked) && <button type="button" className="btn sm" onClick={() => setManual(statements.find((s) => s.acctId && !s.locked)!.id)} title="Нова ставка во извод: F9 = зачувај и следна, Esc = излез">✍️ Рачна ставка</button>}
          {saveBar}
          {/* UX Phase 3 (P2): ONE review for all unbooked lines of the firm (rules + invoices / FIFO + AI), by confidence */}
          {write && statements.some((s) => s.lines.some((l) => l.prob)) && <a className="btn sm pri" href="/banka/pregled" title="Сите непрокнижени ставки од сите изводи на фирмата, по сигурност, со причина">✓ Преглед за книжење</a>}
        </span>
      </div>
      {!write && <div className="callout">🔒 Само преглед – немате право на внес. Контата и комитентите не може да се менуваат.</div>}
      {manual && (() => {
        const s0 = statements.find((s) => s.id === manual);
        const open = statements.filter((s) => s.acctId && !s.locked);
        const accts = [...new Map(open.map((s) => [s.acctId!, { id: s.acctId!, label: s.acct, konto: s.bankKonto, cur: s.cur }])).values()];
        return (
          <BankManualEntry chart={chart} partners={partners} accounts={accts} onClose={() => setManual(null)}
            statements={open.map((s) => ({ id: s.id, acct: s.acctId!, no: s.number, date: s.date, lines: s.lines.length, net: Math.round(s.lines.reduce((x, l) => x + (s.fx ? l.amountCur ?? 0 : l.amount), 0) * 100) / 100 }))}
            initial={{ acct: s0?.acctId ?? '', date: s0?.date ?? '', stNo: s0?.number ?? '' }} />
        );
      })()}
      {msg && <div className={`callout ${msg.error ? 'bad' : 'good'}`} role={msg.error ? 'alert' : 'status'}>{msg.error ?? msg.ok}</div>}
      {statements.map((s) => {
        const ro = !write || !!s.locked;
        const isOpen = open.has(s.id);
        const av = (l: PanelLine) => (s.fx ? l.amountCur ?? 0 : l.amount);
        const pr = s.lines.filter((l) => av(l) > 0).reduce((x, l) => x + av(l), 0);
        const od = s.lines.filter((l) => av(l) < 0).reduce((x, l) => x - av(l), 0);
        const probs = s.lines.filter((l) => l.prob).length;
        const ready = s.lines.filter((l) => l.prob && l.sugg?.ok).length;
        const diff = s.opening != null && s.closing != null ? Math.round((s.opening + pr - od - s.closing) * 100) / 100 : null;
        return (
          <div key={s.id} className="izv-nal" style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn sm ghost" aria-expanded={isOpen} onClick={() => setOpen((O) => { const n = new Set(O); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}>{isOpen ? '▾' : '▸'}</button>
              <b>Извод бр. {s.number || '—'}</b> од {dmy(s.date)} · {s.acct} · конто {s.bankKonto} · {s.lines.length} ставки
              {' '}· прилив <b>{fmt(pr)}</b> · одлив <b>{fmt(od)}</b>{s.fx ? ` ${s.cur}` : ''}
              {diff == null ? <span className="pill">внесете салда</span> : Math.abs(diff) < 0.01 ? <span className="pill good" title="Почетно + прилив − одлив = ново салдо">✓ салдо</span>
                : <span className="pill bad" title="Почетно + прилив − одлив ≠ ново салдо">⚠ разлика {fmt(diff)}</span>}
              {s.status === 'posted' ? <span className="pill good">прокнижен</span> : <span className="pill warn">{probs} за книжење</span>}
              {s.locked && <span className="pill">🔒 {s.locked}</span>}
              {write && !s.locked && s.acctId && <button type="button" className="btn sm ghost" onClick={() => setManual(s.id)} title="Нова ставка во овој извод (F9 = зачувај и следна)">✍️ Рачна ставка</button>}
            </div>
            {isOpen && (
              <>
                <BankForm action={updateStatementAction} className="row" style={{ gap: 6, alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' }}>
                  <input type="hidden" name="st" value={s.id} />
                  <label className="mini" htmlFor={`nz-no-${s.id}`}>Извод бр.</label>
                  <input id={`nz-no-${s.id}`} name="number" defaultValue={s.number} style={{ width: 70, padding: '2px 6px' }} disabled={ro} />
                  <label className="mini" htmlFor={`nz-o-${s.id}`}>Салдо по банка: почетно</label>
                  <input id={`nz-o-${s.id}`} name="opening" defaultValue={n2(s.opening)} inputMode="decimal" style={{ width: 110, padding: '2px 6px', textAlign: 'right' }} disabled={ro} />
                  <label className="mini" htmlFor={`nz-c-${s.id}`}>ново</label>
                  <input id={`nz-c-${s.id}`} name="closing" defaultValue={n2(s.closing)} inputMode="decimal" style={{ width: 110, padding: '2px 6px', textAlign: 'right' }} disabled={ro} />
                  {!ro && <button className="btn sm">Зачувај</button>}
                </BankForm>
                {s.locked && <div className="callout">🔒 {s.locked} – изводот е само за преглед.</div>}
                {!ro && probs > 0 && (
                  <BankForm action={bookAllAction} className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 4 }}
                    confirm={`Да се прокнижат ${ready} ставки по предлогот? Ставките без предлог остануваат за рачно книжење.`}>
                    <input type="hidden" name="st" value={s.id} />
                    <button className="btn sm pri" disabled={!ready}>✓ Прокнижи ги сите по предлогот ({ready}/{probs})</button>
                  </BankForm>
                )}
                <div className="tw"><table className="dense fit">
                  <thead><tr><th>Датум</th><th>Комитент (налогодавач)</th><th style={{ minWidth: 200 }}>Цел / опис</th><th className="n amt-od" title="должува по изводот">Одлив</th><th className="n amt-pr" title="побарува по изводот">Прилив</th><th>Шифра</th><th></th></tr></thead>
                  <tbody>{s.lines.map((l) => {
                    const e = cur(l);
                    const k = e.konto.trim().split(/\s/)[0] ?? '';
                    const d = dirty(l);
                    const a = av(l);
                    const pk = PK.test(k);
                    // a partner preselected from the statement (not saved yet)
                    const pre = !ro && !d && pk && !l.partnerId && !!e.partnerId;
                    const ws = wrongSideWarning(k, a, l.linked);
                    return [
                      <tr key={l.id} className="izv-l1" style={d ? { background: 'var(--warn-bg, #fff7e0)' } : undefined}>
                        <td style={{ whiteSpace: 'nowrap' }}>{dmy(l.date)}</td>
                        <td>{l.name}</td>
                        <td>{l.purpose}{l.manual && <span className="pill"> рачно</span>}{l.prob && <> <span className="pill bad">{l.prob}</span></>}</td>
                        {/* the bank's order: одлив (должува) left, прилив (побарува) right */}
                        <td className="n amt-od">{a < 0 ? fmt(-a) : ''}</td><td className="n amt-pr">{a > 0 ? fmt(a) : ''}</td>
                        <td>{l.osnov}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {!ro && (d || pre) && <button type="button" className="btn sm pri" disabled={pending} onClick={() => saveLine(l)} title="Зачувај и прекнижи го изводот">✓</button>}
                          {!ro && (
                            <details className="rowmenu" style={{ display: 'inline-block', position: 'relative' }}>
                              <summary className="btn sm ghost" aria-label="Мени на ставката" style={{ listStyle: 'none' }}>⋮</summary>
                              <div className="card" style={{ position: 'absolute', right: 0, zIndex: 20, padding: 6, display: 'grid', gap: 4, minWidth: 210 }}>
                                {flip && <button type="button" className="btn sm" disabled={pending} onClick={() => { if (window.confirm('Да се промени насоката на ставката (прилив ↔ одлив)?')) run(() => flipLineAction(l.id)); }}>⇅ Промени насока</button>}
                                <button type="button" className="btn sm" disabled={pending || !k || (l.linked && k === origK(l))} title="Контото се памети за овој опис / шифра на плаќање" onClick={() => saveLine(l, true)}>🧠 Запомни правило ({k || '—'})</button>
                                {(l.konto || l.linked) && <button type="button" className="btn sm" disabled={pending} onClick={() => run(() => unlinkLineAction(l.id))}>↺ Врати во непрокнижено</button>}
                                {del && <button type="button" className="btn sm danger" disabled={pending} onClick={() => { if (window.confirm(`Да се избрише ставката „${(l.purpose || l.name).slice(0, 60)}“? Изводот се прекнижува.`)) run(() => deleteLineAction(l.id)); }}>🗑 Избриши ставка</button>}
                              </div>
                            </details>
                          )}
                        </td>
                      </tr>,
                      // the posting controls on their own full-width line under the description (no horizontal scroll)
                      <tr key={l.id + '-k'} className="izv-l2" style={d ? { background: 'var(--warn-bg, #fff7e0)' } : undefined}>
                        <td></td>
                        <td colSpan={6} style={{ borderTop: 'none', paddingTop: 0 }}>
                          <div className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                            <span style={{ minWidth: 200, maxWidth: 420 }}>
                              <span className="mini">Конто </span>
                              {ro ? <b className="num">{origK(l) || '—'}</b> : (
                                <input list="nalBkK2" value={e.konto} aria-label="Конто" placeholder={l.sugg?.konto || 'конто'}
                                  onChange={(ev) => { const v = ev.target.value; const nk = v.trim().split(/\s/)[0] ?? ''; setEdit(l, PK.test(nk) ? { konto: v } : { konto: v, partnerId: '' }); }}
                                  onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); if (d) saveLine(l); } }}
                                  style={{ width: 100, ...(!k && l.prob ? { borderColor: 'var(--bad)' } : {}) }} />
                              )}
                              {!ro && !k && l.sugg?.konto && <button type="button" className="btn sm ghost" title={l.sugg.why} onClick={() => setEdit(l, { konto: l.sugg!.konto, partnerId: PK.test(l.sugg!.konto) ? l.sugg!.partnerId || e.partnerId : '' })}>← {l.sugg.konto}</button>}
                              {k ? <KontoHintNote chart={chartRows} value={k} onPick={(c) => setEdit(l, { konto: c })} /> : <small className="mut" style={{ display: 'block' }}>{l.sugg?.why ?? ''}</small>}
                            </span>
                            <span style={{ flex: '1 1 300px', minWidth: 260, maxWidth: 480 }}>
                              {pk ? (ro ? <><span className="mini">Комитент </span>{pLabel(e.partnerId)}</> : (
                                <PartnerPicker key={`${l.partnerId}-${gen}`} partners={partners} value={e.partnerId} invalid placeholder={l.newPartner ? `нов: ${l.newPartner} – или пребарај` : undefined}
                                  onChange={(pid) => setEdit(l, { partnerId: pid })} />
                              )) : e.partnerId ? <span className="mut">{pLabel(e.partnerId)}</span> : null}
                              {pre && <small className="mut" style={{ display: 'block' }}>комитентот е препознаен од изводот – потврдете со ✓</small>}
                            </span>
                            <span>
                              {l.linked && <span className="pill good">{l.refType === 'invoice' ? 'Наша ф-ра' : 'Влезна ф-ра'} {l.refLabel || 'без број'}</span>}
                              {!ro && <button type="button" className="btn sm ghost" title="Поврзи со отворена фактура" onClick={() => openPicker(l)}>🔗 фактура</button>}
                              {ws && <span className="pill bad" title={a > 0 ? 'Прилив од купувач се книжи на 1200' : 'Плаќање на добавувач се книжи на 2200'}>⚠ {ws}</span>}
                            </span>
                          </div>
                        </td>
                      </tr>,
                      picker?.line === l.id && (
                        <tr key={l.id + '-pick'}><td colSpan={7}>
                          {picker.error ? <div className="callout bad">{picker.error}</div> : !picker.docs ? <span className="note">се вчитуваат отворените фактури…</span>
                            : picker.docs.length ? (
                              <BankForm action={async (p, f) => { const r = await linkLineAction(p, f); if (!r.error) setPicker(null); return r; }}>
                                <input type="hidden" name="line" value={l.id} />
                                <div className="tw" style={{ maxHeight: 260 }}><table className="dense">
                                  <thead><tr><th></th><th>Број</th><th>Датум</th><th>Комитент</th><th>Конто</th><th className="n">Отворено</th></tr></thead>
                                  <tbody>{picker.docs.map((x) => (
                                    <tr key={x.id}>
                                      <td><input type="checkbox" name="doc" value={x.id} defaultChecked={x.fifo} aria-label="Избери" /></td>
                                      <td>{x.number || <i className="mut">без број</i>}</td><td>{dmy(x.date)}</td><td>{x.partnerId ? pLabel(x.partnerId) : ''}</td><td>{x.konto}</td>
                                      <td className="n">{fmt(x.open)}</td>
                                    </tr>
                                  ))}</tbody>
                                </table></div>
                                <div className="row"><span className="note">Предложени се најстарите до износот. Вишокот останува аванс кај комитентот.</span><span style={{ flex: 1 }} />
                                  <button type="button" className="btn" onClick={() => setPicker(null)}>Затвори</button><button className="btn pri">Поврзи</button></div>
                              </BankForm>
                            ) : <div className="row"><span className="note">Нема отворени фактури за оваа ставка.</span><button type="button" className="btn sm" onClick={() => setPicker(null)}>Затвори</button></div>}
                        </td></tr>
                      ),
                    ];
                  })}</tbody>
                </table></div>
              </>
            )}
          </div>
        );
      })}
      {dirtyLines.length > 0 && <div style={{ marginTop: 8 }}>{saveBar}</div>}
      <p className="note">Промената на конто / комитент ја прекнижува само изменетата ставка – рачно поставените ставки остануваат како што се. Налогот подолу се освежува веднаш. Поставките на банката (сметки, правила, конта) се во „Изводи“.</p>
    </div>
  );
}
