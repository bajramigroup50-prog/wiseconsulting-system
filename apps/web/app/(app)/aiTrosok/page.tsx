/**
 * 💲 AI трошок (Систем, owner only — `lib/office-owner.ts`): what AI reading costs the office, per month, per firm, per
 * document kind and per model — reads (free / AI / reused), calls, tokens, USD, the average per document and the
 * projection for the month; plus the monthly AI limit (office and per firm), the page cap and the Opus policy.
 * Data: `ai_usage` (every model call, reserved before / settled after) and `ai_documents` (every read).
 * How it works: docs/AI-TROSHOK.md.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { costReport, monthProjection, pct, type CostLine } from '@wise/core/ai/cost';
import { MON_MK, todaySkopje, ymAdd } from '@wise/core/office/dates';
import { aiBudgetStatus, aiDocAgg, aiUsageAgg } from '@wise/db';
import { ActionForm, Submit } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { viewAllowed } from '@/lib/nav';
import { allowedFirms } from '@/lib/office';
import { OWNER_ONLY_MSG, isOfficeOwner } from '@/lib/office-owner';
import { saveAiBudget, saveFirmAiLimit } from './actions';

const T = '💲 AI трошок';
const $ = (n: number, d = 2) => '$' + n.toFixed(d);
const n0 = (n: number) => Math.round(n).toLocaleString('mk-MK');
const ml = (m: string) => `${MON_MK[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;

function Table({ title, rows, first }: { title: string; rows: CostLine[]; first: string }) {
  if (!rows.length) return null;
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <table className="dense">
        <thead><tr>
          <th>{first}</th><th className="num">Читања</th><th className="num" title="Прочитано без AI (PDF со текст, Excel/CSV/XML, UBL)">Без AI</th>
          <th className="num">Со AI</th><th className="num" title="Иста датотека веќе прочитана – резултатот е повторно искористен, без нов трошок">Од кеш</th>
          <th className="num">AI повици</th><th className="num">Токени влез</th><th className="num">Токени излез</th><th className="num">USD</th><th className="num" title="USD ÷ документи прочитани со AI">Просек / док.</th>
        </tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.key}>
            <td>{r.label}</td><td className="num">{n0(r.reads)}</td><td className="num">{n0(r.free)}</td><td className="num">{n0(r.ai)}</td><td className="num">{n0(r.cached)}</td>
            <td className="num">{n0(r.calls)}</td><td className="num">{n0(r.tokensIn)}</td><td className="num">{n0(r.tokensOut)}</td>
            <td className="num"><b>{$(r.costUsd, 3)}</b></td><td className="num">{r.avgPerDoc == null ? '—' : $(r.avgPerDoc, 4)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default async function AiTrosokPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const u = await requireUser();
  if (u.role === 'klient' || u.role === 'teren') notFound();
  if (!viewAllowed(u.role, 'aiTrosok') || !(await isOfficeOwner(u))) return <><Hd t={T} exp={false} /><div className="card empty">{OWNER_ONLY_MSG}</div></>;
  const today = todaySkopje();
  const cur = today.slice(0, 7);
  const sp = await searchParams;
  const m = sp.m && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) && sp.m <= cur ? sp.m : cur;
  const F = await allowedFirms(u, { year: 'all' });
  const name = new Map(F.map((f) => [f.id, f.name]));
  const [U, D, S] = await Promise.all([aiUsageAgg(db(), m), aiDocAgg(db(), m), aiBudgetStatus(db(), null, cur)]);
  const R = costReport(m, today, U, D, (id) => (id ? name.get(id) ?? '(друга фирма)' : 'Канцеларија (без фирма)'));
  const B = S.cfg;
  const p = pct(S.spent, S.limit);
  const proj = monthProjection(S.spent, cur, today);
  const months = Array.from({ length: 12 }, (_, i) => ymAdd(cur, -i));
  const firmLimits = Object.entries(B.firms).map(([id, v]) => ({ id, v, name: name.get(id) ?? '(фирма)' })).sort((a, b) => a.name.localeCompare(b.name, 'mk'));
  const firmSpent = new Map(R.byFirm.map((x) => [x.key, x.costUsd]));
  const curFirmSpent = m === cur ? firmSpent : new Map((await aiUsageAgg(db(), cur)).reduce((M, r) => M.set(r.firmId ?? '-', (M.get(r.firmId ?? '-') ?? 0) + r.costUsd), new Map<string, number>()));
  return (
    <>
      <Hd t={T} sub={ml(m)} exp={false} />
      <div className={`callout ${S.level === 100 ? 'bad' : S.level === 80 ? 'warn' : 'good'}`}>
        <b>Овој месец ({ml(cur)}):</b> потрошено <b>{$(S.spent)}</b>
        {S.limit != null ? <> од лимит <b>{$(S.limit)}</b> ({p}%)</> : <> – <b>без месечен лимит</b></>}
        {' · '}проекција до крајот на месецот <b>{$(proj)}</b>
        {S.level === 100 && <div style={{ marginTop: 6 }}>⛔ {S.msg}</div>}
        {S.level === 80 && <div style={{ marginTop: 6 }}>⚠ {S.msg}</div>}
        {S.limit != null && proj > S.limit && S.level < 100 && <div style={{ marginTop: 6 }}>Со ова темпо лимитот ќе биде достигнат пред крајот на месецот.</div>}
      </div>

      <form className="card" method="get">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="f" style={{ margin: 0 }}>Месец<select name="m" defaultValue={m} style={{ width: 'auto' }}>{months.map((x) => <option key={x} value={x}>{ml(x)}</option>)}</select></label>
          <button className="btn">Прикажи</button>
        </div>
        <div className="row" style={{ gap: 18, flexWrap: 'wrap', marginTop: 10 }}>
          <span>Читања: <b>{n0(R.total.reads)}</b></span>
          <span>без AI: <b>{n0(R.total.free)}</b>{R.total.reads ? ` (${Math.round((R.total.free / R.total.reads) * 100)}%)` : ''}</span>
          <span>со AI: <b>{n0(R.total.ai)}</b></span>
          <span>од кеш: <b>{n0(R.total.cached)}</b></span>
          <span>AI повици: <b>{n0(R.total.calls)}</b></span>
          <span>USD: <b>{$(R.total.costUsd, 3)}</b></span>
          <span>просек по AI-документ: <b>{R.total.avgPerDoc == null ? '—' : $(R.total.avgPerDoc, 4)}</b></span>
          {m === cur && <span>проекција: <b>{$(R.projection)}</b></span>}
        </div>
      </form>

      <Table title="По вид на документ" rows={R.byKind} first="Вид" />
      <Table title="По фирма" rows={R.byFirm} first="Фирма" />
      <Table title="По модел" rows={R.byModel} first="Модел" />
      {!R.byKind.length && <div className="card empty">Нема читања во {ml(m)}.</div>}

      <ActionForm action={saveAiBudget} className="card" reset={false}>
        <h3 style={{ marginTop: 0 }}>Лимит и правила</h3>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="f" style={{ margin: 0 }}>Месечен лимит за AI (USD)
            <input name="monthly" inputMode="decimal" defaultValue={B.monthlyUsd ?? ''} placeholder="без лимит" style={{ width: 120 }} />
          </label>
          <label className="f" style={{ margin: 0 }}>Најмногу страници по AI-читање
            <input name="maxPages" type="number" min={1} max={500} defaultValue={B.maxPages} style={{ width: 90 }} />
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" name="opusOnlyDeep" defaultChecked={B.opusOnlyDeep} /> Најскапиот модел (Opus) само при „🔍 Подетално читање“
          </label>
          <Submit>Зачувај</Submit>
        </div>
        <p className="note" style={{ margin: '8px 0 0' }}>
          На 80% од лимитот добивате известување (💲 во горната лента); на 100% AI-читањето се паузира до крајот на месецот –
          изводи, бруто биланси, фактури и записници со текст (PDF, Excel, CSV, XML, Word) и понатаму се читаат <b>без AI</b>.
          Празно поле = без лимит. Препорака: поставете и лимит во Anthropic конзолата (docs/AI-TROSHOK.md).
        </p>
      </ActionForm>

      <ActionForm action={saveFirmAiLimit} className="card" reset>
        <h3 style={{ marginTop: 0 }}>Лимит по фирма (по избор)</h3>
        {firmLimits.length > 0 && (
          <table className="dense" style={{ marginBottom: 10 }}>
            <thead><tr><th>Фирма</th><th className="num">Лимит</th><th className="num">Потрошено ({ml(cur)})</th></tr></thead>
            <tbody>{firmLimits.map((x) => <tr key={x.id}><td>{x.name}</td><td className="num">{$(x.v)}</td><td className="num">{$(curFirmSpent.get(x.id) ?? 0, 3)}</td></tr>)}</tbody>
          </table>
        )}
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="f" style={{ margin: 0 }}>Фирма<select name="firm" defaultValue="" style={{ width: 'auto', maxWidth: 300 }}>
            <option value="">— изберете —</option>
            {F.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select></label>
          <label className="f" style={{ margin: 0 }}>Месечен лимит (USD)<input name="limit" inputMode="decimal" placeholder="празно = отстрани" style={{ width: 130 }} /></label>
          <Submit className="btn">Постави</Submit>
        </div>
      </ActionForm>
      <p className="note"><Link href="/sistem">← Систем</Link></p>
    </>
  );
}
