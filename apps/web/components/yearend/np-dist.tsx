'use client';
/** Legacy `npModal` 17048: distribute one journal line without partner (konto 12.. / 22..) over partners. */
import { useEffect, useState, useTransition } from 'react';
import { csvToGrid, parseOpeningSheet, type ObRow } from '@wise/core';
import { npFromAnalytic, obFromAi } from '@wise/core/finpar-ob';
import { AiReadList, useAiRead } from '@/components/ai-read';
import { useRouter } from 'next/navigation';
import { npDistAction } from '@/app/(app)/zsProc/actions';

export interface NpLine { id: number; account: string; side: 'd' | 'p'; amt: number; jdesc: string; jdate: string; jnumber: string; kind: string; kname: string; withP: number }

const f2 = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s: string) => { const v = Number(String(s ?? '').replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(v) ? v : 0; };

export function NpDist({ firmId, g, list, ti, names, turnover }: { firmId: string; g: '12' | '22'; list: NpLine[]; ti: number; names: string[]; turnover: string[] }) {
  const T = list[ti]!;
  const [rows, setRows] = useState<{ n: string; a: string }[]>([{ n: '', a: '' }]);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const dist = Math.round(rows.reduce((s, r) => s + num(r.a), 0) * 100) / 100;
  const rest = Math.round((T.amt - dist) * 100) / 100;
  const who = g === '12' ? 'купувачи' : 'добавувачи';
  const imp = T.kind === 'bbimp' || T.kind === 'open';
  // legacy `npImport` 17062 „📥 Пополни од аналитика“: Excel / CSV parsed here, PDF / images read by AI (kind `ob`)
  const [npMsg, setNpMsg] = useState('');
  const ai = useAiRead(firmId);
  const fill = (R: readonly ObRow[]) => {
    const add = npFromAnalytic(R, T.account, g, T.side);
    if (!add.length) { setNpMsg('Не се најдени редови со партнер за конто ' + T.account + '.'); return; }
    setRows((cur) => [...cur.filter((r) => r.n || r.a), ...add]);
    const tot = Math.round(add.reduce((s, r) => s + num(r.a), 0) * 100) / 100;
    setNpMsg('✓ ' + add.length + ' партнери · ' + f2(tot) + (Math.abs(tot - T.amt) < 1 ? ' – се совпаѓа со салдото ✓' : ' – салдото е ' + f2(T.amt) + ', проверете'));
  };
  useEffect(() => {
    const d = ai.docs.find((x) => x.status === 'done');
    if (!d) return;
    ai.reset();
    fill(obFromAi(d.result, { full: true }).rows);
  }, [ai.docs]); // eslint-disable-line react-hooks/exhaustive-deps
  const npImport = async (file: File) => {
    setNpMsg('⏳ Се чита…');
    try {
      if (/\.(csv|txt)$/i.test(file.name)) { const R = parseOpeningSheet(csvToGrid(await file.text()), 'csv'); if (R?.rows.length) return fill(R.rows); }
      else if (/\.(xlsx|xls)$/i.test(file.name)) {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
        const R = parseOpeningSheet(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true, defval: '' }), 'excel');
        if (R?.rows.length) return fill(R.rows);
      }
      if (!/pdf|image\//i.test(file.type) && !/\.(pdf|jpe?g|png|webp)$/i.test(file.name)) { setNpMsg('Не се најдени редови со партнер за конто ' + T.account + '.'); return; }
      await ai.read('ob', [file]);
    } catch (e) { setNpMsg('Не успеа читањето: ' + ((e as Error)?.message ?? '')); }
  };
  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="hd"><h2>Распредели по {who} – конто {T.account}</h2><a className="btn" href="/zsKontrola">Затвори</a></div>
      <div style={{ margin: '6px 0 10px', padding: '10px 12px', background: 'var(--soft)', borderRadius: 8, lineHeight: 1.55 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Од каде е овој износ?</div>
        <div>Налог: <b>{T.jnumber} {T.jdesc}</b>{T.jdate ? ' · датум ' + T.jdate.split('-').reverse().join('.') : ''}</div>
        <div>Конто: <b>{T.account}</b> {T.kname} · {T.side === 'd' ? <><b>должи</b> (побарување од купувачи)</> : <><b>побарува</b> (обврска кон добавувачи)</>}: <b>{f2(T.amt)}</b> – <span style={{ color: 'var(--warn)' }}>без партнер</span></div>
        {imp && <div className="mini">Износот е <b>збирното салдо</b> на конто {T.account} од {T.kind === 'bbimp' ? 'увезениот бруто биланс' : 'почетната состојба'} – при увозот не беа прочитани имињата на {who}. Во стариот програм отпечатете аналитичка картица / ИОС по {who} за конто {T.account} и препишете ги салдата тука.</div>}
        {T.withP > 0 && <div className="mini">На истото конто во налогот веќе има {T.withP} ставки со партнер.</div>}
        {list.length > 1 && <div className="mini">Ставки без партнер: {list.map((x, i) => <a key={x.id} className={`pill ${i === ti ? 'info' : ''}`} href={`/zsKontrola?np=${g}&ti=${i}`}>{x.account} · {f2(x.amt)}</a>)}</div>}
      </div>
      <div style={{ display: 'block', margin: '8px 0', padding: '8px 10px', border: '1px dashed var(--line)', borderRadius: 8 }}><b>📥 Пополни од аналитика</b> <span style={{ fontSize: 12.5, opacity: 0.85 }}>– Excel / CSV / PDF од стариот програм (аналитичка картица по купувачи, ИОС листа или аналитички бруто биланс): се земаат редовите на конто {T.account} со партнер и салдо.</span> <label className="btn sm" style={{ marginLeft: 6 }}>Избери датотека<input type="file" accept=".pdf,.xlsx,.xls,.csv,image/*" hidden disabled={ai.busy} onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) void npImport(x); }} /></label> <span className="mini">{npMsg}</span>
        <AiReadList docs={ai.docs} msg={ai.msg} />
      </div>
      <datalist id="npPL">{names.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="tw"><table className="dense">
        <thead><tr><th>Партнер (пишете дел од името)</th><th className="n" style={{ width: 170 }}>Износ</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}><td><input list="npPL" value={r.n} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, n: e.target.value } : x)))} style={{ width: '100%' }} /></td>
            <td><input inputMode="decimal" value={r.a} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} style={{ width: 150, textAlign: 'right' }} /></td>
            <td><button type="button" className="btn sm ghost" onClick={() => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ n: '', a: '' }])}>✕</button></td></tr>
        ))}</tbody>
        <tfoot><tr><td>Распределено</td><td className="n">{f2(dist)}</td><td /></tr>
          <tr><td>Остаток без партнер</td><td className="n" style={{ color: Math.abs(rest) < 0.01 ? 'var(--good)' : rest < 0 ? 'var(--bad)' : 'var(--warn)' }}>{f2(rest)}</td><td /></tr></tfoot>
      </table></div>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button type="button" className="btn" onClick={() => setRows([...rows, { n: '', a: '' }])}>+ Ред</button>
        <button type="button" className="btn" onClick={() => { const have = new Set(rows.map((r) => r.n)); setRows([...rows.filter((r) => r.n || r.a), ...turnover.filter((n) => !have.has(n)).map((n) => ({ n, a: '' }))]); }}>+ Сите {who} со промет</button>
        <span style={{ flex: 1 }} />
        {list.length > 1 && <span className="mini">Ставка {ti + 1} од {list.length}</span>}
        <button type="button" className="btn pri" disabled={pending} onClick={() => start(async () => { const r = await npDistAction(T.id, rows); setMsg(r); if (!r.error) router.refresh(); })}>Зачувај распределба</button>
      </div>
      {msg && <div className={'callout ' + (msg.error ? 'bad' : 'good')} style={{ marginTop: 8 }}>{msg.error ?? msg.ok}</div>}
      <p className="mini" style={{ marginTop: 6 }}>Нов партнер (што го нема во шифрарникот) се креира при зачувување.</p>
    </div>
  );
}
