/** Даночни тарифи (legacy `VIEWS.tarifi` 12844, the editable final version): VAT kontos per rate for the firm or all firms. */
import Link from 'next/link';
import { schemeValue, vatAccount } from '@wise/core';
import { effectiveChart, loadVatPostingContext, type Firm } from '@wise/db';
import type { SessionUser } from '@/lib/auth';
import { canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { Hd } from '@/components/hd';
import { VatAccountsForm } from './forms';

export async function TarifiView({ firm, u, back }: { firm: Firm; u: SessionUser; back: { href: string; label: string } }) {
  const ctx = await loadVatPostingContext(db(), firm);
  const chart = await effectiveChart(db(), firm.id);
  const names = Object.fromEntries(chart.map((a) => [a.code, a.name]));
  const values: Record<string, string> = {};
  for (const r of [18, 10, 5]) {
    values['o' + r] = vatAccount(ctx, 'out', r) ?? '';
    values['i' + r] = vatAccount(ctx, 'in', r) ?? '';
    values['m' + r] = vatAccount(ctx, 'imp', r) ?? '';
  }
  for (const k of ['r32out', 'r32in', 'ddvPay', 'ddvClaim']) values[k] = schemeValue(ctx, k);
  const can = canDo(u, 'settings', firm.id);
  return (
    <>
      <Hd t="Даночни тарифи" sub="ДДВ – конта"><Link className="btn" href={back.href}>{back.label}</Link></Hd>
      {!can && <div className="callout">Само преглед – за промена е потребна дозвола „поставки“.</div>}
      <VatAccountsForm values={values} names={names} firmName={firm.name} canGlobal={u.role === 'admin'}
        options={chart.filter((a) => /^(13|23)/.test(a.code)).map((a) => [a.code, a.name])} />
    </>
  );
}
