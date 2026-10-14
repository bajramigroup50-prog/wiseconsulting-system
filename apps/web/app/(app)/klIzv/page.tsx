/**
 * „📊 Месечни извештаи“ — the client's portal view of the monthly reports the office published (or e-mailed) for
 * THEIR firm (the session's firm; a report id of another firm or a draft is never shown). PDF from the page.
 */
import Link from 'next/link';
import { and, desc, eq, ne } from 'drizzle-orm';
import { CR_TXT, clientReportHtml, isReportLang, periodLabel, type ClientReportData } from '@wise/core/office';
import { clientReports } from '@wise/db';
import { db } from '@/lib/db';
import { officePage } from '@/lib/office';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { PdfButton } from '@/components/pdf-button';

export default async function KlIzvPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const sp = await searchParams;
  const { firm } = await officePage('klIzv');
  if (!firm) return <NoFirm t="📊 Месечни извештаи" />;
  const L = await db().select().from(clientReports)
    .where(and(eq(clientReports.firmId, firm.id), ne(clientReports.status, 'draft'))).orderBy(desc(clientReports.period));
  const sel = L.find((r) => r.id === sp.id) ?? L[0];
  const lang = sel && isReportLang(sel.lang) ? sel.lang : 'mk';
  return (
    <>
      <Hd t="📊 Месечни извештаи" sub={firm.name} exp={false} />
      {sel ? (
        <div className="card">
          <div className="hd"><b>{CR_TXT[lang].title} · {periodLabel(sel.period, lang)}</b><PdfButton title={`Mesecen_izvestaj_${sel.period}`} /></div>
          <div id="printArea" dangerouslySetInnerHTML={{ __html: clientReportHtml(sel.data as unknown as ClientReportData, { firm: firm.name, lang, summary: sel.summary }) }} />
        </div>
      ) : <div className="card empty">Канцеларијата сè уште нема објавено месечен извештај.</div>}
      {L.length > 1 && (
        <div className="card"><h2 style={{ fontSize: 15 }}>Претходни месеци</h2>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {L.map((r) => <Link key={r.id} className={`btn sm${r.id === sel?.id ? ' pri' : ''}`} href={`/klIzv?id=${r.id}`}>{periodLabel(r.period, isReportLang(r.lang) ? r.lang : 'mk')}</Link>)}
          </div>
        </div>
      )}
    </>
  );
}
