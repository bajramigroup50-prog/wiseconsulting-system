/** Legacy `VIEWS.gradbaIzv` 11823 — Градежништво – анализи: contract vs executed vs invoiced, costs by type, result and margin per project. */
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { boqValue, situationCalc, sortSituations } from '@wise/core/industry';
import { constructionProjects, projectCosts, projectSituations } from '@wise/db';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { Hd } from '@/components/hd';

export default async function GradbaIzv() {
  const g = await industryPage('gradbaIzv', 'Градежништво – анализи');
  if (g.blocked) return g.blocked;
  const all = await db().select().from(constructionProjects).where(eq(constructionProjects.firmId, g.firm.id));
  const R = await db().transaction(async (tx) => Promise.all(all.map(async (P) => {
    const S = sortSituations(await projectSituations(tx, P.id));
    const last = S[S.length - 1];
    return { P, v: boqValue(P.boq), done: last ? situationCalc(P.boq, S, last) : { cum: 0, pct: 0 }, k: await projectCosts(tx, g.firm, P) };
  })));
  const tot = R.reduce((s, x) => ({ v: s.v + x.v, d: s.d + x.done.cum, r: s.r + x.k.rev, c: s.c + x.k.tot }), { v: 0, d: 0, r: 0, c: 0 });
  return (
    <>
      <Hd t="Градежништво – анализи"><Link className="btn" href="/gradba">🏗 Објекти</Link></Hd>
      <div className="tw"><table><thead><tr><th>Објект</th><th className="n">Договорено</th><th className="n">Изведено</th><th className="n">%</th><th className="n">Фактурирано</th><th className="n">Материјал</th><th className="n">Готовина</th><th className="n">Труд и машини</th><th className="n">Вкупно трошоци</th><th className="n">Резултат</th><th className="n">Маржа</th></tr></thead>
        <tbody>{R.map(({ P, v, done, k }) => (
          <tr key={P.id}><td><Link href={`/gradba?p=${P.id}`}><b>{P.code}</b> {P.name}</Link></td><td className="n">{fmt(v)}</td><td className="n">{fmt(done.cum)}</td><td className="n">{done.pct}%</td><td className="n">{fmt(k.rev)}</td>
            <td className="n">{fmt(k.pur)}</td><td className="n">{fmt(k.blg)}</td><td className="n">{fmt(k.lab)}</td><td className="n">{fmt(k.tot)}</td><td className="n" style={{ color: k.rev - k.tot < 0 ? 'var(--bad)' : undefined }}><b>{fmt(k.rev - k.tot)}</b></td>
            <td className="n">{k.rev ? Math.round(((k.rev - k.tot) / k.rev) * 100) + '%' : ''}</td></tr>
        ))}
          <tr style={{ background: 'var(--soft)' }}><td><b>Вкупно</b></td><td className="n">{fmt(tot.v)}</td><td className="n">{fmt(tot.d)}</td><td /><td className="n">{fmt(tot.r)}</td><td colSpan={3} /><td className="n">{fmt(tot.c)}</td><td className="n"><b>{fmt(tot.r - tot.c)}</b></td><td /></tr>
        </tbody></table></div>
    </>
  );
}
