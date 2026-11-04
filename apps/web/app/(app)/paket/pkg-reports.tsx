'use client';
/**
 * The generated reports of a saved package, picked with ☑ and added in one click: the period (од – до) and the kontos
 * of the analytic cards are set here, every ticked report is rendered from its print view to a server PDF in a hidden
 * frame (`captureUrl`) and appended to the package (`/api/pdf` `pkg`), one after another – no tab per report.
 * „✉ Испрати“ first adds the ticked reports the package does not hold yet (same title = same report and period), then
 * mails the package (`mailPackage`), so ticking and sending is enough.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { captureUrl, requestPdf, waitForFile } from '@/lib/pdf-capture';
import { SendExtras } from '@/components/send-extras';
import type { RowResult } from '@/components/row-action';

const dmy = (d: string) => d.split('-').reverse().join('.');

export function PkgReports({ pkg, reports, picked, from: f0, to: t0, ks: k0, note, have, mail, subject, coverNote }: {
  pkg: string;
  /** [key, print URL (no period), label] */
  reports: readonly (readonly [string, string, string])[];
  picked: readonly string[];
  from: string; to: string; ks: string; note: string;
  /** labels of the package's documents (a report already added is not added twice) */
  have: readonly string[];
  mail: (prev: RowResult, f: FormData) => Promise<RowResult>;
  subject: string; coverNote: string;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(picked));
  const [from, setFrom] = useState(f0), [to, setTo] = useState(t0), [ks, setKs] = useState(k0);
  const [busy, setBusy] = useState(false);
  const [st, setSt] = useState('');
  const [res, setRes] = useState<RowResult>({});
  const router = useRouter();
  const bad = !from || !to || from > to;
  const urlOf = (k: string, href: string) => `${href}${href.includes('?') ? '&' : '?'}from=${from}&to=${to}${k === 'kart' ? `&ks=${encodeURIComponent(ks.trim().split(/[\s,;]+/).join(','))}` : ''}`;
  const titleOf = (label: string) => `${label} ${dmy(from)} – ${dmy(to)}`;
  const flip = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  /** Adds the ticked reports not in the package yet; the number added, or null when one failed. */
  const add = async (): Promise<number | null> => {
    const J = reports.filter(([k, , label]) => sel.has(k) && !have.includes(titleOf(label)));
    const ids: string[] = [], err: string[] = [];
    for (const [k, href, label] of J) {
      setSt(`⏳ ${label}…`);
      try {
        const c = await captureUrl(urlOf(k, href));
        ids.push(await requestPdf({ ...c, title: titleOf(label), pkg }));
      } catch (e) { err.push(`${label}: ${(e as Error).message}`); }
    }
    if (ids.length) {
      setSt('⏳ Се чека серверот за PDF…');
      for (const id of ids) await waitForFile(id, 40);
    }
    if (err.length) { setSt(`Додадени ${ids.length}; не успеа: ${err.join(' · ')}`); return null; }
    setSt(ids.length ? `✓ Додадени во пакетот: ${ids.length}.` : '');
    return ids.length;
  };
  const addOnly = async () => {
    if (bad || !sel.size) return;
    setBusy(true); setRes({});
    try { await add(); router.refresh(); } finally { setBusy(false); }
  };
  const send = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true); setRes({});
    try {
      if (sel.size && !bad && (await add()) === null) { setRes({ error: 'Некои извештаи не се додадени – пакетот не е испратен. Обидете се повторно.' }); return; }
      setSt('⏳ Се испраќа…');
      const r = await mail({}, fd);
      setRes(r); setSt('');
      router.refresh();
    } finally { setBusy(false); }
  };
  return (
    <>
      <div style={{ marginTop: 8, padding: 8, border: '1px solid var(--line, #ddd)', borderRadius: 6 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <b className="mini">Извештаи за пакетот – период:</b>
          <label className="mini">од <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} /></label>
          <label className="mini">до <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} /></label>
          {bad && <span className="pill bad">периодот не е точен</span>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 6 }}>
          {reports.map(([k, href, label]) => (
            <span key={k} style={{ whiteSpace: 'nowrap' }}>
              <label className="chk"><input type="checkbox" checked={sel.has(k)} onChange={() => flip(k)} /> {label}</label>
              {have.includes(titleOf(label)) && <span className="pill good" style={{ marginLeft: 4 }}>во пакетот</span>}
              {/* only to look at it (a new tab, not added to the package) */}
              {!bad && <a className="mini" href={urlOf(k, href)} target="_blank" rel="noopener" title="Отвори го за преглед (не се додава во пакетот)" style={{ marginLeft: 4 }}>👁 види</a>}
            </span>
          ))}
        </div>
        {sel.has('kart') && (
          <label className="mini" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }} title="Почеток на контото: 1200 = 1200 и неговите аналитики">
            картици за конта <input value={ks} onChange={(e) => setKs(e.target.value)} style={{ width: 'auto', flex: 1, minWidth: 260 }} />
          </label>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <button type="button" className="btn" disabled={busy || bad || !sel.size} onClick={addOnly}>+ Додај ги избраните во пакетот ({sel.size})</button>
          {st && <span className="mini">{st}</span>}
        </div>
        <p className="mini mut" style={{ margin: '6px 0 0' }}>{note}</p>
      </div>
      {/* legacy `pkgMail` / `pkgMailGo`: the ticked reports are added first, then the package is mailed */}
      <form onSubmit={send} className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }} aria-busy={busy}>
        {res.error && <div className="callout bad" role="alert">{res.error}</div>}
        {res.ok && <div className="callout good" role="status">{res.ok}</div>}
        <input type="hidden" name="id" value={pkg} />
        <input name="to" type="email" placeholder="е-пошта на примачот" required style={{ width: 240 }} />
        <input name="subject" defaultValue={subject} style={{ width: 240 }} />
        <button className="btn sm pri" disabled={busy}>{busy ? 'Се подготвува…' : sel.size ? '✉ Додај ги избраните и испрати' : '✉ Испрати по е-пошта'}</button>
        <textarea name="body" hidden defaultValue={coverNote} />
        <SendExtras selName="__none" files={{}} defaultBody={coverNote} attachHref={`/api/office/pkg/${pkg}`} />
      </form>
    </>
  );
}
