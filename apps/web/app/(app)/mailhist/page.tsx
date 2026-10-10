/**
 * Legacy `VIEWS.mailhist` (13421) — Историја на праќања: every e-mail the program sent for the firm (`mail_log`:
 * invoices, dunning letters, payslips, portal messages, …) plus dunning letters printed as PDF or sent by WhatsApp /
 * Viber. FIX: the status (sent / failed / waiting) and the error are shown — legacy only logged the Gmail call.
 */
import Link from 'next/link';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { mhKind, mhKindGroup } from '@wise/core/firms/mailhist';
import { dunningLetters, mailLog, partners, users } from '@wise/db';
import { db } from '@/lib/db';
import { officePage } from '@/lib/office';
import { Hd, dmy } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';

const ST: Record<string, [string, string]> = { sent: ['испратено', 'good'], failed: ['не е испратено', 'bad'], queued: ['чека', 'warn'] };
const at = (d: Date) => d.toLocaleString('sv-SE', { timeZone: 'Europe/Skopje' }).slice(0, 16);

interface Row { at: Date; kind: string; partner: string; to: string; subj: string; files: number; ch: string; by: string; st?: string; err?: string | null }

export default async function MailhistPage({ searchParams }: { searchParams: Promise<{ q?: string; k?: string }> }) {
  const { firm } = await officePage('mailhist');
  if (!firm) return <NoFirm t="Историја на праќања" />;
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().toLowerCase(), k = sp.k ?? '';
  const [M, O, P] = await Promise.all([
    db().select().from(mailLog).where(eq(mailLog.firmId, firm.id)).orderBy(desc(mailLog.createdAt)).limit(2000),
    db().select().from(dunningLetters).where(and(eq(dunningLetters.firmId, firm.id))).orderBy(desc(dunningLetters.createdAt)),
    db().select({ id: partners.id, name: partners.name, email: partners.email }).from(partners).where(eq(partners.firmId, firm.id)),
  ]);
  const uids = [...new Set([...M.map((m) => m.createdBy), ...O.map((o) => o.createdBy)].filter((x): x is string => !!x))];
  const U = new Map((uids.length ? await db().select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, uids)) : []).map((x) => [x.id, x.name]));
  const byMail = new Map<string, string>();
  for (const p of P) for (const e of String(p.email ?? '').split(/[,;\s]+/)) if (e) byMail.set(e.toLowerCase(), p.name);
  const pById = new Map(P.map((p) => [p.id, p.name]));
  const LV = (l: number) => (l === 3 ? '(последна)' : l + '.');
  const R: Row[] = [
    ...M.map((m) => ({
      at: m.createdAt, kind: m.entityType === 'dunning' ? 'Опомена' : mhKind(m.subject),
      partner: (m.entityType === 'dunning' && m.entityId ? pById.get(m.entityId) : undefined) ?? m.to.map((e) => byMail.get(e.toLowerCase())).find(Boolean) ?? '',
      to: m.to.join(', '), subj: m.subject, files: m.attachments.length, ch: 'е-пошта', by: U.get(m.createdBy ?? '') ?? '', st: m.status, err: m.error,
    })),
    ...O.filter((o) => o.channel !== 'е-пошта').map((o) => ({
      at: o.createdAt, kind: 'Опомена ' + LV(o.level), partner: o.partnerName ?? '', to: '', subj: `Опомена – ${Number(o.total).toLocaleString('mk-MK', { minimumFractionDigits: 2 })} ден.`,
      files: 0, ch: o.channel === 'PDF' ? 'PDF (преземено)' : o.channel, by: U.get(o.createdBy ?? '') ?? '',
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const K = [...new Set(R.map((r) => mhKindGroup(r.kind)))].sort();
  const L = R.filter((r) => (!k || r.kind.startsWith(k)) && (!q || [r.to, r.subj, r.partner].join(' ').toLowerCase().includes(q)));
  return (
    <>
      <Hd t="Историја на праќања" sub="е-пошта, WhatsApp и PDF – опомени, потврди за уплата, фактури…">
        <Link className="btn" href="/opomeni">⏰ Опомени</Link>
      </Hd>
      <form className="card">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input name="q" placeholder="Барај: комитент, е-пошта, наслов…" defaultValue={sp.q ?? ''} style={{ maxWidth: 320 }} />
          <select name="k" defaultValue={k} style={{ maxWidth: 220 }}>
            <option value="">Сите видови</option>
            {K.map((x) => <option key={x}>{x}</option>)}
          </select>
          <button className="btn">Барај</button>
          <span className="mini">{L.length} записи</span>
        </div>
      </form>
      {L.length ? (
        <div className="tw"><table className="dense">
          <thead><tr><th>Датум и време</th><th>Вид</th><th>Комитент</th><th>До</th><th>Наслов</th><th>Канал</th><th>Корисник</th></tr></thead>
          <tbody>
            {L.map((r, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'nowrap' }}>{dmy(at(r.at).slice(0, 10))} {at(r.at).slice(11)}</td>
                <td>{r.kind}</td><td>{r.partner}</td><td>{r.to}</td>
                <td>{r.subj}{r.files > 0 && <><br /><small className="note">📎 {r.files} прилог(и)</small></>}{r.err && <><br /><small style={{ color: 'var(--bad)' }}>{r.err}</small></>}</td>
                <td>{r.ch}{r.st && <> <span className={`pill ${ST[r.st]?.[1] ?? ''}`}>{ST[r.st]?.[0] ?? r.st}</span></>}</td>
                <td>{r.by}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <div className="card empty">Сè уште нема испратени пораки.</div>}
      <p className="note">Секоја е-пошта испратена од програмата (фактури, опомени, потврди за уплата, плати, пораки до клиентот…) се запишува тука, со состојбата на праќањето. Опомените преземени како PDF или испратени преку WhatsApp / Viber се прикажани од нивната евиденција.</p>
    </>
  );
}
