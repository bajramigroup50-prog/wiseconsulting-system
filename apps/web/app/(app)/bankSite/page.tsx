/**
 * „🏦 Конта за изводи – за сите фирми“ (Изводи → ⚙ Поставки → „За сите фирми“, office OWNER only): the three actions of
 * „Конта за изводи“ — the bank konto of each account by its bank, own transfers 1009 → 10091, the statements re-posted
 * „збирно“ — for every real firm at once. First a preview (nothing changes; firms and steps can be unticked), then,
 * after the backup confirmation, the worker applies them firm by firm (each firm its own transaction, totals checked)
 * with progress; the result per firm (done / skipped / error) can be downloaded as Excel. Demo firms are never listed.
 */
import { notFound } from 'next/navigation';
import { bankKontaAllRun } from '@wise/db';
import { Hd } from '@/components/hd';
import { hubTabs } from '@/components/hub-tabs';
import { requireUser } from '@/lib/auth';
import { currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { OWNER_ONLY_MSG } from '@/lib/office-owner';
import { lastServerBackup } from '@/lib/sysdata';
import { BankSiteClient } from './client';
import { BS_TITLE, bsOwnerUser, bsYear } from './lib';

export default async function BankSitePage({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const u = await requireUser();
  if (u.role === 'klient' || u.role === 'teren') notFound();
  const owner = await bsOwnerUser();
  if (!owner) return <><Hd t={BS_TITLE} exp={false} /><div className="card empty">{OWNER_ONLY_MSG}</div></>;
  const sp = await searchParams;
  const year = bsYear(sp.y, await currentYear({ check: false }));
  const [run, srv] = await Promise.all([bankKontaAllRun(db()), lastServerBackup().catch(() => null)]);
  return (
    <>
      {await hubTabs('izvodiCfg', 'bankSite')}
      <Hd t={BS_TITLE} sub="Примени и прекнижи · 1009 → 10091 · изводи збирно – за сите фирми одеднаш" exp={false} />
      <BankSiteClient year={year} run={run} backup={srv ? { at: srv.at, file: srv.file ?? null } : null} />
    </>
  );
}
