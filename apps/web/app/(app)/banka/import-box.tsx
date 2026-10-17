'use client';
/**
 * Statement upload (legacy `#bankFile` + `importBankFile`): choose files → preview (accounts, statement numbers,
 * duplicates, automatic classification) → save. XML, MT940, KB `.300`, CSV and Excel are read on the server.
 * Many files at once (144 НЛБ PDFs): read with progress and no fixed time limit (`ai-batch.ts`), a file read before
 * is not read again, a file that fails is listed and skipped, preview and save go in parts; reads that were never
 * imported stay on the server and are offered again („📄 Прочитани изводи што чекаат увоз“).
 */
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { fmt, dmy } from '@/lib/fmt';
import { uploadFile } from '@/lib/upload';
import { UploadTarget } from '@/components/firm-guard';
import { Uvoz } from '@/components/uvoz';

const BANK_ACCEPT = '.xml,.xls,.xlsx,.csv,.txt,.sta,.940,.mt940,.swi,.300,.pdf,.jpg,.jpeg,.png,.webp';
import { aiReadStatus, startAiRead } from '@/app/(app)/_ai/actions';
import {
  createStatementAccountAction, dismissBankReadsAction, linkStatementAccountAction, pendingBankReadsAction, previewImportAction, previewNalogImportAction,
  saveImportAction, saveNalogImportAction, type FailedFile, type NalogPreviewResult, type PendingBankReads,
} from './actions';
import { safeAction } from '@/lib/version';
import { progressText, readBatch, type BatchDeps } from './ai-batch';

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

const CLS: Record<string, string> = { pos: 'POS картички', conv: 'откуп на девизи', own: 'пренос меѓу свои сметки', fee: 'провизија', tech: 'посебна сметка', turnover: 'дневен промет', cash: 'подигање готовина', card: 'платежна картичка' };

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

/** The browser side of a batch read: presigned upload (deduplicated by sha256), reads reused by content, polling. */
const batchDeps = (firmId: string): BatchDeps => ({
  upload: async (f) => { const r = await uploadFile(f, firmId); return r.ok ? { ok: true, id: r.id } : { ok: false, error: r.error }; },
  start: (fileIds) => safeAction(() => startAiRead({ kind: 'bank', fileIds, reuse: true })),
  status: (ids) => aiReadStatus(ids),
  sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)),
});

/** Files per preview / save call (a batch of 144 statements goes in parts, with progress). */
const PREVIEW_CHUNK = 20;
const SAVE_CHUNK = 10;
const parts = <T,>(L: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(L.length / n) }, (_, i) => L.slice(i * n, i * n + n));

type Proposal = NonNullable<NonNullable<PreviewResult['plans']>[number]['plan']['accountProposals']>[number];
type PreviewResult = NalogPreviewResult;
type Problem = { file: string; error: string };

export function ImportBox({ accounts, defaultAcct, fx, firmId, nalog }: { accounts: { id: string; label: string }[]; defaultAcct: string; fx: boolean; firmId: string; nalog?: NalogTarget }) {
  const router = useRouter();

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
  /** Files of the batch that were not read / previewed / saved, with the reason (the others went on). */
  const [problems, setProblems] = useState<Problem[]>([]);
  /** Reads done on the server but never imported (closed page, restart): offered again. */
  const [waiting, setWaiting] = useState<PendingBankReads | null>(null);
  /** Reading a batch: „Продолжи со прочитаните“ stops the wait (the rest keeps reading on the server). */
  const [reading, setReading] = useState(false);
  const stop = useRef(false);

  const loadWaiting = () => { pendingBankReadsAction().then(setWaiting, () => {}); };
  useEffect(loadWaiting, []);

  const formOf = (L: File[], ids: string[]) => {
    const f = new FormData();
    // AI-read files are not sent again: the server uses the stored read (`aiDoc`, same index as the file)
    for (const [i, x] of L.entries()) { f.append('file', ids[i] ? new File([], x.name) : x); f.append('aiDoc', ids[i] ?? ''); }
    f.set('acct', acct);
    return f;
  };
  const lkOf = (sugg: NalogPreviewResult['sugg']) => sugg?.map((S) => Object.fromEntries(Object.entries(S).map(([k, x]) => [k, { konto: x.konto, partnerId: x.partnerId ?? null, createPartner: x.newPartner ?? null }]))) ?? [];
  /**
   * Read (when needed) and preview the files. `preset` = the read ids are known (reads waiting for import, a new
   * preview after linking an account): nothing is uploaded or read again.
   */
  const preview = (L: File[], all = false, preset?: string[]) => {
    setFiles(L);
    setMsg({});
    setAiIds([]);
    setReplace(false);
    setProblems([]);
    if (!L.length) { setPrev(null); return; }
    stop.current = false;
    start(async () => {
      const probs: Problem[] = [];
      let ids: string[];
      let keep: number[];
      if (preset) { ids = preset; keep = L.map((_, i) => i); }
      else {
        const take = (f: File) => all || isAiFile(f);
        setReading(true);
        const r = await readBatch(L, take, batchDeps(firmId), { progress: (p) => setNote(progressText(p)), stop: () => stop.current, ...(all ? { prep: asAiFile } : {}) });
        setReading(false);
        ids = r.ids;
        probs.push(...r.errors.map((e) => ({ file: e.name, error: e.error })));
        if (r.waiting) probs.push({ file: `${r.waiting} датотеки`, error: 'сè уште се читаат – ќе се појават во „Прочитани изводи што чекаат увоз“ кога ќе бидат готови.' });
        keep = L.map((f, i) => (!take(f) || (ids[i] && r.done[i]) ? i : -1)).filter((i) => i >= 0);
      }
      // preview in parts; a file that cannot be read is listed and left out
      const plans: NonNullable<PreviewResult['plans']> = [];
      const sugg: NonNullable<PreviewResult['sugg']> = [];
      const F: File[] = [], I: string[] = [];
      let n = 0;
      let lastErr = '';
      for (const C of parts(keep, PREVIEW_CHUNK)) {
        if (keep.length > PREVIEW_CHUNK) setNote(`Преглед ${n} / ${keep.length}…`);
        const r: NalogPreviewResult = await (nalog ? previewNalogImportAction : previewImportAction)(formOf(C.map((i) => L[i]!), C.map((i) => ids[i] ?? '')));
        n += C.length;
        probs.push(...(r.skipped ?? []));
        if (!r.plans) { lastErr = r.error ?? 'Грешка при читање.'; if (keep.length > 1) probs.push(...C.map((i) => ({ file: L[i]!.name, error: lastErr }))); continue; }
        r.plans.forEach((p, k) => {
          const i = C[p.i ?? k]!;
          plans.push(p); sugg.push(r.sugg?.[k] ?? {}); F.push(L[i]!); I.push(ids[i] ?? '');
        });
        if (r.error) lastErr = r.error;
      }
      setNote('');
      setPeriodErr(false);
      setProblems(probs);
      if (!plans.length) { setPrev({ error: keep.length === 1 && lastErr ? lastErr : probs.length ? 'Ниеден извод не е прочитан – видете ги причините подолу.' : lastErr || 'Изберете датотека.' }); return; }
      setFiles(F);
      setAiIds(I);
      setLk(lkOf(nalog ? sugg : undefined));
      setPrev({ plans, ...(nalog ? { sugg } : {}) });
    });
  };
  /** Save the previewed files without errors, in parts; the files that fail stay (with the reason) for another try. */
  const saveAll = (number: string | null | undefined, dropEmpty?: string | null) => start(async () => {
    if (!prev?.plans) return;
    const items = prev.plans.map((p, k) => ({ k, f: files[k]!, id: aiIds[k] ?? '', lk: lk[k] ?? {}, bad: p.plan.errors.length > 0 })).filter((x) => !x.bad);
    const ok: string[] = [];
    const failed: (FailedFile & { k: number })[] = [];
    let num = '';
    let done = 0;
    for (const C of parts(items, SAVE_CHUNK)) {
      if (items.length > SAVE_CHUNK) setNote(`Се книжат ${done} / ${items.length}…`);
      const f = formOf(C.map((x) => x.f), C.map((x) => x.id));
      if (dups) f.set('dups', 'on');
      if (replace) f.set('replace', 'on');
      let r: { ok?: string; error?: string; failed?: FailedFile[]; number?: string };
      if (nalog) {
        f.set('nalog', number ?? '');
        if (dropEmpty) f.set('dropEmpty', dropEmpty);
        f.set('kontos', JSON.stringify(C.map((x) => x.lk)));
        r = await saveNalogImportAction(f);
      } else r = await saveImportAction(f);
      done += C.length;
      if (r.ok) ok.push(r.ok);
      num ||= r.number ?? '';
      if (r.failed) failed.push(...r.failed.map((x) => ({ ...x, k: C[x.i ?? 0]!.k })));
      else if (r.error) failed.push(...C.map((x) => ({ file: x.f.name, error: r.error!, k: x.k })));
    }
    setNote('');
    loadWaiting();
    if (failed.length) {
      // keep only the files that failed: a period error offers the statement's own period nalog for them
      const K = new Set(failed.map((x) => x.k));
      const keepIdx = prev.plans.map((_, k) => k).filter((k) => K.has(k));
      const one = items.length === 1;
      setMsg({ ...(ok.length ? { ok: ok.join(' ') } : {}), error: one ? failed[0]!.error : `Не се увезени ${failed.length} датотеки – причините се подолу.` });
      setProblems(one ? [] : failed.map((x) => ({ file: x.file, error: x.error })));
      setPeriodErr(failed.some((x) => x.period));
      setFiles(keepIdx.map((k) => files[k]!));
      setAiIds(keepIdx.map((k) => aiIds[k] ?? ''));
      setLk(keepIdx.map((k) => lk[k] ?? {}));
      setPrev({ plans: keepIdx.map((k) => prev.plans![k]!), ...(prev.sugg ? { sugg: keepIdx.map((k) => prev.sugg![k]!) } : {}) });
      router.refresh();
      return;
    }
    setMsg({ ok: ok.join(' ') });
    setPeriodErr(false);
    setProblems([]);
    setFiles([]); setPrev(null);
    if (nalog) { if (num) router.push(`/nalozi?n=${encodeURIComponent(num)}`); }
    // legacy 4761 / 4782 / 4807: after the import the remaining lines are matched automatically → the review
    else router.push(window.location.pathname + '?review=1');
    router.refresh();
  });
  const saveNalog = (number: string | null, dropEmpty?: string | null) => saveAll(number, dropEmpty);
  const save = () => saveAll(nalog ? nalog.number : undefined);
  /** „📄 Прочитани изводи што чекаат увоз“ → the same preview / save path. */
  const previewWaiting = () => { if (waiting?.items.length) preview(waiting.items.map((x) => new File([], x.name)), false, waiting.items.map((x) => x.id)); };
  const dismissWaiting = () => start(async () => {
    if (!waiting?.items.length || !window.confirm(`Да се отфрлат ${waiting.items.length} прочитани изводи? Нема да се увезат (датотеките остануваат).`)) return;
    setMsg(await dismissBankReadsAction(waiting.items.map((x) => x.id)));
    loadWaiting();
  });
  /** Statement account the firm does not have: fill the number into its numberless account, or open the account. */
  const fixAccount = (p: Proposal) => start(async () => {
    const r = p.link ? await linkStatementAccountAction(p.link.accountId, p.account) : await createStatementAccountAction(p.account);
    setMsg(r);
    if (r.error) return;
    router.refresh();
    // the same files again with the reads already done (nothing is read again)
    const L = files, ids = aiIds;
    setTimeout(() => preview(L, false, ids), 0);
  });
  const proposals = [...new Map((prev?.plans ?? []).flatMap((p) => p.plan.accountProposals ?? []).map((p) => [p.account, p])).values()];
  const okPlans = prev?.plans?.filter((p) => !p.plan.errors.length).length ?? 0;
  const badPlans = (prev?.plans?.length ?? 0) - okPlans;

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
        {pending && <span className="note" role="status">{note || 'Се чита…'}</span>}
        {pending && reading && <button type="button" className="btn sm" onClick={() => { stop.current = true; }} title="Прочитаните се прегледуваат сега; другите продолжуваат да се читаат и ќе се појават подоцна во „Прочитани изводи што чекаат увоз“">Продолжи со прочитаните</button>}
      </div>
      {waiting && (waiting.items.length > 0 || waiting.reading > 0) && !prev?.plans && (
        <div className="callout" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          {waiting.items.length > 0 && <span>📄 <b>Прочитани изводи што чекаат увоз ({waiting.items.length})</b></span>}
          {waiting.reading > 0 && <span className="note">уште {waiting.reading} се читаат</span>}
          {waiting.items.length > 0 && <button type="button" className="btn sm pri" disabled={pending} onClick={previewWaiting}>Прегледај и увези</button>}
          {waiting.items.length > 0 && <button type="button" className="btn sm" disabled={pending} onClick={dismissWaiting}>✕ Отфрли ги</button>}
          {waiting.reading > 0 && <button type="button" className="btn sm" disabled={pending} onClick={loadWaiting}>↻ Освежи</button>}
        </div>
      )}
      {/* UX P6: the shared import zone (drag the statement – PDF / photo / XML / MT940 / Excel – here or click); the
          preview → save flow below is unchanged. Every format is passed on (a КБ file may end in any .NNN). */}
      <Uvoz style={{ marginTop: 10 }} busy={pending} onFiles={(L) => preview(L)} pickerAccept={BANK_ACCEPT}
        label="Повлечете го изводот тука (PDF, слика, XML, MT940, .300, Excel, CSV), или кликнете за да го изберете"
        hint="PDF и слики се читаат автоматски со AI (PDF со текст и без AI) · оригиналот се чува прикачен на изводот за евиденција"
        results={files.map((f) => ({ name: f.name, msg: pending ? 'се чита…' : prev?.plans?.some((p) => p.file === f.name) ? 'прочитан – прегледајте подолу' : '' }))} />
      <p className="mini" style={{ margin: '4px 0 0' }}>Excel/CSV со непознати колони или без AI: <a href="/konvertor?t=bank" target="_blank" rel="noreferrer">🔄 Конвертор на датотеки</a> → Excel за увоз.</p>
      {msg.ok && <div className="callout good" role="status">{msg.ok}</div>}
      {problems.length > 0 && (
        <div className="callout warn" role="alert">
          <b>Прескокнати {problems.length} {problems.length === 1 ? 'датотека' : 'датотеки'}</b> (другите продолжуваат):
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, maxHeight: 220, overflow: 'auto' }}>{problems.map((x, i) => <li key={i}><b>{x.file}</b>: {x.error}</li>)}</ul>
        </div>
      )}
      {nalog && <datalist id="nalImpK">{nalog.chart.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</datalist>}
      {(msg.error || prev?.error) && <div className="callout bad" role="alert">{msg.error || prev?.error}
        {periodErr && nalog && <> <button type="button" className="btn sm pri" disabled={pending} onClick={() => saveNalog(null, nalog.emptyId)}>{nalog.emptyId ? 'Прокнижи во налогот за периодот на изводот и избриши го празниот налог' : 'Прокнижи во налогот за периодот на изводот'}</button></>}
        {/колоните|форматот не е препознаен/.test(prev?.error ?? '') && files.length > 0 && <> <button type="button" className="btn sm pri" disabled={pending} onClick={() => preview(files, true)}>Прочитај го автоматски (AI)</button></>}</div>}
      {prev?.plans && (
        <div className="card" style={{ borderColor: 'var(--accent)', marginTop: 8 }}>
          {prev.plans.length > 1 && <p className="note" style={{ margin: '0 0 6px' }}>{prev.plans.length} датотеки · {prev.plans.reduce((a, p) => a + p.plan.days.length, 0)} изводи{badPlans ? ` · ${badPlans} со грешка (се прескокнуваат)` : ''}</p>}
          {proposals.map((p) => (
            <div key={p.account} className="callout warn" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>Сметката <b>{p.account}</b>{p.bank ? ` (${p.bank})` : ''} од изводот не е меѓу сметките на фирмата.</span>
              {p.link && <button type="button" className="btn sm pri" disabled={pending} onClick={() => fixAccount(p)}>Поврзи ја сметката {p.account} со {p.link.name} ({p.link.konto})</button>}
              {!p.link && p.create && <button type="button" className="btn sm pri" disabled={pending} onClick={() => fixAccount(p)}>Отвори сметка {p.account} – {p.create.name} (конто {p.create.konto})</button>}
            </div>
          ))}
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
                    <tr><th>Датум</th><th>Опис</th><th className="n amt-od" title="должува по изводот">Одлив</th><th className="n amt-pr" title="побарува по изводот">Прилив</th><th>Препознаено</th>{nalog && <th>Спротивно конто (предлог)</th>}</tr>
                  </thead>
                  <tbody>{d.lines.map((l, i) => (
                    <tr key={i} style={l.dup ? { opacity: 0.5 } : undefined}>
                      <td>{dmy(l.date)}</td><td>{l.desc}</td>
                      <td className="n amt-od">{l.amount < 0 ? fmt(-l.amount / 100) : ''}{l.amountCur != null && l.amount < 0 ? <><br /><small className="note">{d.cur} {fmt(-l.amountCur / 100)}</small></> : null}</td>
                      <td className="n amt-pr">{l.amount > 0 ? fmt(l.amount / 100) : ''}{l.amountCur != null && l.amount > 0 ? <><br /><small className="note">{d.cur} {fmt(l.amountCur / 100)}</small></> : null}</td>
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
            <button className="btn pri" type="button" onClick={save} disabled={pending || !okPlans}>{nalog ? (nalog.number ? 'Прокнижи во овој налог' : 'Прокнижи во нов налог') : 'Зачувај и прокнижи'}{badPlans && okPlans ? ` (${okPlans}; ${badPlans} со грешка се прескокнуваат)` : ''}</button>
          </div>
        </div>
      )}
    </div>
  );
}
