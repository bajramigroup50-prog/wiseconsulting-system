/**
 * „Збирна аналитичка картица“ (Бруто биланс – рекапитулар, F5 in the old program): the account card of every analytic
 * konto of the trial balance's range (Префикс / Суфикс / Од – До конто, search, partner) in one print, one card after
 * another (`kkTable(X,true)` each), landscape. `ks` = a list of konto prefixes („1200,1210,2200,7“ – a document package's
 * cards: those kontos and every konto of class 7 with turnover).
 */
import { Fragment } from 'react';
import { dmy } from '@/lib/fmt';
import { aggregatedLines } from '@/lib/ledger-agg';
import { inYearOr } from '@/lib/books';
import { bbCardKontos, bbFilterOf } from '@/lib/bb-filter';
import { kkData } from '../../../(app)/kkart/data';
import { KkTable } from '../../../(app)/kkart/table';
import { FirmHead, Sig } from '../../firm-head';
import { printGuard } from '../../guard';

export const metadata = { title: 'Збирна аналитичка картица' };

const MAX = 200;
type SP = { from?: string; to?: string; pre?: string; suf?: string; kf?: string; kt?: string; q?: string; p?: string; ks?: string };

export default async function PrintKkZbir({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { firm, year } = await printGuard('bilanc');
  const from = inYearOr(sp.from, year, `${year}-01-01`), to = inYearOr(sp.to, year, `${year}-12-31`);
  const q = (sp.q ?? '').trim();
  const KS = (sp.ks ?? '').split(/[\s,;]+/).filter((x) => /^\d{1,10}$/.test(x));
  // with `ks` the prefixes pick the kontos first, so the limit counts only those (class 7 is not cut off by 1xxx–6xxx)
  let K = bbCardKontos(await aggregatedLines(firm.id, `${year}-01-01`, to), bbFilterOf(sp), KS.length ? 100000 : MAX + 1);
  if (KS.length) K = K.filter((k) => KS.some((x) => k.startsWith(x)));
  if (/^\d+$/.test(q)) K = K.filter((k) => k.startsWith(q));
  const more = K.length > MAX;
  K = K.slice(0, MAX);
  const p = sp.p && /^[0-9a-f-]{36}$/i.test(sp.p) ? sp.p : undefined;
  const D: Awaited<ReturnType<typeof kkData>>[] = [];
  for (let i = 0; i < K.length; i += 8) D.push(...await Promise.all(K.slice(i, i + 8).map((k) => kkData(firm.id, year, { k, from, to, p }))));
  const shown = D.filter((d) => d.X.rows.length || Math.abs(d.X.opening) > 0.004);
  return (
    <div className="pdfdoc land">
      <style dangerouslySetInnerHTML={{ __html: '@page{size:A4 landscape}' }} />
      <FirmHead firm={firm} title="ЗБИРНА АНАЛИТИЧКА КАРТИЦА" sub={`${dmy(from)} – ${dmy(to)} · ${shown.length} конта${more ? ` (првите ${MAX} – стеснете го опсегот)` : ''}`} />
      {shown.length ? shown.map((d, i) => (
        <Fragment key={d.k}>
          {i > 0 && <div style={{ height: 10 }} />}
          <h2 style={{ fontSize: '10pt', margin: '8px 0 4px' }}>КОНТО {d.k} {d.name}{d.subT}</h2>
          <KkTable d={d} pdf />
        </Fragment>
      )) : <p>Нема картици за избраниот опсег.</p>}
      <Sig who={['Составил', 'Одговорно лице']} />
    </div>
  );
}
