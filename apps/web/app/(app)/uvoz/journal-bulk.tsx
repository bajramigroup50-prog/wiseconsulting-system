'use client';
/**
 * „📚 Сите налози одеднаш“: many files of the old program (one nalog per file, or several) chosen together — each is
 * read, its columns recognised and checked on the server like the single import; the table shows every file (nalozi,
 * Σ должи / побарува, problems, duplicates) and „✅ Увези ги сите исправни“ imports the clean ones, one batch per file
 * (each can be removed alone). A file with problems stays for the single import above, where it can be corrected.
 */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { impAuto, type DecMode } from '@wise/core/retail/import';
import { jiGridRows, jiHeaderRow, jiNameDefault } from '@wise/core/journal-import';
import type { JiIn } from '@wise/core/journal-import';
import { readRows } from '../_retail/read-file';
import { commitJournalImportAction, previewJournalImportAction, readJournalPdfAction } from './journal-actions';

const fmt = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Item = {
  file: string; hash: string; nalog: { type: string; no: string }; rows: JiIn[];
  st: 'read' | 'ok' | 'bad' | 'done' | 'error'; why?: string; journals?: number; lines?: number; D?: number; P?: number; dups?: number; missing?: number;
};

async function sha256(f: File): Promise<string> {
  try { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await f.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join(''); } catch { return ''; }
}

export function JournalBulk() {
  const router = useRouter();
  const [L, setL] = useState<Item[]>([]);
  const [create, setCreate] = useState(true);
  const [busy, setBusy] = useState('');
  const [pending, start] = useTransition();
  const inp = useRef<HTMLInputElement>(null);
  const payload = (x: Item, cp: boolean) => JSON.stringify({ file: x.file, hash: x.hash, createPartners: cp, skipOpening: false, mode: 'journal', nalog: x.nalog, rows: x.rows });

  const check = async (x: Item, cp: boolean): Promise<Item> => {
    const r = await previewJournalImportAction(payload(x, cp));
    if (r.error || !r.data) return { ...x, st: 'error', why: r.error ?? 'грешка' };
    const p = r.data;
    const fresh = p.journals - p.duplicates.length;
    const why = [
      ...p.problems.slice(0, 3).map((q) => q.msg),
      ...(!cp && p.missingPartners.length ? [`${p.missingPartners.length} комитенти ги нема`] : []),
      ...(p.sameFile ? ['датотеката е веќе увезена'] : []),
      ...(fresh <= 0 ? ['сите налози се веќе внесени'] : []),
    ];
    return { ...x, st: p.ok && fresh > 0 ? 'ok' : 'bad', why: why.join(' · '), journals: fresh, lines: p.lines, D: p.D, P: p.P, dups: p.duplicates.length, missing: p.missingPartners.length };
  };

  const load = (F: FileList | null) => {
    if (!F?.length) return;
    const files = [...F];
    start(async () => {
      const out: Item[] = [];
      for (const [i, f] of files.entries()) {
        setBusy(`Се чита ${i + 1} / ${files.length}: ${f.name}`);
        const base: Item = { file: f.name, hash: '', nalog: jiNameDefault(f.name), rows: [], st: 'read' };
        try {
          let R: unknown[][];
          if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
            const fd = new FormData(); fd.set('file', f);
            const r = await readJournalPdfAction(fd);
            if (!r.grid) { out.push({ ...base, st: 'error', why: r.error ?? 'PDF-от не може да се прочита' }); continue; }
            R = r.grid;
          } else R = await readRows(f);
          const hi = jiHeaderRow(R);
          const map = impAuto('journal', R[hi] ?? []);
          let G = jiGridRows(R, hi, map, '');
          // amounts like „10.000“: the Macedonian decimal comma is the usual one in the old program's exports
          if (G.blocked.length) G = jiGridRows(R, hi, map, 'comma' as DecMode);
          if (map.date == null || map.k == null || (map.d == null && map.p == null && map.amt == null)) { out.push({ ...base, st: 'error', why: 'колоните не се препознаени – увезете ја посебно погоре' }); continue; }
          const x: Item = { ...base, hash: await sha256(f), rows: G.rows };
          out.push(await check(x, create));
        } catch { out.push({ ...base, st: 'error', why: 'датотеката не може да се прочита' }); }
        setL([...out]);
      }
      setBusy('');
    });
  };

  const recheck = (cp: boolean) => start(async () => {
    const out: Item[] = [];
    for (const x of L) out.push(x.st === 'done' || x.st === 'error' || !x.rows.length ? x : await check(x, cp));
    setL(out);
  });

  const commitAll = () => {
    const ok = L.filter((x) => x.st === 'ok');
    if (!ok.length) return;
    const n = ok.reduce((s, x) => s + (x.journals ?? 0), 0);
    if (!window.confirm(`Да се увезат ${ok.length} датотеки со ${n} налози${create ? ' (комитентите што ги нема се креираат)' : ''}?`)) return;
    start(async () => {
      const out = [...L];
      for (const [i, x] of out.entries()) {
        if (x.st !== 'ok') continue;
        setBusy(`Се увезува ${x.file}…`);
        const r = await commitJournalImportAction(payload(x, create));
        out[i] = r.error ? { ...x, st: 'error', why: r.error } : { ...x, st: 'done', why: `увезени ${r.data!.journals} налози` };
        setL([...out]);
      }
      setBusy('');
      router.refresh();
    });
  };

  const ok = L.filter((x) => x.st === 'ok');
  return (
    <div className="card" style={{ margin: '12px 0' }}>
      <h3 style={{ marginTop: 0 }}>📚 Сите налози одеднаш</h3>
      <p className="note" style={{ marginTop: 0 }}>Изберете ги <b>сите датотеки</b> од старата програма заедно (Excel / CSV / PDF – Ctrl + A во прозорецот). Секоја се чита и проверува; исправните се увезуваат со едно копче, секоја како свој увоз (може да се избрише посебно). Датотека со проблем останува – увезете ја поединечно погоре.</p>
      <input ref={inp} type="file" hidden multiple accept=".xlsx,.xls,.csv,.txt,.xml,.pdf" onChange={(e) => { load(e.target.files); e.target.value = ''; }} />
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn pri" disabled={pending} onClick={() => inp.current?.click()}>📂 Избери повеќе датотеки</button>
        <label className="mini"><input type="checkbox" checked={create} onChange={(e) => { setCreate(e.target.checked); if (L.length) recheck(e.target.checked); }} /> креирај ги комитентите што ги нема (од датотеката)</label>
        {ok.length > 0 && <button type="button" className="btn pri" disabled={pending} onClick={commitAll}>✅ Увези ги сите исправни ({ok.length})</button>}
        {busy && <span className="mini">⏳ {busy}</span>}
      </div>
      {L.length > 0 && (
        <div className="tw" style={{ marginTop: 8 }}><table className="dense">
          <thead><tr><th>Датотека</th><th className="n">Налози</th><th className="n">Ставки</th><th className="n">Должи</th><th className="n">Побарува</th><th>Статус</th></tr></thead>
          <tbody>{L.map((x, i) => (
            <tr key={i}>
              <td>{x.file}</td><td className="n">{x.journals ?? ''}</td><td className="n">{x.lines ?? ''}</td>
              <td className="n">{x.D != null ? fmt(x.D) : ''}</td><td className="n">{x.P != null ? fmt(x.P) : ''}</td>
              <td className="mini" style={{ color: x.st === 'bad' || x.st === 'error' ? 'var(--bad)' : x.st === 'done' ? 'var(--good)' : undefined }}>
                {x.st === 'ok' ? '✓ спремно' : x.st === 'done' ? '✓ ' + x.why : x.st === 'read' ? '⏳' : '✕ ' + (x.why || 'проблем')}{x.dups ? ` · ${x.dups} веќе внесени` : ''}
              </td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td>Вкупно спремни</td><td className="n">{ok.reduce((s, x) => s + (x.journals ?? 0), 0)}</td><td /><td className="n">{fmt(ok.reduce((s, x) => s + (x.D ?? 0), 0))}</td><td className="n">{fmt(ok.reduce((s, x) => s + (x.P ?? 0), 0))}</td><td /></tr></tfoot>
        </table></div>
      )}
    </div>
  );
}
