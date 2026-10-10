'use client';
/**
 * Legacy `ACT.zyGen` 11148 + `zyGenerate` 11122 („💾 Зачувај ги датотеките за <година> во досието“): every year-end
 * report of the (current) year is rendered from its print view to a server PDF and filed in the year's dossier under
 * its role (a new file replaces the old one); for a company the ЦРМ XML too (server action, behind the findings
 * gate as the XML download).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { captureUrl, requestPdf, waitForFile } from '@/lib/pdf-capture';
import { saveYearXml } from './actions';

export function ZyGen({ year, jobs, xml }: { year: number; jobs: readonly (readonly [role: string, url: string, title: string])[]; xml: boolean }) {
  const [busy, setBusy] = useState(false);
  const [st, setSt] = useState('');
  const router = useRouter();
  const run = async () => {
    setBusy(true);
    const ids: string[] = [];
    const err: string[] = [];
    try {
      for (const [role, url, title] of jobs) {
        setSt(`⏳ PDF: ${title}…`);
        try {
          const c = await captureUrl(url);
          ids.push(await requestPdf({ ...c, title: `${title} ${year}`, save: { to: 'year', year, role } }));
        } catch (e) { err.push(`${title}: ${(e as Error).message}`); }
      }
      if (xml) {
        setSt('⏳ XML за ЦРМ…');
        const r = await saveYearXml(year);
        if (r.error) err.push(r.error);
      }
      setSt('⏳ Се чека серверот за PDF…');
      for (const id of ids) await waitForFile(id, 30);
      setSt(err.length ? `Зачувани ${ids.length} PDF${xml ? ' + XML' : ''}; не успеа: ${err.join(' · ')}` : `✓ Датотеките за ${year} се зачувани во досието. Остануваат официјалните потврди (ЦРМ${xml ? ', УЈП' : ''}).`);
      router.refresh();
    } finally { setBusy(false); }
  };
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" className="btn pri" disabled={busy} onClick={run}>{busy ? 'Се подготвува…' : `💾 Зачувај ги датотеките за ${year} во досието`}</button>
      {st && <span className="mini">{st}</span>}
    </div>
  );
}
