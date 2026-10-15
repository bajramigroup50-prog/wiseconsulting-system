/**
 * „🗂 Целосен извештај за фирма“ (new, office OWNER only — like the contracts, the fees and the productivity report):
 * the owner picks ANY firm (searchable, not the selected-firm cookie) and a year / date, and gets everything about it in
 * one report — basic data and the contract, revenue and expenses, money, receivables / payables and loans, VAT, payroll
 * and МПИН, stock and fixed assets, deadlines, every control of the program with its law and article (and the stored
 * article text), documents and who worked on the firm, AI cost, and a free conclusion; „💲 AI анализа“ optional.
 * Each section has its status and links to the screen that fixes it. Print / server PDF (`/print/firmIzv`) and Word
 * (`/firmIzv/word`). Every other role gets nothing.
 */
import { notFound } from 'next/navigation';
import { Hd } from '@/components/hd';
import { AutoRefresh } from '@/components/auto-refresh';
import { requireUser } from '@/lib/auth';
import { calendarYear, currentFirm, currentYear } from '@/lib/context';
import { OWNER_ONLY_MSG } from '@/lib/office-owner';
import { FiAiButton, FiBody, FiPicker } from './client';
import { FI_TITLE, fiAi, fiFirms, fiHtml, fiOwnerUser, fiParams, fiQuery, fiReport } from './lib';

export const metadata = { title: 'Целосен извештај за фирма' };

export default async function FirmIzvPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const u = await fiOwnerUser();
  if (!u) {
    const u0 = await requireUser();
    if (u0.role === 'klient' || u0.role === 'teren') notFound();
    return <><Hd t={FI_TITLE} exp={false} /><div className="card empty">{OWNER_ONLY_MSG}</div></>;
  }
  const p = fiParams(await searchParams);
  const cy = calendarYear();
  const years = Array.from({ length: cy - 2015 + 2 }, (_, i) => cy + 1 - i);
  const F = await fiFirms(u);
  const head = <Hd t={FI_TITLE} sub="само за сопственикот" exp={false} />;
  if (!p.f) {
    return (
      <>
        {head}
        <FiPicker firms={F} f={null} y={p.y} to={p.to} years={years} />
        <div className="card empty">Изберете фирма – извештајот се пресметува на барање, само за неа (сите износи од книгите).</div>
      </>
    );
  }
  const [R, ai, cur, wy] = await Promise.all([
    fiReport(u, { ...p, f: p.f }), fiAi(p.f, p.y),
    currentFirm(u, { check: false }).catch(() => null), currentYear({ check: false }).catch(() => cy),
  ]);
  if (!R) return <>{head}<FiPicker firms={F} f={null} y={p.y} to={p.to} years={years} /><div className="callout bad">Фирмата не постои.</div></>;
  const q = fiQuery({ f: p.f, y: p.y, to: R.to });
  return (
    <>
      {head}
      <FiPicker firms={F} f={p.f} y={p.y} to={R.to} years={years} />
      <div className="row noprint" style={{ gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
        <a className="btn pri" href={`/print/firmIzv?${q}`} target="_blank" rel="noopener">🖨 Печати / ⬇ PDF</a>
        <a className="btn" href={`/firmIzv/word?${q}`}>⬇ Word</a>
        <FiAiButton firmId={p.f} year={p.y} to={R.to} queued={ai?.status === 'queued'} />
        {ai?.status === 'queued' && <AutoRefresh seconds={5} />}
      </div>
      <FiBody html={fiHtml(R, 'screen', ai, u.name)} firmId={p.f} year={p.y} current={cur?.id ?? null} currentYear={wy} />
    </>
  );
}
