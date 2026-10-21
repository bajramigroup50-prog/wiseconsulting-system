/**
 * „🤖 Автопилот“ inside Преглед на внес: every open finding of the working firm (supplier paid without an invoice,
 * customer prepayment, lines without a partner, statements, VAT …) where the input is checked, so the step is never
 * skipped – each one opens its screen; „✓“ = seen, not shown again (same as on /autop).
 */
import Link from 'next/link';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { AL_DESC } from '@wise/core/office';
import { autopilotFindings } from '@wise/db';
import { db } from '@/lib/db';
import { hrefFor } from '@/lib/nav';
import { Pill } from '@/components/file-chips';
import { RowAction } from '@/components/row-action';
import { ackFinding, recheckFirm } from '../autop/actions';

const LV: Record<string, string> = { bad: 'bad', warn: 'warn', info: 'info' };

export async function VnesAutopBox({ firmId }: { firmId: string }) {
  const F = (await db().select().from(autopilotFindings)
    .where(and(eq(autopilotFindings.firmId, firmId), isNull(autopilotFindings.resolvedAt), isNull(autopilotFindings.ackAt), ne(autopilotFindings.lvl, 'info'))))
    .sort((a, b) => (a.lvl === 'bad' ? 0 : 1) - (b.lvl === 'bad' ? 0 : 1) || a.cat.localeCompare(b.cat, 'mk'));
  // „↻ Провери пак“: re-check this firm now (after a fix), without waiting for the 6-hourly run
  const again = <RowAction className="btn sm ghost" action={recheckFirm} label="↻ Провери пак" title="Провери ја оваа фирма сега" showOk />;
  if (!F.length) return <div className="callout good noprint">🤖 Автопилот: ✓ нема ништо за решавање кај оваа фирма. {again}</div>;
  const bad = F.filter((x) => x.lvl === 'bad').length;
  return (
    <details className="card noprint" open style={{ borderColor: bad ? 'var(--bad, #c33)' : undefined }}>
      <summary style={{ cursor: 'pointer' }}><b>🤖 Автопилот – {F.length} за решавање</b>{bad ? <> · <span className="bad">⛔ {bad}</span></> : null} <Link className="mini" href="/autop?tab=firms">сите фирми →</Link> {again}</summary>
      <div style={{ fontSize: 12.5, marginTop: 6 }}>
        {F.map((x) => (
          <div key={x.id} title={AL_DESC[x.cat]} className="row" style={{ gap: 6, alignItems: 'center', padding: '2px 0' }}>
            <Pill c={LV[x.lvl]}>{x.cat}</Pill>
            {x.go ? <Link href={hrefFor(x.go)}>{x.txt}</Link> : <span>{x.txt}</span>}
            <RowAction action={ackFinding.bind(null, x.id)} label="✓" title="Видено – не прикажувај" />
          </div>
        ))}
      </div>
    </details>
  );
}
