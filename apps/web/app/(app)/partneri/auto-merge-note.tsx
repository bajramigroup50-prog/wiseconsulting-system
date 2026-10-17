/**
 * „Автоматски споени: N (последно …)“ on the partners screens, with a link to the activity log of the automatic merges,
 * and — for the owner / an admin — the switch „Автоматски спојувај сигурни дупликати“ (on by default).
 */
import Link from 'next/link';
import { autoMergeDupOn, PARTNER_AUTO_MERGE, partnerAutoMergeStats } from '@wise/db';
import { db } from '@/lib/db';
import { RowAction } from '@/components/row-action';
import { setAutoMergeDupAction } from './actions';

const when = (d: Date) => d.toLocaleString('mk-MK', { timeZone: 'Europe/Skopje', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export async function AutoMergeNote({ firm, admin, log }: { firm: { id: string; settings: Record<string, unknown> | null }; admin: boolean; log: boolean }) {
  const on = autoMergeDupOn(firm.settings);
  const S = await partnerAutoMergeStats(db(), firm.id);
  if (!on && !admin && !S.n) return null;
  return (
    <p className="note row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 8px' }}>
      <span>
        {on ? 'Автоматски спојување на сигурни дупликати (ист ЕДБ / ЕМБС или речиси исто име): вклучено.' : 'Автоматското спојување на сигурни дупликати е исклучено.'}
        {S.n > 0 && <> Автоматски споени: <b>{S.n}</b>{S.last && ` (последно ${when(S.last)})`}</>}
      </span>
      {S.n > 0 && log && <Link className="btn sm ghost" href={`/aktivnost?a=${PARTNER_AUTO_MERGE}&f=${firm.id}`}>Дневник →</Link>}
      {admin && <RowAction className="btn sm ghost" action={setAutoMergeDupAction.bind(null, !on)} label={on ? 'Исклучи' : 'Вклучи'}
        title="„Автоматски спојувај сигурни дупликати“ – по скенирање, увоз и секоја ноќ" showOk />}
    </p>
  );
}
