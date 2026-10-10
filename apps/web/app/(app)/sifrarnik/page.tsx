/** Legacy `VIEWS.sifrarnik` 6984 — Шифрарник › Сите шифрарници: every codebook by group, with row counts. */
import Link from 'next/link';
import { and, eq, sql } from 'drizzle-orm';
import { SIFRARNIK_GROUPS } from '@wise/core/codebooks';
import { bankAccounts, codebookCounts, effectiveChart, employees, items, partners } from '@wise/db';
import { booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { Hd } from '@/components/hd';

/** Sub-screens that live elsewhere in the new app. */
const HREF: Record<string, string> = { uslugiS: '/artikli', banke: '/banka' };

export default async function SifrarnikPage() {
  const { firm } = await booksPage('sifrarnik');
  const n = (q: Promise<{ n: number }[]>) => q.then((r) => r[0]?.n ?? 0);
  const cnt = sql<number>`count(*)::int`;
  const [cb, it, sv, pa, em, ba, ch] = await Promise.all([
    codebookCounts(db(), firm?.id ?? null),
    firm ? n(db().select({ n: cnt }).from(items).where(eq(items.firmId, firm.id))) : null,
    firm ? n(db().select({ n: cnt }).from(items).where(and(eq(items.firmId, firm.id), eq(items.type, 'service')))) : null,
    firm ? n(db().select({ n: cnt }).from(partners).where(eq(partners.firmId, firm.id))) : null,
    firm ? n(db().select({ n: cnt }).from(employees).where(eq(employees.firmId, firm.id))) : null,
    firm ? n(db().select({ n: cnt }).from(bankAccounts).where(eq(bankAccounts.firmId, firm.id))) : null,
    effectiveChart(db(), firm?.id ?? null).then((c) => c.length),
  ]);
  const count = (v: string): number | null =>
    v.startsWith('cb_') ? cb[v.slice(3)] ?? 0
      : ({ artikli: it, uslugiS: sv, partneri: pa, vraboteni: em, banke: ba, konto: ch } as Record<string, number | null>)[v] ?? null;
  return (
    <>
      <Hd t="Шифрарник" sub={firm?.name} />
      {!firm && <div className="callout">Изберете фирма за шифрарниците на фирмата (магацини, продавници, благајни…). Градовите, општините и државите се заеднички.</div>}
      <div className="cols">
        {SIFRARNIK_GROUPS.map(([g, L]) => (
          <div className="card" key={g}>
            <h2>{g}</h2>
            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              {L.map(([v, t]) => {
                const c = count(v);
                return (
                  <Link key={v} className="btn" style={{ display: 'flex', justifyContent: 'space-between' }} href={HREF[v] ?? `/${v}`}>
                    <span>{t}</span><span className="pill">{c ?? ''}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
