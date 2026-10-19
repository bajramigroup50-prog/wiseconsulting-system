/**
 * „⚠ Што фали“ on the dashboard, under the hero: what the client still has to send (the same list as „📨 Побарај од
 * клиентот“ on Преглед на внес – statements per account and month, months without invoices) and the autopilot's open
 * findings of the firm. Never breaks the dashboard: on an error it shows nothing.
 */
import Link from 'next/link';
import { entryOverview } from '@wise/db';
import { vnesRequest } from '@wise/core/office/vnes-request';
import { getOfficeProfile } from '@wise/db';
import { db } from '@/lib/db';
import { VnesAutopBox } from './vnes/autop-box';

type F = Parameters<typeof entryOverview>[1];

export async function DashMissing({ firm, year, today }: { firm: F & { id: string; name: string }; year: number; today: string }) {
  let items: string[] = [];
  try {
    const [O, office] = await Promise.all([db().transaction((tx) => entryOverview(tx, firm, year)), getOfficeProfile(db())]);
    items = vnesRequest({ firmName: firm.name, officeName: office.name, year, today, accounts: O.accounts, months: O.months }).items;
  } catch { items = []; }
  return (
    <>
      {items.length > 0 ? (
        <div className="card" style={{ borderColor: 'var(--warn, #c80)' }}>
          <div className="hd"><h2 style={{ margin: 0 }}>⚠ Што фали од клиентот ({items.length})</h2>
            <span className="row" style={{ gap: 6 }}><Link className="btn sm pri" href="/vnes">📨 Побарај од клиентот</Link><Link className="btn sm" href="/vnes">Преглед на внес →</Link></span></div>
          <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>{items.map((x) => <li key={x}>{x}</li>)}</ol>
        </div>
      ) : <div className="callout good">✓ Од клиентот не фали ништо за поминатите месеци (изводи, излезни и влезни фактури).</div>}
      <VnesAutopBox firmId={firm.id} />
    </>
  );
}
