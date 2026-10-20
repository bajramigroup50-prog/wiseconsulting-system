/**
 * Under the dashboard hero: the firm's open autopilot findings (one cheap query) and a link to „Преглед на внес“ for
 * what the client still has to send. The full list (entryOverview over the whole year) is NOT computed here: on every
 * dashboard load it took the page to 15–50 s; it stays on /vnes, where it is asked for.
 */
import Link from 'next/link';
import { VnesAutopBox } from './vnes/autop-box';

export async function DashMissing({ firm }: { firm: { id: string } }) {
  return (
    <>
      <VnesAutopBox firmId={firm.id} />
      <div className="row noprint" style={{ gap: 8, margin: '0 0 8px' }}>
        <Link className="btn" href="/vnes">📨 Што фали од клиентот → Преглед на внес</Link>
      </div>
    </>
  );
}
