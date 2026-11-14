/** Home dashboard (owner only): the CRM next steps that are due (today / overdue) and the next 7 days. */
import Link from 'next/link';
import { and, asc, inArray, isNotNull, lte } from 'drizzle-orm';
import { CRM_OPEN } from '@wise/core/firms/crm';
import { crmLeads } from '@wise/db';
import { db } from '@/lib/db';
import { today } from '@/lib/office';
import { crmUser } from './lib';

export async function CrmHome() {
  // a widget never breaks the home dashboard
  try { return await crmDue(); } catch { return null; }
}

async function crmDue() {
  if (!(await crmUser())) return null;
  const td = today();
  const x = new Date(td + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 7);
  const d7 = x.toISOString().slice(0, 10);
  const L = await db().select({ id: crmLeads.id, company: crmLeads.company, nextStep: crmLeads.nextStep, nextDate: crmLeads.nextDate }).from(crmLeads)
    .where(and(isNotNull(crmLeads.nextDate), lte(crmLeads.nextDate, d7), inArray(crmLeads.stage, [...CRM_OPEN]))).orderBy(asc(crmLeads.nextDate)).limit(30);
  if (!L.length) return null;
  const late = L.filter((l) => l.nextDate! <= td).length;
  return (
    <div className={`callout${late ? ' warn' : ''}`} id="crmDue">🤝 <b>CRM – следни чекори</b>{late ? <> · <b style={{ color: '#b42318' }}>{late} до денес</b></> : null}:{' '}
      {L.map((l) => (
        <Link key={l.id} href={`/crm?id=${l.id}`} className="btn sm" style={{ margin: '2px 4px 2px 0', color: l.nextDate! <= td ? '#b42318' : undefined }}>
          {l.nextDate!.split('-').reverse().slice(0, 2).join('.')} · {l.company}{l.nextStep ? ` – ${l.nextStep}` : ''}
        </Link>
      ))}
      <Link href="/crm" className="muted" style={{ fontSize: 12 }}>сите →</Link>
    </div>
  );
}
