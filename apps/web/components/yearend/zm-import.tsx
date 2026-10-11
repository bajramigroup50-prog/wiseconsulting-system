'use client';
/**
 * Legacy `zmBox` „📥 Увези од поднесена годишна сметка (PDF / Excel / CSV)“ (10947, `zmImport` 10953): Excel / CSV are
 * parsed in the browser, PDF / images are read by AI (worker kind `zm`, the legacy prompt).
 */
import { useEffect, useState, useTransition } from 'react';
import { AiReadList, useAiRead } from '@/components/ai-read';
import { useRouter } from 'next/navigation';
import { importZsAopAction } from '@/app/(app)/zsProc/actions';

const TEMPLATE = [
  ['Биланс на состојба'],
  ['', 'АОП', 'Позиција', 'Тековна година', 'Претходна година'],
  ['', '001', 'А. Постојани средства', '', ''],
  ['', '063', 'Вкупна актива', '', ''],
  ['Биланс на успех'],
  ['', 'АОП', 'Позиција', 'Тековна година', 'Претходна година'],
  ['', '201', 'I. Приходи од работењето', '', ''],
];

export function ZmImport({ year, firmId }: { year: number; firmId: string }) {
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ai = useAiRead(firmId);
  useEffect(() => {
    const d = ai.docs.find((x) => x.status === 'done');
    if (!d) return;
    ai.reset();
    start(async () => { const r = await importZsAopAction({ aiId: d.id }); setMsg(r); if (!r.error) router.refresh(); });
  }, [ai.docs]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="card" id="zm_box">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b>📥 Увези од поднесена годишна сметка (PDF / Excel / CSV)</b>
        <button type="button" className="btn sm" onClick={async () => {
          const XLSX = await import('xlsx');
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(TEMPLATE), 'Годишна сметка');
          const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
          const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([out])), download: `Godisna_smetka_obrazec_${year}.xlsx` });
          a.click();
        }}>⬇ Образец</button>
        <label className="btn sm pri">{pending || ai.busy ? 'Се чита…' : 'Избери датотека'}<input type="file" hidden accept=".pdf,.xlsx,.xls,.csv,image/*" disabled={pending || ai.busy} onChange={(e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          if (/pdf|image\//i.test(f.type) || /\.(pdf|jpe?g|png|webp)$/i.test(f.name)) { setMsg({ ok: '⏳ Се чита годишната сметка…' }); void ai.read('zm', [f]); return; }
          start(async () => {
            let r;
            try {
              if (/\.csv$/i.test(f.name)) r = await importZsAopAction({ csv: await f.text() });
              else {
                const XLSX = await import('xlsx');
                const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' });
                let grid: unknown[][] = [];
                for (const sn of wb.SheetNames) grid = grid.concat(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn]!, { header: 1, raw: true, defval: '' }).map((row) => [sn, ...row]));
                r = await importZsAopAction({ grid });
              }
            } catch { r = { error: 'Датотеката не може да се прочита.' }; }
            setMsg(r);
            if (!r.error) router.refresh();
          });
        }} /></label>
      </div>
      <p className="mini" style={{ margin: '6px 0 0' }}>Износите за {year} (тековна година) и {year - 1} (претходна година) од поднесената сметка (на пр. од друга програма или од ЦРМ) се зачувуваат како рачни износи. Ако во документот има и колона „Претходна година“, таа се зачувува за {year - 1}.</p>
      <AiReadList docs={ai.docs} msg={ai.msg} />
      {msg && <div className={'callout ' + (msg.error ? 'bad' : 'good')} style={{ marginTop: 6 }}>{msg.error ?? msg.ok}</div>}
    </div>
  );
}
