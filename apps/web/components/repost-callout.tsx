/**
 * Legacy `oldVatHTML` (invoice lists, nalozi): documents of the year still booked with VAT on a summary konto →
 * „Прекнижи ги сега“ (legacy `schRepost`). With `always` (Шеми) the button is shown as „Прекнижи ја {year} според шемите“.
 * Server component: only the bound server action goes to the client button.
 */
import { can } from '@wise/core';
import { oldVatText, repostConfirm } from '@wise/core/repost';
import { oldVatDocs } from '@wise/db';
import type { SessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { RowAction } from '@/components/row-action';
import { repostYearAction } from '@/app/(app)/_repost/actions';

export async function RepostCallout({ u, firmId, year, always }: { u: SessionUser; firmId: string; year: number; always?: boolean }) {
  const ok = can(u.principal, 'settings', firmId);
  if (always) return ok ? <RowAction className="btn" action={repostYearAction} label={`Прекнижи ја ${year} според шемите`} confirm={repostConfirm(year)} showOk /> : null;
  const n = await db().transaction((tx) => oldVatDocs(tx, firmId, year));
  if (!n) return null;
  return (
    <div className="callout warn row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <span><b>{n} документи</b>{oldVatText(n).slice(String(n).length + ' документи'.length)}</span>
      {ok && <RowAction className="btn pri" action={repostYearAction} label="Прекнижи ги сега" confirm={repostConfirm(year)} showOk />}
    </div>
  );
}
