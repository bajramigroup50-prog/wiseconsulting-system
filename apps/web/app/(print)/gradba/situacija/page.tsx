/** Legacy `csPdfHTML` (10085): привремена / окончателна ситуација. */
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { situationCalc, sortSituations } from '@wise/core/industry';
import { constructionProjects, constructionSituations, firmConsConfig, partners, projectSituations } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { DocHead, Signs } from '@/components/industry-print';

export default async function SituationPrint({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const g = await industryPage('gradba', 'Ситуација');
  if (g.blocked || !id) notFound();
  const [s] = await db().select().from(constructionSituations).where(and(eq(constructionSituations.id, id), eq(constructionSituations.firmId, g.firm.id))).limit(1);
  if (!s) notFound();
  const [P] = await db().select().from(constructionProjects).where(eq(constructionProjects.id, s.projectId));
  if (!P) notFound();
  const [inv] = await db().select().from(partners).where(eq(partners.id, P.investorId));
  const c = situationCalc(P.boq, sortSituations(await projectSituations(db(), P.id)), s);
  const rate = firmConsConfig(g.firm).rate;
  return (
    <>
      <DocHead firm={g.firm} title={`${s.kind === 'fin' ? 'ОКОНЧАТЕЛНА' : 'ПРИВРЕМЕНА'} СИТУАЦИЈА бр. ${s.no}`} sub={`${P.code} · ${P.name}`} />
      <p><b>Инвеститор:</b> {inv?.name} · <b>Договор:</b> {P.cno} {P.cdate ? 'од ' + dmy(P.cdate) : ''}<br /><b>Локација:</b> {P.site} · <b>Период:</b> {dmy(s.from)} – {dmy(s.to)}</p>
      <table style={{ fontSize: '8pt' }}><thead><tr><th>Поз.</th><th>Опис</th><th>ЕМ</th><th className="n">Предмер</th><th className="n">Ед. цена</th><th className="n">Претходно</th><th className="n">Оваа сит.</th><th className="n">Вкупно</th><th className="n">Износ оваа сит.</th><th className="n">Износ вкупно</th></tr></thead>
        <tbody>{c.L.map((l) => <tr key={l.i}><td>{l.pos}</td><td>{l.desc}</td><td>{l.unit}</td><td className="n">{l.qty}</td><td className="n">{fmt(l.price)}</td><td className="n">{l.p}</td><td className="n">{l.d}</td><td className="n">{l.c}</td><td className="n">{fmt(l.amt)}</td><td className="n">{fmt(l.c * Number(l.price))}</td></tr>)}
          <tr><td colSpan={8}><b>Вкупно без ДДВ</b></td><td className="n"><b>{fmt(c.cur)}</b></td><td className="n"><b>{fmt(c.cum)}</b></td></tr></tbody></table>
      <p>{P.art32 ? 'Пренесување на даночна обврска согласно член 32-а од Законот за ДДВ – ДДВ пресметува примателот.' : `ДДВ ${rate}%: ${fmt(c.cur * rate / 100)} ден. · Вкупно со ДДВ: ${fmt(c.cur * (1 + rate / 100))} ден.`}</p>
      <Signs L={['Изведувач', 'Надзор', 'Инвеститор']} />
    </>
  );
}
