/**
 * UX Phase 3 (docs/ux-rindertim.md P2/P28) — „Преглед за книжење“: ONE review of every unbooked statement line of the
 * firm, across statements (it replaces going statement by statement through „Прокнижи автоматски“ → AI → „✓ {konto}“).
 * One pass proposes: learned rules / payment codes / own transfer / turnover / cash / POS / fee, the invoice match
 * (reference → number → exact amount → FIFO with partial payments) and, only for what is left and only on the explicit
 * button, AI (its cost shown, blocked while the budget guard has paused AI). Grouped by confidence, each line with its
 * reason. The program PREPARES; a person confirms („✓ Прокнижи ги сигурните“ / „✓ Прокнижи ги избраните“).
 * Same view as Изводи (`banka`): same access, same actions.
 */
import Link from 'next/link';
import { REVIEW_CONF_LBL, type ReviewConf } from '@wise/core';
import { bookingReview, effectiveChart, reviewAiStep, type ReviewItem } from '@wise/db';
import { booksPage, canDo, partnerOptions } from '@/lib/books';
import { AUTO_LBL } from '@/lib/bank';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { hubTabs } from '@/components/hub-tabs';
import { AiBadge } from '@/components/ai-badge';
import { ClassifyButton } from '../classify-button';
import { applyBankClassifyAction } from '../classify-actions';
import { bankClassifyProposals } from '../classify';
import { confirmReviewAction } from '../review-actions';

const T = 'Преглед за книжење';
const BASE = '/banka/pregled';
const CONF_PILL: Record<ReviewConf, string> = { sure: 'good', likely: 'warn', manual: 'bad' };
const CONF_NOTE: Record<ReviewConf, string> = {
  sure: 'научено правило, шифра на плаќање, сопствен пренос, провизија или фактура по повикување на број / износ кај истиот комитент',
  likely: 'FIFO по отворени фактури, нов комитент, аванс, дневен промет / готовина, само по текст – проверете',
  manual: 'нема предлог, контото го нема во контниот план или треба комитент – прокнижете рачно',
};

export default async function PregledPage({ searchParams }: { searchParams: Promise<{ ai?: string }> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('banka');
  if (!firm) return <NoFirm t={T} />;
  const write = canDo(u, 'write', firm.id);
  const R = await db().transaction((tx) => bookingReview(tx, firm.id));
  const [chart, P, ai] = await Promise.all([
    effectiveChart(db(), firm.id),
    partnerOptions(firm.id),
    write ? db().transaction((tx) => reviewAiStep(tx, firm.id, R.aiLines.length)) : Promise.resolve(null),
  ]);
  const aiProps = write && sp.ai ? await bankClassifyProposals(firm.id, year, sp.ai) : null;
  const kName = new Map(chart.map((a) => [a.code, a.name]));
  const pName = new Map(P.map((p) => [p.id, p.name]));
  const open = R.items.filter((i) => !i.locked);
  const locked = R.items.filter((i) => i.locked);
  const byConf = (c: ReviewConf) => open.filter((i) => i.conf === c);
  const lineById = new Map(R.items.map((i) => [i.lineId, i]));

  const row = (i: ReviewItem, pick: boolean) => (
    <tr key={i.lineId}>
      <td>{pick && write ? <input type="checkbox" name="ln" value={i.lineId} defaultChecked={i.conf === 'sure'} aria-label="Избери" /> : null}</td>
      <td>{dmy(i.date)}</td>
      <td><small>{i.account}<br />бр. {i.statementNo || '—'} · ред {i.lineNo}</small></td>
      <td style={{ minWidth: 200 }}>{i.name ? <b>{i.name}</b> : null}{i.name ? <br /> : null}<small>{i.desc}</small></td>
      <td className="n amt-od">{i.amount < 0 ? fmt(-i.amount) : ''}</td>
      <td className="n amt-pr">{i.amount > 0 ? fmt(i.amount) : ''}</td>
      <td>
        {i.konto ? <><b>{i.konto}</b> <small>{kName.get(i.konto) ?? ''}</small></> : <span className="mini">—</span>}
        {i.partnerId ? <div><small>{pName.get(i.partnerId) ?? ''}</small></div> : i.newPartner ? <div><small>нов комитент: <b>{i.newPartner}</b></small></div> : null}
        {i.refs?.length ? <div><small>{i.refs.map((r) => `${r.label}: ${fmt(r.amt)}`).join(' · ')}{i.excess ? ` · аванс ${fmt(i.excess)}` : ''}</small></div> : null}
      </td>
      <td style={{ maxWidth: 320 }}>
        {i.how ? <span className="pill info">{AUTO_LBL[i.how] ?? i.how}</span> : null} <small>{i.why}</small>
        {!pick && !i.locked && write && <div><Link className="btn sm" href={`/${i.fx ? 'devizni' : 'banka'}?line=${i.lineId}#bk-line`}>Прокнижи рачно…</Link></div>}
      </td>
    </tr>
  );
  const table = (L: ReviewItem[], pick: boolean) => (
    <div className="tw"><table className="dense">
      <thead><tr><th></th><th>Датум</th><th>Извод</th><th>Комитент / опис</th><th className="n amt-od" title="должува по изводот">Одлив</th><th className="n amt-pr" title="побарува по изводот">Прилив</th><th>Предлог</th><th>Причина</th></tr></thead>
      <tbody>{L.map((i) => row(i, pick))}</tbody>
    </table></div>
  );

  return (
    <>
      {await hubTabs('izvodi', 'banka', BASE)}
      <Hd t={T} sub="сите непрокнижени ставки од сите изводи на фирмата">
        <Link className="btn" href="/banka">← Изводи</Link>
      </Hd>
      <p className="note">
        Програмата ги <b>подготвува</b> предлозите (научени правила, шифра на плаќање, пренос меѓу свои сметки, дневен промет, готовина, POS,
        провизии, фактури по повикување на број / износ / FIFO), а вие ги <b>потврдувате</b>. Ставките во заклучен период не се менуваат.
      </p>
      {!open.length && !locked.length && <div className="card empty">Нема непрокнижени ставки од изводи. 🎉</div>}
      {open.length > 0 && (
        <BankForm action={confirmReviewAction}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '6px 0' }}>
            {(['sure', 'likely', 'manual'] as const).map((c) => <span key={c} className={`pill ${CONF_PILL[c]}`}>{REVIEW_CONF_LBL[c]}: {R.counts[c]}</span>)}
            <span style={{ flex: 1 }} />
            {write && R.counts.sure > 0 && <button className="btn pri" name="mode" value="sure">✓ Прокнижи ги сигурните ({R.counts.sure})</button>}
            {write && R.counts.sure + R.counts.likely > 0 && <button className="btn" name="mode" value="selected">✓ Прокнижи ги избраните</button>}
          </div>
          {(['sure', 'likely'] as const).map((c) => byConf(c).length > 0 && (
            <div className="card" key={c}>
              <h2><span className={`pill ${CONF_PILL[c]}`}>{REVIEW_CONF_LBL[c]}</span> {byConf(c).length} ставки</h2>
              <p className="note">{CONF_NOTE[c]}</p>
              {table(byConf(c), true)}
            </div>
          ))}
          {byConf('manual').length > 0 && (
            <div className="card">
              <h2><span className="pill bad">{REVIEW_CONF_LBL.manual}</span> {byConf('manual').length} ставки</h2>
              <p className="note">{CONF_NOTE.manual}</p>
              {table(byConf('manual'), false)}
            </div>
          )}
        </BankForm>
      )}

      {write && ai && (ai.lines > 0 || aiProps) && (
        <div className="card">
          <h2>🤖 Останати ставки – предлог со AI</h2>
          {aiProps ? (aiProps.length ? (
            <BankForm action={applyBankClassifyAction}>
              <input type="hidden" name="ai" value={sp.ai} />
              <div className="tw"><table className="dense">
                <thead><tr><th></th><th>Датум</th><th>Опис</th><th className="n">Износ</th><th>Предлог</th><th>Причина</th></tr></thead>
                <tbody>{aiProps.map((p) => { const l = lineById.get(p.id); return (
                  <tr key={p.id}>
                    <td><input type="checkbox" name="accept" value={p.id} aria-label="Прифати" /></td>
                    <td>{l ? dmy(l.date) : ''}</td><td style={{ minWidth: 220 }}>{l?.desc ?? ''}</td><td className="n">{l ? fmt(l.amount) : ''}</td>
                    <td>{p.ref ? <span className="pill good">{p.ref.type === 'invoice' ? 'Наша фактура' : 'Влезна ф-ра'}</span> : <span className="pill info">{p.konto} {kName.get(p.konto ?? '') ?? ''}</span>}</td>
                    <td><small>{p.reason}</small> <span className="pill warn">веројатно</span></td>
                  </tr>); })}</tbody>
              </table></div>
              <div className="row"><span className="note">AI предлага само конто или фактура (никогаш износ). Ставките ќе бидат означени „препознаено – провери“.</span><span style={{ flex: 1 }} /><button className="btn pri">✓ Прокнижи ги избраните</button></div>
            </BankForm>
          ) : <p className="note">AI не ги препозна ставките; прокнижете ги рачно.</p>) : ai.paused ? (
            <div className="callout warn">{ai.msg || 'AI е паузирано (лимит на трошок).'} Ставките ({ai.lines}) прокнижете ги рачно.</div>
          ) : (
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <ClassifyButton base={BASE} />
              <span className="note">Само за {ai.lines} ставки што ниту едно правило не ги препознало · проценет трошок ≈ ${ai.estUsd.toFixed(ai.estUsd < 0.1 ? 3 : 2)} <AiBadge /></span>
            </div>
          )}
        </div>
      )}

      {locked.length > 0 && (
        <details className="card">
          <summary>🔒 Во заклучен период / налог: {locked.length} ставки (не се менуваат)</summary>
          {table(locked, false)}
        </details>
      )}
    </>
  );
}
