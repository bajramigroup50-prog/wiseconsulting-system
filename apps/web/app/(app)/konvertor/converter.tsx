'use client';
/**
 * „🔄 Конвертор на датотеки“ (client): read the source (Excel / CSV / XML in the browser, PDF with text on the
 * server) → header row → mapping per target field (automatic, or a saved preset for this layout) → converted rows
 * with errors → check with the target importer's own parser → download .xlsx and open the target screen.
 */
import { useMemo, useState, useTransition } from 'react';
import { CONV_TARGETS, convApply, convBlocks, convCheck, convGuess, convHeaderRow, convHeads, convPresetFor, convSig, convTarget, convTotals, xmlToGrid, type ConvPreset } from '@wise/core/convert/index';
import { TB_BLOCK_LABEL } from '@wise/core/tb-rows';
import { splitCsv } from '@wise/core/bank-parsers';
import type { DecMode } from '@wise/core/retail/import';
import { xlsxDownload } from '@/components/parity-fin/export-bar';
import { deleteConvPreset, readPdfGrid, saveConvPreset } from './actions';

type Sheets = { name: string; grid: unknown[][] }[];

const fmtN = (n: number) => n.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cellTxt = (v: unknown) => (v instanceof Date ? v.toLocaleDateString('mk-MK') : String(v ?? ''));

async function readSource(f: File): Promise<{ sheets?: Sheets; error?: string }> {
  const nm = f.name.toLowerCase();
  if (/\.(xlsx|xls|xlsm|ods)$/.test(nm)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array', cellDates: true });
    return { sheets: wb.SheetNames.map((n) => ({ name: n, grid: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n]!, { header: 1, raw: true, defval: '' }) })).filter((s) => s.grid.length) };
  }
  if (/\.xml$/.test(nm) || f.type.includes('xml')) {
    const g = xmlToGrid(await f.text());
    return g ? { sheets: [{ name: 'XML', grid: g }] } : { error: 'XML-от не може да се прочита.' };
  }
  if (/\.pdf$/.test(nm) || f.type === 'application/pdf') {
    const fd = new FormData(); fd.set('file', f);
    const r = await readPdfGrid(fd);
    return r.grid ? { sheets: [{ name: 'PDF', grid: r.grid }] } : { error: r.error };
  }
  if (/\.(csv|txt|tsv|prn)$/.test(nm) || f.type.startsWith('text/')) {
    const buf = new Uint8Array(await f.arrayBuffer());
    let t = new TextDecoder('utf-8').decode(buf);
    if (t.includes('�')) t = new TextDecoder('windows-1251').decode(buf);
    return { sheets: [{ name: 'CSV', grid: splitCsv(t) }] };
  }
  return { error: 'Поддржани се Excel (.xlsx, .xls), CSV/TXT, XML и PDF со текст.' };
}

export function Converter({ initialPresets, initialTarget }: { initialPresets: ConvPreset[]; initialTarget?: string }) {
  const [presets, setPresets] = useState(initialPresets);
  const [file, setFile] = useState('');
  const [sheets, setSheets] = useState<Sheets>([]);
  const [si, setSi] = useState(0);
  const [hi, setHi] = useState(0);
  const [tid, setTid] = useState(convTarget(initialTarget ?? '') ? initialTarget! : 'bank');
  const [map, setMap] = useState<Record<string, number>>({});
  const [consts, setConsts] = useState<Record<string, string>>({});
  const [dec, setDec] = useState<DecMode>('');
  const [pid, setPid] = useState('');
  const [pname, setPname] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const t = convTarget(tid)!;
  const grid = sheets[si]?.grid ?? [];
  // a two-row header („Салдо“ over „Д | П“) gives one combined heading per column
  const HC = useMemo(() => convHeads(grid, hi), [grid, hi]);
  const hdr = HC.head;
  const width = Math.max(hdr.length, ...grid.slice(hi, hi + 50).map((r) => r.length));
  const data = useMemo(() => grid.slice(HC.start), [grid, HC.start]);
  const blocks = convBlocks(t, hdr);
  const block = blocks.find((b) => b.d === map.debit && b.p === map.credit)?.id ?? '';

  /** New layout / target: a saved preset when there is one, otherwise the automatic mapping. */
  const remap = (g: unknown[][], h: number, target: string, P = presets) => {
    const T = convTarget(target)!;
    const p = convPresetFor(P, g[h] ?? [], target);
    if (p) { setMap(p.map); setConsts(p.consts ?? {}); setDec(p.dec ?? ''); setPid(p.id); setPname(p.name); return p; }
    // headings first, then the values (konto column, amount columns, the closing saldo block)
    const H = convHeads(g, h);
    setMap(convGuess(T, H.head, g.slice(H.start))); setConsts({}); setDec(''); setPid(''); setPname('');
    return null;
  };

  const pick = (f: File) => start(async () => {
    setMsg({});
    const r = await readSource(f);
    if (!r.sheets?.length) { setMsg({ error: r.error ?? 'Датотеката е празна.' }); return; }
    setFile(f.name); setSheets(r.sheets); setSi(0);
    const g = r.sheets[0]!.grid;
    // a preset for this layout (any target) chooses the target too
    let h = -1, p: ConvPreset | undefined;
    for (const x of presets) if (convSig(g[x.hi] ?? []) === x.sig) { p = x; h = x.hi; break; }
    const hh = h >= 0 ? h : convHeaderRow(g);
    setHi(hh);
    const target = p?.target ?? tid;
    setTid(target);
    remap(g, hh, target);
    if (p) setMsg({ ok: `Препознаен шаблон „${p.name}“.` });
  });

  const res = useMemo(() => (grid.length ? convApply(t, data, map, { dec, consts, firstRow: HC.start + 1, pre: grid.slice(0, hi) }) : null), [t, grid, data, map, dec, consts, hi, HC.start]);
  const tot = useMemo(() => (res ? convTotals(t, res.recs) : null), [t, res]);
  const chk = useMemo(() => (res && res.recs.length ? convCheck(t, res) : null), [t, res]);
  const sample = (i: number) => data.map((r) => cellTxt(r[i])).find((x) => x.trim()) ?? '';
  const miss = t.fields.filter((f) => f.req && map[f.key] == null && !consts[f.key]);
  const usedBy = new Map(Object.entries(map).map(([k, i]) => [i, k]));

  const savePreset = () => start(async () => {
    const name = pname.trim() || window.prompt('Назив на шаблонот (на пр. „Стопанска – извод Excel“):', '')?.trim() || '';
    if (!name) return;
    const r = await saveConvPreset({ id: pid || undefined, name, target: tid, sig: convSig(grid[hi] ?? []), hi, map, dec, consts });
    if (r.error) { setMsg({ error: r.error }); return; }
    setPresets(r.presets!); setPid(r.id ?? ''); setPname(name);
    setMsg({ ok: `Шаблонот „${name}“ е зачуван – следниот пат истиот распоред се препознава сам.` });
  });

  return (
    <>
      <div className="card">
        <p className="note" style={{ margin: '0 0 8px' }}>
          Датотека од друга програма, банка или добавувач (Excel, CSV, XML или PDF со текст) се претвора во образецот на увозот во програмата –
          <b> без AI</b>. Колоните се поврзуваат автоматски по насловот; поврзувањето може да се зачува како шаблон и следниот пат се применува само.
          Резултатот се проверува со истиот читач што го користи увозот, па се презема како Excel и се увезува на соодветниот екран.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="f">Цел (каде се увезува)
            <select value={tid} onChange={(e) => { setTid(e.target.value); if (grid.length) remap(grid, hi, e.target.value); }}>
              {CONV_TARGETS.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
            </select>
          </label>
          <label className="btn pri">{pending ? 'Се чита…' : '📂 Избери датотека'}
            <input type="file" hidden disabled={pending} accept=".xlsx,.xls,.xlsm,.ods,.csv,.txt,.tsv,.xml,.pdf,text/csv,application/pdf"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f); }} />
          </label>
          {file && <span className="mini">{file}</span>}
          <span style={{ flex: 1 }} />
          {presets.length > 0 && (
            <label className="f">Шаблон
              <select value={pid} onChange={(e) => {
                const p = presets.find((x) => x.id === e.target.value);
                if (!p) { setPid(''); setPname(''); return; }
                setTid(p.target); setHi(p.hi); setMap(p.map); setConsts(p.consts ?? {}); setDec(p.dec ?? ''); setPid(p.id); setPname(p.name);
              }}>
                <option value="">— автоматски —</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name} · {convTarget(p.target)?.title}</option>)}
              </select>
            </label>
          )}
        </div>
        {msg.error && <div className="callout bad" role="alert" style={{ marginTop: 8 }}>{msg.error}</div>}
        {msg.ok && <div className="callout good" role="status" style={{ marginTop: 8 }}>{msg.ok}</div>}
      </div>

      {grid.length > 0 && (
        <div className="card">
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
            {sheets.length > 1 && (
              <label className="f">Лист
                <select value={si} onChange={(e) => { const i = +e.target.value; setSi(i); const g = sheets[i]!.grid; const h = convHeaderRow(g); setHi(h); remap(g, h, tid); }}>
                  {sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
                </select>
              </label>
            )}
            <label className="f">Наслови во ред
              <input type="number" min={1} max={grid.length} value={hi + 1} style={{ width: 70 }} onChange={(e) => { const h = Math.max(0, Math.min(grid.length - 1, (+e.target.value || 1) - 1)); setHi(h); remap(grid, h, tid); }} />
            </label>
            <label className="f">Децимали
              <select value={dec} onChange={(e) => setDec(e.target.value as DecMode)}>
                <option value="">од датотеката</option><option value="comma">1.234,56 – „10.000“ = десет илјади</option><option value="dot">1,234.56 – „10.000“ = десет</option>
              </select>
            </label>
            {blocks.length > 1 && (
              <label className="f" title="Бруто биланс со повеќе блокови колони: за почетна состојба на следната година се зема крајното салдо">Користи
                <select value={block} onChange={(e) => { const b = blocks.find((x) => x.id === e.target.value); if (b) setMap((M) => { const n: Record<string, number> = { ...M, debit: b.d, credit: b.p }; delete n.saldo; return n; }); }}>
                  {!block && <option value="">— по избор —</option>}
                  {blocks.map((b) => <option key={b.id} value={b.id}>{TB_BLOCK_LABEL[b.id]} (Д / П)</option>)}
                </select>
              </label>
            )}
            <span style={{ flex: 1 }} />
            <input placeholder="Назив на шаблонот" value={pname} onChange={(e) => setPname(e.target.value)} style={{ width: 220 }} />
            <button type="button" className="btn" disabled={pending} onClick={savePreset}>💾 Зачувај шаблон</button>
            {pid && <button type="button" className="btn ghost" disabled={pending} onClick={() => start(async () => {
              if (!window.confirm(`Да се избрише шаблонот „${pname}“?`)) return;
              const r = await deleteConvPreset(pid);
              if (r.presets) { setPresets(r.presets); setPid(''); setPname(''); }
            })}>✕ Избриши шаблон</button>}
          </div>

          <h3 style={{ margin: '12px 0 6px', fontSize: 14 }}>Поврзување на колоните → {t.title}</h3>
          <div className="tw"><table className="dense">
            <thead><tr><th>Поле во програмата</th><th>Колона од датотеката</th><th>Пример</th><th>или фиксна вредност</th></tr></thead>
            <tbody>{t.fields.map((f) => {
              const i = map[f.key];
              return (
                <tr key={f.key}>
                  <td>{f.label}{f.req && <b style={{ color: 'var(--bad)' }}> *</b>}<span className="mini"> {f.kind === 'num' ? '(број)' : f.kind === 'date' ? '(датум)' : ''}</span></td>
                  <td>
                    <select value={i ?? ''} onChange={(e) => setMap((M) => { const n = { ...M }; if (e.target.value === '') delete n[f.key]; else n[f.key] = +e.target.value; return n; })}>
                      <option value="">— нема —</option>
                      {Array.from({ length: width }, (_, c) => (
                        <option key={c} value={c}>{String.fromCharCode(65 + (c % 26))}{c >= 26 ? Math.floor(c / 26) : ''}: {cellTxt(hdr[c]).slice(0, 40) || '(без наслов)'}{usedBy.has(c) && usedBy.get(c) !== f.key ? ' ✓' : ''}</option>
                      ))}
                    </select>
                  </td>
                  <td className="mini">{i != null ? sample(i).slice(0, 40) : ''}</td>
                  <td><input value={consts[f.key] ?? ''} disabled={i != null} style={{ width: 140 }} onChange={(e) => setConsts((C) => ({ ...C, [f.key]: e.target.value }))} /></td>
                </tr>
              );
            })}</tbody>
          </table></div>
          {miss.length > 0 && <div className="callout warn" style={{ marginTop: 8 }}>Поврзете ги задолжителните полиња: {miss.map((f) => f.label).join(', ')}.</div>}
        </div>
      )}

      {res && (
        <div className="card">
          <div className="hd">
            <h2 style={{ fontSize: 15 }}>Резултат: {res.recs.length} реда{res.errors.length ? ` · ${res.errors.length} со грешка` : ''}{res.skipped ? ` · ${res.skipped} празни` : ''}{res.skippedRows.length ? ` · ${res.skippedRows.length} прескокнати (збир / наслов / продолжение)` : ''}</h2>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn pri" disabled={!res.recs.length || res.blocked || !chk || !!chk.error || chk.diff.length > 0} onClick={() => xlsxDownload(`${t.file}_${(file.replace(/\.[^.]+$/, '') || 'konvertirano').slice(0, 40)}.xlsx`, [{ name: t.title.slice(0, 31), rows: res.grid }])}>⬇ Преземи Excel за увоз</button>
              <a className="btn" href={t.href} target="_blank" rel="noreferrer">↗ {t.where}</a>
            </div>
          </div>
          {res.blocked && (
            <div className="callout bad" role="alert"><b>⚠ Износите не се еднозначни</b> во колоните: {res.ambiguous.join(', ')} (на пр. „{res.ambExamples.join('“, „')}“).
              „10.000“ може да значи десет илјади (10.000,00) или десет (10.000 со точка како децимала). Изберете „Децимали“ погоре – преземањето е оневозможено додека не изберете.</div>
          )}
          {chk && !res.blocked && (chk.error
            ? <div className="callout bad">Увозот не ја препознава конвертираната датотека: {chk.error}</div>
            : chk.diff.length
              ? <div className="callout warn"><b>Проверка со читачот на увозот:</b><ul style={{ margin: '4px 0 0 16px' }}>{chk.diff.map((d, i) => <li key={i}>{d}</li>)}</ul></div>
              : <div className="callout good">✓ Проверено со читачот на увозот: ги чита сите {chk.n} реда со истите вредности.</div>)}
          {res.errors.length > 0 && (
            <div className="callout warn"><b>Редови со грешка (не се во резултатот или имаат празни полиња):</b>
              <ul style={{ margin: '4px 0 0 16px' }}>{res.errors.slice(0, 30).map((e, i) => <li key={i}>ред {e.row}: {e.msg}</li>)}</ul>
              {res.errors.length > 30 && <span className="mini">… уште {res.errors.length - 30}</span>}
            </div>
          )}
          {tot && res.recs.length > 0 && (
            <div className={`callout ${tot.balanced ? 'good' : 'warn'}`}>
              <b>{tot.balanced ? '✓ Должи = Побарува' : '⚠ Должи ≠ Побарува'}:</b> {fmtN(tot.D)} / {fmtN(tot.P)}{tot.balanced ? '' : ` – разлика ${fmtN(tot.diff)}`}
              <div className="mini" style={{ marginTop: 4 }}>По класи: {tot.byClass.map((c) => <span key={c.c} style={{ marginRight: 10 }}><b>{c.c}</b> Д {fmtN(c.d)} / П {fmtN(c.p)}</span>)}</div>
            </div>
          )}
          {res.skippedRows.length > 0 && (
            <details className="callout" style={{ marginTop: 6 }}>
              <summary>Прескокнати редови (збир / наслов / продолжение) – не се грешки: {res.skippedRows.length}</summary>
              <ul style={{ margin: '4px 0 0 16px' }}>{res.skippedRows.slice(0, 60).map((x, i) => <li key={i} className="mini">ред {x.row}: <b>{x.why === 'продолжение' ? 'продолжение на редот погоре' : x.why}</b> {x.text}</li>)}</ul>
              {res.skippedRows.length > 60 && <span className="mini">… уште {res.skippedRows.length - 60}</span>}
            </details>
          )}
          <div className="tw" style={{ maxHeight: 380 }}><table className="dense">
            <thead><tr>{(res.grid[0] ?? []).map((h, i) => <th key={i}>{String(h)}</th>)}</tr></thead>
            <tbody>{res.grid.slice(1, 51).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === 'number' ? 'n' : ''}>{typeof c === 'number' ? c.toLocaleString('mk-MK', { maximumFractionDigits: 4 }) : c}</td>)}</tr>)}</tbody>
          </table></div>
          {res.grid.length > 51 && <p className="mini">Прикажани се првите 50 реда; во датотеката се сите {res.grid.length - 1}.</p>}
        </div>
      )}
    </>
  );
}
