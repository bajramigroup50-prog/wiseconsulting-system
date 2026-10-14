/**
 * „📊 Месечен извештај за клиентот“ (office): per firm and month — revenue, expenses, result, VAT to pay and its due
 * date, receivables > 60 days, payables, money, key changes vs the previous month. Numbers from the books (free);
 * optional „💲 AI“ summary in the client's language (Macedonian / Albanian, set on „👥 Портал за клиенти“); PDF,
 * publish to the portal (`/klIzv`), e-mail with SMTP; the owner's „Подготви за сите клиенти“.
 */
import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { CLIENT_REPORT_STATUS, clientReportHtml, isReportLang, isReportPeriod, klLang, lastFinishedMonth, periodLabel, REPORT_LANGS, type ClientReportData, type ClientReportStatus, type KlConfig } from '@wise/core/office';
import { clientReports, firmMail } from '@wise/db';
import { db } from '@/lib/db';
import { smtpConfigured } from '@/lib/mail';
import { officePage, today } from '@/lib/office';
import { isOfficeOwner } from '@/lib/office-owner';
import { ActionForm } from '@/components/action-form';
import { AiBadge, AI_COST_TAG } from '@/components/ai-badge';
import { AutoRefresh } from '@/components/auto-refresh';
import { Hd, dmyHm } from '@/components/hd';
import { PdfButton } from '@/components/pdf-button';
import { RowAction } from '@/components/row-action';
import { mailClientReport, prepareAll, prepareReport, publishReport, reportAi } from './actions';

export default async function MesIzvPage({ searchParams }: { searchParams: Promise<{ id?: string; p?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await officePage('mesIzv', { perm: 'office' });
  const td = today();
  const def = isReportPeriod(sp.p) ? sp.p : lastFinishedMonth(td);
  const owner = await isOfficeOwner(u);
  const batch = owner && (
    <ActionForm action={prepareAll} reset={false}>
      <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Подготви за сите клиенти</h2>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input type="month" name="period" defaultValue={def} max={td.slice(0, 7)} required style={{ width: 'auto' }} />
        <button className="btn">⚙ Подготви за сите клиенти</button>
        <span className="mini">Само бројките (бесплатно) – AI прегледот и праќањето се по фирма.</span>
      </div>
    </ActionForm>
  );
  if (!firm) return <><Hd t="📊 Месечен извештај за клиентот" /><div className="card empty">Изберете фирма.</div>{batch}</>;
  const lang = klLang((firm.settings as { kl?: KlConfig }).kl);
  const [L, mail] = await Promise.all([
    db().select().from(clientReports).where(eq(clientReports.firmId, firm.id)).orderBy(desc(clientReports.period)),
    firmMail(db(), firm.id),
  ]);
  const sel = (sp.id && L.find((r) => r.id === sp.id)) || L.find((r) => r.period === def) || L[0];
  const smtp = smtpConfigured();
  const rl = sel && isReportLang(sel.lang) ? sel.lang : lang;
  return (
    <>
      <Hd t="📊 Месечен извештај за клиентот" sub={firm.name} />
      <ActionForm action={prepareReport} reset={false}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="f" style={{ margin: 0 }}>Месец<input type="month" name="period" defaultValue={def} max={td.slice(0, 7)} required /></label>
          <button className="btn pri">🧮 Пресметај од книгите</button>
          <span className="mini">Јазик на клиентот: <b>{REPORT_LANGS[lang]}</b> · <Link href="/klPortal">промени</Link></span>
        </div>
      </ActionForm>

      {sel ? (
        <div className="card">
          <div className="hd" style={{ flexWrap: 'wrap', gap: 6 }}>
            <b>{periodLabel(sel.period)} · <span className={`pill ${sel.status === 'draft' ? '' : 'good'}`}>{CLIENT_REPORT_STATUS[sel.status as ClientReportStatus] ?? sel.status}</span>
              {sel.sentAt && <span className="mini"> {dmyHm(sel.sentAt)} → {sel.sentTo}</span>}</b>
            <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <PdfButton title={`Mesecen_izvestaj_${sel.period}`} />
              {sel.aiStatus !== 'queued' && <RowAction className="btn" action={reportAi.bind(null, sel.id)} label={`${sel.summary ? '↻ AI преглед' : '✍ AI преглед'} ${AI_COST_TAG}`} title="Краток преглед со едноставни зборови – само од бројките (без имиња)" />}
              {sel.status === 'draft'
                ? <RowAction className="btn pri" action={publishReport.bind(null, sel.id, true)} label="👁 Објави во порталот" />
                : <RowAction className="btn ghost" action={publishReport.bind(null, sel.id, false)} label="Сокриј од клиентот" />}
            </span>
          </div>
          {sel.aiStatus === 'queued' && <><AutoRefresh seconds={3} /><div className="callout">💲 AI го пишува прегледот…</div></>}
          {sel.aiStatus === 'error' && sel.aiError && <div className="callout bad">{sel.aiError}</div>}
          <div id="printArea" dangerouslySetInnerHTML={{ __html: clientReportHtml(sel.data as unknown as ClientReportData, { firm: firm.name, lang: rl, summary: sel.summary, by: u.name }) }} />
          {smtp ? (
            <ActionForm action={mailClientReport} reset={false} className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              <input type="hidden" name="id" value={sel.id} />
              <input name="to" type="email" multiple defaultValue={mail ?? ''} placeholder="е-пошта на клиентот" style={{ width: 260 }} required />
              <button className="btn">✉ Испрати PDF по е-пошта</button>
            </ActionForm>
          ) : <p className="mini" style={{ marginTop: 8 }}>Е-пошта не е поставена на серверот (SMTP) – објавете го во порталот или испратете го PDF-от рачно.</p>}
        </div>
      ) : <div className="card empty">Нема извештај за {periodLabel(def)} – „🧮 Пресметај од книгите“.</div>}

      {L.length > 0 && (
        <div className="card"><h2 style={{ fontSize: 15 }}>Извештаи на фирмата</h2>
          <table className="dense"><thead><tr><th>Месец</th><th>Статус</th><th>AI преглед</th><th>Пресметано</th></tr></thead><tbody>
            {L.map((r) => (
              <tr key={r.id} style={r.id === sel?.id ? { fontWeight: 700 } : undefined}>
                <td><Link href={`/mesIzv?id=${r.id}`}>{periodLabel(r.period)}</Link></td>
                <td>{CLIENT_REPORT_STATUS[r.status as ClientReportStatus] ?? r.status}</td>
                <td>{r.summary ? '✓' : r.aiStatus === 'queued' ? '…' : ''}{r.summary && <AiBadge />}</td>
                <td>{dmyHm(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
      {batch}
    </>
  );
}
