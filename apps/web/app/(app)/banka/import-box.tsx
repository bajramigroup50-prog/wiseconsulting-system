'use client';
/**
 * Statement upload (legacy `#bankFile` + `importBankFile`): choose files → preview (accounts, statement numbers,
 * duplicates, automatic classification) → save. XML, MT940, KB `.300`, CSV and Excel are read on the server.
 */
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { fmt, dmy } from '@/lib/fmt';
import { uploadFile } from '@/lib/upload';
import { UploadTarget } from '@/components/firm-guard';
import { aiReadStatus, startAiRead } from '@/app/(app)/_ai/actions';
import { previewImportAction, previewNalogImportAction, saveImportAction, saveNalogImportAction, type NalogPreviewResult } from './actions';

/** Import inside a nalog (Налози → ИЗВОДИ): the statements are booked and posted into this nalog. */
export interface NalogTarget {
  /** Nalog number; null = the bank series number of the statement's period („+ Нов налог – изводи“). */
  number: string | null;
  /** Id of the opened nalog when it is empty (offered for removal when the statement belongs to another period). */
  emptyId?: string | null;
  /** Chart for the editable counter kontos. */
  chart: [string, string][];
  partners: { id: string; name: string }[];
}
type LK = { konto: string; partnerId?: string | null; createPartner?: string | null };

const CLS: Record<string, string> = { pos: 'POS картички', conv: 'откуп на девизи', own: 'пренос меѓу свои сметки', fee: 'провизија', tech: 'посебна сметка' };

/** PDF / image statements are read by the AI job (legacy `importBankImg`); everything else is parsed on the server. */
const isAiFile = (f: File) => /\.(pdf|jpe?g|png|webp)$/i.test(f.name) || /^image\/|pdf/.test(f.type);

/**
 * Legacy 4789 / 4792: an Excel / CSV / TXT whose columns are not recognised is read automatically (AI). Excel is
 * converted to CSV text in the browser (the reader takes text, PDF and images).
 */
async function asAiFile(f: File): Promise<File> {
  if (!/\.(xlsx|xls)$/i.test(f.name)) return f;
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array', cellDates: true });
  const csv = wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n]!, { FS: ';' })).join('\n\n');
  return new File([csv], f.name.replace(/\.(xlsx|xls)$/i, '.csv'), { type: 'text/csv' });
}

/** Upload the PDF / image statements, start the reads and wait for them (legacy: „10–60 секунди“). */
async function readAiStatements(L: File[], firmId: string, note: (m: string) => void, all = false): Promise<{ ids: string[]; error?: string }> {
  const ids: string[] = L.map(() => '');
  const up: { i: number; id: string }[] = [];
  for (const [i, f0] of L.entries()) {
    if (!all && !isAiFile(f0)) continue;
    const f = all ? await asAiFile(f0) : f0;
    note(`Се прикачува „${f.name}“…`);
    const r = await uploadFile(f, firmId);
    if (!r.ok) return { ids, error: `„${f.name}“: ${r.error}` };
    up.push({ i, id: r.id });
  }
  if (!up.length) return { ids };
  const s = await startAiRead({ kind: 'bank', fileIds: up.map((x) => x.id) });
  if (s.error || !s.ids) return { ids, error: s.error ?? 'Изводот не е прочитан.' };
  s.ids.forEach((id, k) => { ids[up[k]!.i] = id; });
  note('Се чита изводот… (10–60 секунди)');
  for (let t = 0; t < 120; t++) {
    await new Promise((ok) => setTimeout(ok, 2500));
    const S = await aiReadStatus(s.ids);
    const bad = S.find((x) => x.status === 'error');
    if (bad) return { ids, error: 'Изводот не е прочитан: ' + (bad.error || '') };
    if (S.length === s.ids.length && S.every((x) => x.status === 'done' || x.status === 'saved')) return { ids };
  }
  return { ids, error: 'Читањето трае предолго – обидете се повторно.' };
}

export function ImportBox({ accounts, defaultAcct, fx, firmId, nalog }: { accounts: { id: string; label: string }[]; defaultAcct: string; fx: boolean; firmId: string; nalog?: NalogTarget }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [aiIds, setAiIds] = useState<string[]>([]);
  const [acct, setAcct] = useState(defaultAcct);
  const [dups, setDups] = useState(false);
  const [replace, setReplace] = useState(false);
  const [prev, setPrev] = useState<NalogPreviewResult | null>(null);
  /** Edited counter konto per file and preview line (`day:index`). */
  const [lk, setLk] = useState<Record<string, LK>[]>([]);
  const [periodErr, setPeriodErr] = useState(false);
  const kName = new Map(nalog?.chart ?? []);
  const pName = new Map((nalog?.partners ?? []).map((p) => [p.id, p.name]));
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();

  const formOf = (L: File[], ids: string[]) => {
    const f = new FormData();
    // AI-read files are not sent again: the server uses the stored read (`aiDoc`, same index as the file)
    for (const [i, x] of L.entries()) { f.append('file', ids[i] ? new File([], x.name) : x); f.append('aiDoc', ids[i] ?? ''); }
    f.set('acct', acct);
    return f;
  };
  const form = () => {
    const f = formOf(files, aiIds);
    if (dups) f.set('dups', 'on');
    if (replace) f.set('replace', 'on');
    return f;
  };
  const preview = (L: File[], all = false) => {
    setFiles(L);
    setMsg({});
    setAiIds([]);
    setReplace(false);
    if (!L.length) { setPrev(null); return; }
    start(async () => {
      const a = await readAiStatements(L, firmId, setNote, all);
      setNote('');
      if (a.error) { setPrev({ error: a.error }); return; }
      setAiIds(a.ids);
      const r: NalogPreviewResult = nalog ? await previewNalogImportAction(formOf(L, a.ids)) : await previewImportAction(formOf(L, a.ids));
      setPeriodErr(false);
      setLk(r.sugg?.map((S) => Object.fromEntries(Object.entries(S).map(([k, x]) => [k, { konto: x.konto, partnerId: x.partnerId ?? null, createPartner: x.newPartner ?? null }]))) ?? []);
      setPrev(r);
    });
  };
  const saveNalog = (number: string | null, dropEmpty?: string | null) => start(async () => {
    const f = form();
    f.set('nalog', number ?? '');
    if (dropEmpty) f.set('dropEmpty', dropEmpty);
    f.set('kontos', JSON.stringify(lk));
    const r = await saveNalogImportAction(f);
    setMsg(r);
    setPeriodErr(!!r.period);
    if (!r.error) { setFiles([]); setPrev(null); if (ref.current) ref.current.value = ''; if (r.number) router.push(`/nalozi?n=${encodeURIComponent(r.number)}`); router.refresh(); }
  });
  const save = () => nalog ? saveNalog(nalog.number) : start(async () => {
    const r = await saveImportAction(form());
    setMsg(r);
    // legacy 4761 / 4782 / 4807: after the import the remaining lines are matched automatically → the review
    if (!r.error) { setFiles([]); setPrev(null); if (ref.current) ref.current.value = ''; router.push(window.location.pathname + '?review=1'); router.refresh(); }
  });

  return (
    <div>
      <h2>{nalog ? (nalog.number ? `📥 Увези извод во налог ${nalog.number}` : '📥 Увези извод – нов налог') : 'Увоз на извод од е-банкарство'}</h2>
      {nalog && <p className="note">Изводот се чита (PDF / Excel / XML), се проверуваат салдата (почетно + приливи − одливи = ново салдо), а секоја ставка добива предлог за спротивно конто (шифра на плаќање 840 данок, 843 придонеси, провизии, правила, фактури, комитенти) што може да го смените пред книжење. Налогот се датира според изводот.</p>}
      {/* where the statements go — always in view (statements imported into the wrong firm) */}
      <UploadTarget />
      <p className="note">Секој формат што го нуди банката: <b>XML</b> (Халк, ISO camt.053), <b>MT940</b>, <b>Комерцијална .300</b>, <b>Excel</b>, <b>CSV/TXT</b>,
        а и <b>PDF извод или слика / скен</b> – се чита автоматски со AI (10–60 секунди).
        Најцелосен е XML од е-банкарството (комитент, цел на дознака, шифра, денарска противвредност, салда).
        {fx && ' Девизните износи се пресметуваат по курсот од курсната листа на датумот на изводот (може да се промени кај изводот).'}</p>
      <div className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="f" style={{ minWidth: 260 }}>{fx ? 'Девизна сметка' : 'Банкарска сметка'} (ако датотеката не ја наведува)
          <select value={acct} onChange={(e) => setAcct(e.target.value)}>
            {!accounts.length && <option value="">— сметката од изводот (се отвора автоматски) —</option>}
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
        <label className="f">Датотека од е-банкарство (XML, MT940, .300, Excel, CSV)
          <input ref={ref} type="file" multiple accept=".xml,.xls,.xlsx,.csv,.txt,.sta,.940,.mt940,.swi,.300,.pdf,.jpg,.jpeg,.png,.webp" disabled={pending}
            onChange={(e) => preview(Array.from(e.target.files ?? []))} />
        </label>

        {pending && <span className="note">{note || 'Се чита…'}</span>}
      </div>
      {/* legacy drop zone: drag the statement (PDF / photo / XML / Excel) here or click */}
      <div className="drop" role="button" tabIndex={0} style={{ marginTop: 10, opacity: pending ? 0.6 : 1 }}
        onClick={() => !pending && ref.current?.click()}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !pending) ref.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onDragLeave={(e) => { e.currentTarget.style.borderColor = ''; }}
        onDrop={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = ''; if (!pending) preview(Array.from(e.dataTransfer.files)); }}>
        Повлечете го изводот тука (PDF, слика, XML, MT940, Excel), или кликнете за да го изберете<br />
        <small>PDF и слики се читаат автоматски со AI (PDF со текст и без AI) · оригиналот се чува прикачен на изводот за евиденција</small>
      </div>
      <p className="mini" style={{ margin: '4px 0 0' }}>Excel/CSV со непознати колони или без AI: <a href="/konvertor?t=bank" target="_blank" rel="noreferrer">🔄 Конвертор на датотеки</a> → Excel за увоз.</p>
      {msg.ok && <div className="callout good" role="status">{msg.ok}</div>}
      {nalog && <datalist id="nalImpK">{nalog.chart.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</datalist>}
      {(msg.error || prev?.error) && <div className="callout bad" role="alert">{msg.error || prev?.error}
        {periodErr && nalog && <> <button type="button" className="btn sm pri" disabled={pending} onClick={() => saveNalog(null, nalog.emptyId)}>{nalog.emptyId ? 'Прокнижи во налогот за периодот на изводот и избриши го празниот налог' : 'Прокнижи во налогот за периодот на изводот'}</button></>}
        {/колоните|форматот не е препознаен/.test(prev?.error ?? '') && files.length > 0 && <> <button type="button" className="btn sm pri" disabled={pending} onClick={() => preview(files, true)}>Прочитај го автоматски (AI)</button></>}</div>}
      {prev?.plans && (
        <div className="card" style={{ borderColor: 'var(--accent)', marginTop: 8 }}>
          {prev.plans.map((p) => (
            <div key={p.file}>
              <h3 style={{ margin: '4px 0' }}>{p.file} <span className="pill">{p.format}</span></h3>
              {p.plan.errors.map((e) => <div key={e} className="callout bad">{e}</div>)}
              {p.plan.warnings.map((w) => <div key={w} className="callout warn">{w}</div>)}
              {p.plan.days.map((d) => (
                <div key={d.accountId + d.date} className="tw"><table className="dense">
                  <thead>
                    <tr className="sub"><td colSpan={5}><b>{d.accountName}</b> · Извод бр. {d.no || '—'} од {dmy(d.date)} · {d.lines.length} ставки
                      {d.existingId && <span className="pill warn">се додава на постоечки извод</span>}
                      {d.allDup && <span className="pill bad">веќе увезен</span>}
                      {d.rate != null && <> · курс {d.rate}</>}
                      {d.opening != null && <> · салдо {fmt(d.opening / 100)} → {fmt((d.closing ?? 0) / 100)} {d.cur}</>}
                      {d.statedDebit != null && <> · по изводот должува {fmt((d.statedDebit ?? 0) / 100)} / побарува {fmt((d.statedCredit ?? 0) / 100)}</>}</td></tr>
                    <tr><th>Датум</th><th>Опис</th><th className="n">Прилив</th><th className="n">Одлив</th><th>Препознаено</th>{nalog && <th>Спротивно конто (предлог)</th>}</tr>
                  </thead>
                  <tbody>{d.lines.map((l, i) => (
                    <tr key={i} style={l.dup ? { opacity: 0.5 } : undefined}>
                      <td>{dmy(l.date)}</td><td>{l.desc}</td>
                      <td className="n">{l.amount > 0 ? fmt(l.amount / 100) : ''}{l.amountCur != null && l.amount > 0 ? <><br /><small className="note">{d.cur} {fmt(l.amountCur / 100)}</small></> : null}</td>
                      <td className="n">{l.amount < 0 ? fmt(-l.amount / 100) : ''}{l.amountCur != null && l.amount < 0 ? <><br /><small className="note">{d.cur} {fmt(-l.amountCur / 100)}</small></> : null}</td>
                      <td>{l.dup && <span className="pill bad">дупликат</span>} {l.cls && <span className="pill info">{CLS[l.cls] ?? l.cls}{l.konto ? ' → ' + l.konto : ''}</span>}
                        {l.newPartner && <span className="pill warn" title="Комитентот не постои – ќе може да се додаде при книжењето">нов комитент: {l.newPartner}</span>}</td>
                      {nalog && (() => {
                        const fi = prev.plans!.indexOf(p), key = `${p.plan.days.indexOf(d)}:${i}`;
                        const s = prev.sugg?.[fi]?.[key];
                        const cur = lk[fi]?.[key];
                        if (l.dup) return <td />;
                        const set = (konto: string) => setLk((A) => { const B = A.slice(); B[fi] = { ...(B[fi] ?? {}), [key]: { ...(cur ?? {}), konto, ...(s && konto === s.konto ? { partnerId: s.partnerId ?? null, createPartner: s.newPartner ?? null } : { partnerId: null, createPartner: null }) } }; return B; });
                        return (
                          <td style={{ minWidth: 220 }}>
                            <input list="nalImpK" value={cur?.konto ?? ''} onChange={(e) => set(e.target.value.trim().split(/\s/)[0] ?? '')} placeholder="конто"
                              style={{ width: 90, ...(!cur?.konto || s?.missing ? { borderColor: 'var(--bad)' } : {}) }} aria-label="Спротивно конто" />
                            {' '}<small>{cur?.konto ? kName.get(cur.konto) ?? <span style={{ color: 'var(--bad)' }}>непознато конто</span> : ''}</small>
                            {cur?.partnerId && <><br /><small className="mini">{pName.get(cur.partnerId) ?? ''}</small></>}
                            {cur?.createPartner && !cur.partnerId && <><br /><small className="mini">нов комитент: {cur.createPartner}</small></>}
                            {s && <><br /><small className={s.missing || !s.konto ? '' : 'note'} style={s.missing || !s.konto ? { color: 'var(--bad)' } : undefined}>{s.why}</small></>}
                          </td>
                        );
                      })()}
                    </tr>
                  ))}</tbody>
                </table></div>
              ))}
            </div>
          ))}
          <div className="row" style={{ gap: 10, marginTop: 8 }}>
            <label className="chk"><input type="checkbox" checked={dups} onChange={(e) => setDups(e.target.checked)} /> увези ги и дупликатите</label>
            {prev.plans.some((p) => p.plan.days.some((d) => d.existingId && !d.allDup)) && (
              <label className="chk" title="Истиот извод е веќе увезен (на пр. во друг формат)"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> замени ги старите ставки на постоечките изводи (инаку новите се додаваат)</label>
            )}
            <span style={{ flex: 1 }} />
            <button className="btn" type="button" onClick={() => preview([])} disabled={pending}>Откажи</button>
            <button className="btn pri" type="button" onClick={save} disabled={pending || prev.plans.some((p) => p.plan.errors.length > 0)}>{nalog ? (nalog.number ? 'Прокнижи во овој налог' : 'Прокнижи во нов налог') : 'Зачувај и прокнижи'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
