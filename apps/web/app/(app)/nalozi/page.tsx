/**
 * Legacy `VIEWS.nalozi` 6392 — Финансово › Налози за книжење:
 * list (`nalListHTML` 6388), one nalog (`nalPage` 3573 / `nalogHTML` 3552 / `bankNote` 3597), manual editor (`jEditor`),
 * correction of document nalozi (`nalSaveRows` 3580 → `journal_overrides`), line search, PDF (`nalogPdfZ` 3561,
 * `ledPdf` 7269), Excel (`nalogXlsx` 7345, `ledCsv` 7259).
 */
import Link from 'next/link';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { bankEffKonto, groupNalozi, lineTotals, NAL_DEF, nalCode, bankNalCode, type NalDefKey } from '@wise/core';
import type { CustomScheme } from '@wise/core/finance';
import {
  appSettings, bankAccounts, bankLines, bankStatements, effectiveChart, firmNalogSettings, journalLines, journalOverrideState, journals, lineProblem, loadBankAccounts, partners, purchases,
  SCHEMES_SETTINGS_KEY, statementSuggestions, toBankRow, type LineSuggestion,
} from '@wise/db';
import { booksPage, canDo, partnerOptions, yearRange } from '@/lib/books';
import { RepostCallout } from '@/components/repost-callout';
import { db } from '@/lib/db';
import { dmy, fmt, todayIso } from '@/lib/fmt';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { BankForm } from '@/components/bank-form';
import { ExportBar } from '@/components/parity-fin/export-bar';
import { deleteJournalAction, deleteNalogAction, deleteNalogDocAction, nalogDocDeletePreviewAction, nalogDeletePreviewAction, nalFixAllAction, resetOverrideAction, saveBankNalCodes, saveNalogSettings, setLockDate } from './actions';
import { JournalEditor } from './journal-editor';
import { NalogKeys, OverrideEditor } from './override-editor';
import { newJournal, type EditorJournal } from './editor-model';
import { ImportBox } from '../banka/import-box';
import { deleteStatementAction } from '../banka/actions';
import { StatementsPanel, type PanelStatement } from './statements-panel';
import { unpostRunAction } from '../plati/actions';
import { schemeLabel, schemeProfilesOf, schemeShort } from '@wise/core/scheme-profiles';
import { SchemeRepostBar } from './scheme-repost';

type SP = { n?: string; nov?: string; edit?: string; q?: string; cfg?: string; izv?: string; uvoz?: string };
const KIND_LBL: Record<string, string> = {
  ...Object.fromEntries(Object.entries(NAL_DEF).map(([k, v]) => [k, v[1]])), bank: 'ИЗВОД', manual: 'РАЧЕН НАЛОГ', bbimp: 'БРУТО БИЛАНС', pos: 'POS ПРОВИЗИЈА',
};
const kindLbl = (k: string) => KIND_LBL[k] ?? k.toUpperCase();
const DOC_SCREEN: Record<string, string> = { invoice: '/izlez', purchase: '/vlez', bank_statement: '/banka', cash_voucher: '/blagajna', compensation: '/kompenzacii', payroll: '/plati' };

export default async function NaloziPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('nalozi');
  if (!firm) return <NoFirm t="Налози за книжење" />;
  const { from, to } = yearRange(year);
  const inYear = and(eq(journals.firmId, firm.id), sql`${journals.date} between ${from} and ${to}`);
  const write = canDo(u, 'write', firm.id), fix = canDo(u, 'nalEdit', firm.id), del = canDo(u, 'nalDel', firm.id);
  const locked = (j: { locked: boolean; date: string }) => j.locked || !!(firm.lockDate && j.date <= firm.lockDate);

  /* ---------- editor ---------- */
  if (sp.nov !== undefined || sp.edit) {
    let initial: EditorJournal = newJournal(todayIso().startsWith(String(year)) ? todayIso() : `${year}-12-31`);
    const [chart, P] = await Promise.all([effectiveChart(db(), firm.id), partnerOptions(firm.id)]);
    if (sp.edit) {
      const [j] = await db().select().from(journals).where(and(eq(journals.id, sp.edit), eq(journals.firmId, firm.id))).limit(1);
      if (!j) return <NoFirm t="Налогот не постои" />;
      const isDoc = !!j.sourceType && !['opening', 'bbimp', 'yearClose'].includes(j.sourceType);
      if (isDoc) {
        if (!fix || locked(j)) return <><Hd t={'Налог ' + j.number} exp={false} /><div className="callout bad">Налогот не може да се коригира ({locked(j) ? 'заклучен период' : 'немате право на корекција'}).</div></>;
        const st = await db().transaction((tx) => journalOverrideState(tx, firm.id, j.id));
        return <OverrideEditor journalId={j.id} number={j.number} rows={st.rows ?? []} chart={chart.map((a) => [a.code, a.name])} partners={P} />;
      }
      const L = await db().select().from(journalLines).where(eq(journalLines.journalId, j.id)).orderBy(asc(journalLines.lineNo));
      initial = {
        id: j.id, number: j.number, date: j.date, description: j.description ?? '', periodFrom: j.periodFrom ?? '', periodTo: j.periodTo ?? '',
        // An opened nalog without amounts keeps its konto rows in `meta.rows`.
        rows: L.length
          ? L.map((l) => ({ account: l.account, partnerId: l.partnerId ?? '', debit: Number(l.debit) ? String(Number(l.debit)) : '', credit: Number(l.credit) ? String(Number(l.credit)) : '', note: l.note ?? '', doc: l.doc ?? '' }))
          : ((j.meta as { rows?: { account: string; partnerId: string | null; note: string; doc: string }[] }).rows ?? []).map((r) => ({ account: r.account, partnerId: r.partnerId ?? '', debit: '', credit: '', note: r.note ?? '', doc: r.doc ?? '' })),
      };
    }
    // „+ Додај рачни ставки во налогот“ (`?nov&n=1/7-9`): a new manual part of an existing nalog — same number and period
    if (!sp.edit && sp.n) {
      const G0 = await db().select({ date: journals.date, pf: journals.periodFrom, pt: journals.periodTo }).from(journals)
        .where(and(inYear, eq(journals.number, sp.n)));
      if (G0.length) {
        const last = G0.map((x) => x.date).sort().at(-1)!;
        initial = { ...initial, number: sp.n, date: last, periodFrom: G0.find((x) => x.pf)?.pf ?? '', periodTo: G0.find((x) => x.pt)?.pt ?? '' };
      }
    }
    const [nums, [g]] = await Promise.all([
      db().selectDistinct({ n: journals.number }).from(journals).where(inYear).limit(300),
      db().select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, SCHEMES_SETTINGS_KEY)).limit(1),
    ]);
    const schemes = ((g?.v ?? {}) as { custom?: CustomScheme[] }).custom ?? [];
    return <JournalEditor initial={initial} chart={chart.map((a) => [a.code, a.name])} partners={P} numbers={nums.map((x) => x.n)} schemes={schemes} />;
  }

  /* ---------- „+ Нов налог – изводи“: the statement is imported first, the nalog is numbered / dated by it ---------- */
  if (sp.izv !== undefined) {
    if (!write) return <NoFirm t="Немате право на внес" />;
    const [chart, P, A] = await Promise.all([effectiveChart(db(), firm.id), partnerOptions(firm.id), loadBankAccounts(db(), firm.id)]);
    return (
      <>
        <Hd t="Нов налог – изводи" sub="налогот се отвора од изводот: датум и број според изводот (на пр. 6/4-6 за извод од јуни)" exp={false}>
          <Link className="btn" href="/nalozi">← Листа на налози</Link>
        </Hd>
        <div className="card">
          <ImportBox firmId={firm.id} fx={false} defaultAcct={A[0]?.id ?? ''} accounts={A.map((x) => ({ id: x.id, label: `${x.name} · ${x.account || x.iban || ''} · конто ${x.konto}` }))}
            nalog={{ number: null, chart: chart.map((a) => [a.code, a.name]), partners: P.map((p) => ({ id: p.id, name: p.name })) }} />
        </div>
      </>
    );
  }

  /* ---------- journals of the year ---------- */
  const J = await db().select({
    id: journals.id, date: journals.date, kind: journals.kind, number: journals.number, description: journals.description,
    sourceType: journals.sourceType, sourceId: journals.sourceId, periodFrom: journals.periodFrom, periodTo: journals.periodTo, locked: journals.locked, meta: journals.meta,
    D: sql<string>`coalesce(sum(${journalLines.debit}), 0)`, P: sql<string>`coalesce(sum(${journalLines.credit}), 0)`, n: sql<number>`count(${journalLines.id})::int`,
  }).from(journals).leftJoin(journalLines, eq(journalLines.journalId, journals.id)).where(inYear)
    .groupBy(journals.id).orderBy(asc(journals.date), asc(journals.createdAt));
  const G = groupNalozi(J);
  const manualLike = (j: (typeof J)[number]) => !j.sourceType || ['opening', 'bbimp', 'yearClose'].includes(j.sourceType);
  /** A nalog of one document (invoice, purchase…) — deleted with its document through „🗑 Избриши“ (with a preview). */
  const docOne = (j: (typeof J)[number]) => !manualLike(j) && j.sourceType !== 'bank_statement' && j.sourceType !== 'payroll';
  const canEdit = (j: (typeof J)[number]) => !locked(j) && (manualLike(j) ? (j.kind === 'manual' ? write : fix) : fix);
  const ovOf = (j: (typeof J)[number]) => ((j.meta ?? {}) as { override?: { applied?: number; dropped?: number; unbalanced?: boolean } }).override;
  /** „Ш2“: the numbered posting scheme the document was booked with (`journals.meta.scheme`, nothing for Шема 1). */
  const profiles = schemeProfilesOf(firm.settings);
  const schPill = (j: { meta: unknown }) => {
    const n = Number(((j.meta ?? {}) as { scheme?: unknown }).scheme) || 1;
    return n > 1 ? <> <span className="pill info" title={'Книжено со ' + schemeLabel(n, profiles)}>{schemeShort(n)}</span></> : null;
  };
  const S = firmNalogSettings(firm);
  const banks = await db().select({ id: bankAccounts.id, name: bankAccounts.name, nal: bankAccounts.nal, cur: bankAccounts.cur }).from(bankAccounts).where(eq(bankAccounts.firmId, firm.id));
  /** Legacy `nalogMap` label: the NAL_DEF title of a ranged number (2/4-6 → ВЛЕЗНИ ФАКТУРИ), bank series → ИЗВОДИ <bank>. */
  const codeTitle = new Map<string, string>([
    ...(Object.keys(NAL_DEF) as NalDefKey[]).map((k) => [nalCode(k, S), NAL_DEF[k][1]] as [string, string]),
    ...banks.map((b) => [bankNalCode(b.id, S.banks), 'ИЗВОДИ ' + b.name.toUpperCase()] as [string, string]),
  ]);
  /** Header row of a collective sale nalog opened with „+ Креирај налог“ in the invoice editor (`sales/invoice-nalog.ts`). */
  const headOf = (g: (typeof G)[number]) => g.journals.find((j) => !j.sourceId && ((j.meta ?? {}) as { collective?: unknown }).collective != null);
  const titleOf = (g: (typeof G)[number]) => {
    const h = headOf(g);
    if (h) return h.description ?? '';
    if (g.journals.length === 1) return g.journals[0]!.description ?? '';
    const c = g.no.includes('/') ? g.no.split('/')[0]! : '';
    return codeTitle.get(c) ?? `${g.journals[0]!.description ?? ''} (+${g.journals.length - 1})`;
  };

  /* ---------- one nalog ---------- */
  if (sp.n) {
    const gi = G.findIndex((g) => g.no === sp.n);
    const g = G[gi];
    if (!g) return <><Hd t="Налог за книжење" exp={false} /><div className="card empty">Налогот {sp.n} не постои за {year}. <Link href="/nalozi">Листа на налози</Link></div></>;
    const ids = g.journals.map((j) => j.id);
    const [L, chart] = await Promise.all([
      db().select({ l: journalLines, j: { id: journals.id, date: journals.date, description: journals.description, kind: journals.kind, meta: journals.meta }, p: { code: partners.code, name: partners.name } })
        .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId)).leftJoin(partners, eq(partners.id, journalLines.partnerId))
        .where(inArray(journalLines.journalId, ids)).orderBy(asc(journals.date), asc(journals.createdAt), asc(journalLines.lineNo)),
      effectiveChart(db(), firm.id),
    ]);
    const names = new Map(chart.map((a) => [a.code, a.name]));
    const t = lineTotals(L.map(({ l }) => l));
    const ds = g.journals.map((j) => j.date).sort();
    const title = titleOf(g);
    const dev = L.some(({ l }) => l.currency && l.currency !== 'MKD' && l.amountCur != null);
    const IZ = g.journals.some((j) => j.kind === 'bank');
    const izNo = (m: unknown) => String(((m ?? {}) as { statementNo?: string }).statementNo ?? '');
    const devOf = (l: (typeof L)[number]['l'], side: 'd' | 'p') => {
      if (!l.currency || l.currency === 'MKD' || l.amountCur == null) return 0;
      const a = Math.abs(Number(l.amountCur));
      return side === 'd' ? (Number(l.debit) ? a : 0) : (Number(l.credit) ? a : 0);
    };
    // Legacy `bankNote` 3597: statement summary.
    const stIds = g.journals.filter((j) => j.sourceType === 'bank_statement' && j.sourceId).map((j) => j.sourceId!);
    const BL = stIds.length ? await db().select({ amount: bankLines.amount, konto: bankLines.konto, refId: bankLines.refId, partnerId: bankLines.partnerId })
      .from(bankLines).where(inArray(bankLines.statementId, stIds)) : [];
    const bankK = IZ ? L.find(({ l }) => banks.length && l.account && /^10/.test(l.account))?.l.account : undefined;
    const one = g.journals.length === 1 ? g.journals[0]! : null;
    /* statements of this nalog (also those imported into it whose lines are not booked yet) → import box + open lines */
    const prefix = g.no.includes('/') ? g.no.split('/')[0]! : '';
    const bankOfCode = banks.find((b) => bankNalCode(b.id, S.banks) === prefix || (b.nal && b.nal === prefix));
    const isIzv = IZ || !!bankOfCode || /извод/i.test(title);
    const empty = L.length === 0;
    const showImport = write && (isIzv || (empty && sp.uvoz !== undefined));
    const inNal = await db().select({ id: bankStatements.id }).from(bankStatements)
      .where(and(eq(bankStatements.firmId, firm.id), sql`${bankStatements.meta}->>'nalog' = ${g.no}`, sql`${bankStatements.date} between ${from} and ${to}`));
    const stAll = [...new Set([...stIds, ...inNal.map((x) => x.id)])];
    // „Изводи во налогот“: the statements with ALL their lines — one query each, no query per line
    const [stRows, allBL] = stAll.length ? await Promise.all([
      db().select().from(bankStatements).where(and(eq(bankStatements.firmId, firm.id), inArray(bankStatements.id, stAll))).orderBy(asc(bankStatements.date), asc(bankStatements.number)),
      db().select().from(bankLines).where(inArray(bankLines.statementId, stAll)).orderBy(asc(bankLines.date), asc(bankLines.lineNo)),
    ]) : [[], []];
    const openL = write ? allBL.filter((l) => lineProblem(l, !!l.cur && l.cur !== 'MKD')) : [];
    const sugg = openL.length ? await db().transaction((tx) => statementSuggestions(tx, firm.id, [...new Set(openL.map((l) => l.statementId))])) : new Map<string, LineSuggestion>();
    const [impAccts, impP] = showImport || stAll.length ? await Promise.all([loadBankAccounts(db(), firm.id), partnerOptions(firm.id)]) : [[], []];
    const bankKs = new Set(impAccts.map((a) => a.konto));
    const acctById = new Map(impAccts.map((a) => [a.id, a]));
    const stLocked = (st: { id: string; date: string }) => {
      if (firm.lockDate && st.date <= firm.lockDate) return `заклучен период (до ${dmy(firm.lockDate)})`;
      const j = g.journals.find((x) => x.sourceId === st.id);
      return j?.locked ? `налогот е заклучен` : '';
    };
    const panel: PanelStatement[] = stRows.map((st) => {
      const a = acctById.get(st.bankAccountId);
      const fxA = !!a && a.cur !== 'MKD';
      return {
        id: st.id, number: st.number ?? '', date: st.date, acct: a ? `${a.name}${a.account || a.iban ? ' ' + (a.account || a.iban) : ''}` : '', bankKonto: a?.konto ?? '',
        fx: fxA, cur: a?.cur ?? 'MKD', opening: st.opening == null ? null : Number(st.opening), closing: st.closing == null ? null : Number(st.closing), status: st.status, locked: stLocked(st),
        lines: allBL.filter((l) => l.statementId === st.id).map((l) => {
          const s = sugg.get(l.id);
          return {
            id: l.id, date: l.date, name: l.name ?? '', purpose: l.purpose || l.description, amount: Number(l.amount), amountCur: l.amountCur == null ? null : Number(l.amountCur), cur: l.cur,
            osnov: l.osnov ?? '', konto: l.konto ?? '', effK: l.konto || l.refId ? bankEffKonto(toBankRow(l)) : '', partnerId: l.partnerId ?? '', newPartner: l.newPartner ?? '',
            linked: !!l.refId, refLabel: l.refLabel ?? '', refType: l.refType ?? '', manual: l.manual, prob: lineProblem(l, !!l.cur && l.cur !== 'MKD') || '',
            sugg: s ? { konto: s.konto, partnerId: s.partnerId ?? '', why: s.why, ok: !!s.konto && !s.missing } : null,
          };
        }),
      };
    });
    const ov = one ? ovOf(one) : undefined;
    const xl = [['Р.бр.', 'Датум', 'Опис', 'Конто', 'Назив на конто', 'Должи', 'Побарува', 'Документ', 'Дев. должи', 'Дев. побарува', 'Шифра', 'Комитент'],
      ...L.map(({ l, j, p }, i) => [i + 1, dmy(j.date), (j.description ?? '') + (l.note && l.note !== j.description ? ' – ' + l.note : ''), l.account, names.get(l.account) ?? '',
        Number(l.debit), Number(l.credit), l.doc ?? '', devOf(l, 'd'), devOf(l, 'p'), p?.code ?? '', p?.name ?? ''])];
    return (
      <>
        <NalogKeys edit={one && canEdit(one) ? `/nalozi?edit=${one.id}` : undefined} list="/nalozi" />
        <Hd t={'Налог за книжење бр. ' + g.no} sub={`${title} · ${dmy(ds[0])}${ds.at(-1) !== ds[0] ? ' – ' + dmy(ds.at(-1)) : ''}`} exp={false}>
          <Link className="btn" href="/nalozi">← Листа на налози</Link>
          {gi > 0 ? <Link className="btn" href={`/nalozi?n=${encodeURIComponent(G[gi - 1]!.no)}`}>◀</Link> : <button className="btn" disabled>◀</button>}
          {gi < G.length - 1 ? <Link className="btn" href={`/nalozi?n=${encodeURIComponent(G[gi + 1]!.no)}`}>▶</Link> : <button className="btn" disabled>▶</button>}
          {one && canEdit(one) && <Link className="btn pri" href={`/nalozi?edit=${one.id}`}>✎ Корекција (F2)</Link>}
          <ExportBar name={`Nalog_${g.no.replace(/\W+/g, '_')}_${year}`} title="Налог" rows={xl} pdf={false} csv={false} />
          <a className="btn" href={`/print/nalog?n=${encodeURIComponent(g.no)}`} target="_blank" rel="noopener">PDF</a>
          {one && del && manualLike(one) && <RowAction className="btn danger" action={deleteJournalAction.bind(null, one.id)} label="🗑 Избриши налог" confirm={`Да се избрише налогот бр. ${g.no}? Ова не може да се врати.`} />}
          {/* a statement's nalog is deleted together with its statement (the journal alone would leave the statement unbooked) */}
          {one && del && one.sourceType === 'bank_statement' && one.sourceId && !locked(one) && <RowAction className="btn danger" action={deleteStatementAction.bind(null, one.sourceId)} label="🗑 Избриши го изводот и налогот" confirm={`Да се избрише изводот и налогот бр. ${g.no} со сите ставки? Ова не може да се врати.`} />}
          {one && del && one.sourceType === 'payroll' && one.sourceId && !locked(one) && <RowAction className="btn danger" action={unpostRunAction.bind(null, one.sourceId)} label="🗑 Избриши го налогот на платата" confirm={`Да се избрише налогот бр. ${g.no}? Пресметката на платата останува зачувана во Плати (може повторно да се прокнижи).`} />}
          {(!one || docOne(one)) && del && !g.journals.some(locked) && <RowAction className="btn danger" action={deleteNalogAction.bind(null, g.no, year)} preview={nalogDeletePreviewAction.bind(null, g.no, year)} label={one ? '🗑 Избриши го документот и налогот' : '🗑 Избриши го целиот налог'} confirm={`Да се избрише ${one ? 'налогот' : 'целиот налог'} бр. ${g.no} заедно со документите во него?`} />}
        </Hd>
        {one && empty && manualLike(one) && (
          <div className="callout warn row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Налогот е <b>празен</b> (датум {dmy(one.date)}{one.periodFrom ? `, период ${dmy(one.periodFrom)} – ${dmy(one.periodTo)}` : ''}). Изводите се книжат во налог по датумот на изводот – увезете го изводот тука или го преместете / избришете празниот налог.</span>
            <span className="row" style={{ gap: 6 }}>
              {canEdit(one) && <Link className="btn sm" href={`/nalozi?edit=${one.id}`}>✎ Премести (број / датум / период)</Link>}
              {del && !locked(one) && <RowAction className="btn sm danger" action={deleteJournalAction.bind(null, one.id)} label="🗑 Избриши празен налог" confirm={`Да се избрише празниот налог бр. ${g.no}?`} />}
              {write && !isIzv && sp.uvoz === undefined && <Link className="btn sm" href={`/nalozi?n=${encodeURIComponent(g.no)}&uvoz`}>📥 Увези извод во овој налог</Link>}
            </span>
          </div>
        )}
        {showImport && (
          <div className="card" id="uvoz-izvod" style={{ borderColor: 'var(--accent)' }}>
            <ImportBox firmId={firm.id} fx={false} defaultAcct={bankOfCode?.id ?? impAccts[0]?.id ?? ''}
              accounts={impAccts.map((x) => ({ id: x.id, label: `${x.name} · ${x.account || x.iban || ''} · конто ${x.konto}` }))}
              nalog={{ number: g.no, emptyId: one && empty && manualLike(one) ? one.id : null, chart: chart.map((a) => [a.code, a.name]), partners: impP.map((p) => ({ id: p.id, name: p.name })) }} />
          </div>
        )}
        {panel.length > 0 && (
          <StatementsPanel statements={panel} chart={chart.filter((a) => !bankKs.has(a.code)).map((a) => [a.code, a.name])}
            partners={impP.map((p) => ({ id: p.id, code: p.code, name: p.name }))}
            write={write} del={canDo(u, 'del', firm.id)} flip={canDo(u, 'flipBank', firm.id)} />
        )}
        {g.journals.length > 1 && (
          <div className="card">
            {(() => {
              // „Прекнижи ги избраните со Шема N“: open nalog, documents (invoices / purchases) only
              const rep = write && profiles.length > 0 && g.journals.some((j) => !locked(j) && (j.sourceType === 'invoice' || j.sourceType === 'purchase'));
              return rep ? <SchemeRepostBar schemes={profiles.map((p) => ({ no: p.no, label: schemeLabel(p.no, profiles) }))} /> : null;
            })()}
            <h2>Документи во налогот ({g.journals.filter((j) => j.sourceId).length}){headOf(g) && <> <span className="pill info" title="Збирен налог: секоја фактура си ги чува своите ставки; бришење/сторно на една фактура ги отстранува само нејзините ставки">збирен налог · {g.journals.filter((j) => j.sourceType === 'invoice').length} фактури</span></>}</h2>
            <div className="tw"><table className="dense"><tbody>
              {g.journals.map((j) => {
                const o = ovOf(j);
                return (
                  <tr key={j.id}>
                    {write && profiles.length > 0 && <td>{(j.sourceType === 'invoice' || j.sourceType === 'purchase') && j.sourceId
                      ? <input type="checkbox" name="j" value={j.id} form="schrep" disabled={locked(j)} aria-label={'Избери ' + (j.description ?? j.number)} title={locked(j) ? 'Заклучен период – не се прекнижува' : undefined} />
                      : null}</td>}
                    <td>{dmy(j.date)}</td><td>{j.description}{schPill(j)}{!!o?.applied && <> <span className="pill warn" title="Налогот е рачно коригиран и се разликува од документот">🛠 коригиран</span></>}</td><td className="n">{fmt(j.D)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {canEdit(j) && <Link className="btn sm" href={`/nalozi?edit=${j.id}`}>✎ Корекција</Link>}{' '}
                      {!manualLike(j) && j.sourceType && DOC_SCREEN[j.sourceType] && <Link className="btn sm ghost" href={DOC_SCREEN[j.sourceType]!}>Документ →</Link>}{' '}
                      {j.sourceType === 'invoice' && j.sourceId && <Link className="btn sm ghost" href={`/print/doc/${j.sourceId}`} target="_blank" title="Фактурата во налогот">👁 Фактура</Link>}{' '}
                      {del && manualLike(j) && <RowAction action={deleteJournalAction.bind(null, j.id)} label="🗑" title="Избриши" confirm={`Да се избрише „${j.description ?? j.number}“?`} style={{ color: 'var(--bad)' }} />}
                      {del && !manualLike(j) && j.sourceId && !locked(j) && <RowAction className="btn sm ghost danger" action={deleteNalogDocAction.bind(null, j.id)} preview={nalogDocDeletePreviewAction.bind(null, j.id)} label="🗑 Избриши" title="Го брише документот – неговите ставки излегуваат од налогот, другите документи остануваат" confirm={`Да се избрише документот „${j.description ?? ''}“ од налогот бр. ${g.no}?`} />}
                    </td></tr>
                );
              })}
            </tbody></table></div>
          </div>
        )}
        {one && (
          <div className="row" style={{ marginBottom: 8, gap: 8 }}>
            {one.periodFrom && <span className="pill info">период {dmy(one.periodFrom)} – {dmy(one.periodTo)}</span>}
            {locked(one) && <span className="pill">🔒 заклучен</span>}
            {schPill(one)}
            {!manualLike(one) && one.sourceType && DOC_SCREEN[one.sourceType] && <Link className="btn sm ghost" href={DOC_SCREEN[one.sourceType]!}>Документ →</Link>}
          </div>
        )}
        {!!ov?.applied && (
          <div className="callout warn row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span>🛠 <b>Налогот е рачно коригиран</b> и се разликува од документот ({ov.applied} {ov.applied === 1 ? 'промена' : 'промени'}). Корекцијата останува и кога документот повторно ќе се прокнижи.</span>
            {fix && one && !locked(one) && <RowAction className="btn sm" action={resetOverrideAction.bind(null, one.id)} label="↺ Врати како во документот" confirm="Да се поништи рачната корекција и налогот да се врати како што го книжи документот?" />}
          </div>
        )}
        {!!(ov && !ov.applied && (ov.dropped || ov.unbalanced)) && <div className="callout warn">Документот е изменет по рачната корекција – корекцијата {ov.unbalanced ? 'би го направила налогот неизедначен и' : 'на изменетите редови'} не е применета.</div>}
        {stIds.length > 0 && (() => {
          const pr = BL.filter((x) => Number(x.amount) > 0).reduce((s, x) => s + Number(x.amount), 0), od = BL.filter((x) => Number(x.amount) < 0).reduce((s, x) => s - Number(x.amount), 0);
          const open = BL.filter((x) => !x.refId && !x.konto).length;
          return (
            <div className={`callout ${open ? 'warn' : 'good'}`}>{stIds.length > 1 ? `Изводи (${stIds.length})` : `Извод од ${dmy(ds[0])}`}: {BL.length} ставки · прилив <b>{fmt(pr)}</b> · одлив <b>{fmt(od)}</b> ден. Изводот се книжи обратно од банката: „должува“ на изводот (одлив) = Побарува {bankK ?? 'банка'}, „побарува“ на изводот (прилив) = Должи {bankK ?? 'банка'}; спротивното конто е она што е избрано во „Изводи“.{open ? <> <b>{open} ставки не се поврзани</b> – изводот не е целосно прокнижен.</> : null}</div>
          );
        })()}
        <div className="tw"><table className="dense nalg">
          <thead><tr><th className="n">Р.бр.</th><th>Датум</th>{IZ && <th className="n">Изв. бр.</th>}<th>Конто</th><th className="n">Должи</th><th className="n">Побарува</th><th>Шифра</th><th>Комитент</th><th style={{ minWidth: 240 }}>Опис / содржина</th><th>Документ</th>{dev && <><th className="n">Дев. должи</th><th className="n">Дев. побарува</th></>}</tr></thead>
          <tbody>
            {L.map(({ l, j, p }, i) => (
              <tr key={l.id}>
                <td className="n">{i + 1}</td><td style={{ whiteSpace: 'nowrap' }}>{dmy(j.date)}</td>
                {IZ && <td className="n"><b>{j.kind === 'bank' ? izNo(j.meta) : ''}</b></td>}
                <td title={names.get(l.account) ?? ''}><Link href={`/kkart?k=${l.account}`}><b className="num">{l.account}</b></Link></td>
                <td className="n">{fmt(l.debit)}</td><td className="n">{fmt(l.credit)}</td>
                <td>{p?.code}</td><td>{p?.name}</td>
                <td>{j.description}{l.note && l.note !== j.description && <><br /><small className="mut">{l.note}</small></>}</td>
                <td>{l.doc}</td>
                {dev && <><td className="n">{fmt(devOf(l, 'd'))}</td><td className="n">{fmt(devOf(l, 'p'))}</td></>}
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td colSpan={IZ ? 4 : 3}>Вкупно ({L.length} ставки) {t.balanced ? <span className="pill good">изедначен</span> : <span className="pill bad">неизедначен · разлика {fmt(t.diff)}</span>}</td>
            <td className="n">{fmt(t.D)}</td><td className="n">{fmt(t.P)}</td><td colSpan={4 + (dev ? 2 : 0)} />
          </tr></tfoot>
        </table></div>
      </>
    );
  }

  /* ---------- line search (legacy: filter of the journal by konto / document / partner) ---------- */
  const q = (sp.q ?? '').trim();
  const [hits, chartAll, dups] = await Promise.all([
    q ? db().select({ l: journalLines, j: { date: journals.date, number: journals.number, description: journals.description, kind: journals.kind }, p: partners.name })
      .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId)).leftJoin(partners, eq(partners.id, journalLines.partnerId))
      .where(and(inYear, or(ilike(journalLines.account, `${q}%`), ilike(journals.description, `%${q}%`), ilike(journalLines.note, `%${q}%`),
        ilike(journalLines.doc, `%${q}%`), ilike(partners.name, `%${q}%`), eq(journals.number, q))))
      .orderBy(asc(journals.date), asc(journalLines.lineNo)).limit(500) : Promise.resolve([]),
    q ? effectiveChart(db(), firm.id) : Promise.resolve([]),
    // Legacy `purDups` 4440: purchase invoices entered twice (same number and date).
    db().select({ number: purchases.number, date: purchases.date, n: sql<number>`count(*)::int` }).from(purchases)
      .where(and(eq(purchases.firmId, firm.id), sql`${purchases.date} between ${from} and ${to}`, sql`${purchases.number} <> ''`))
      .groupBy(purchases.number, purchases.date, purchases.partnerId).having(sql`count(*) > 1`),
  ]);
  const kn = new Map(chartAll.map((a) => [a.code, a.name]));
  const settingsOk = canDo(u, 'settings', firm.id), closeOk = canDo(u, 'close', firm.id);

  return (
    <>
      <Hd t="Налози за книжење" sub={`дневник · ${year}`} exp={false}>
        <form className="row" style={{ gap: 6 }}><input name="q" defaultValue={q} placeholder="Барај конто, документ…" style={{ width: 200 }} /></form>
        <a className="btn" href="/nalozi/dnevnik?f=csv">CSV</a>
        <a className="btn" href="/nalozi/dnevnik">⬇ Excel</a>
        <a className="btn" href="/print/dnevnik" target="_blank" rel="noopener">PDF</a>
        {write && <Link className="btn pri" href="/nalozi?izv" title="Увезете го изводот (PDF / Excel / XML) – налогот се отвора со датум и број според изводот">+ Нов налог – изводи</Link>}
        {write && <Link className="btn pri" href="/nalozi?nov">+ Рачен налог</Link>}
      </Hd>
      {dups.length > 0 && (
        <div className="callout warn row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span><b>Дупликати:</b> {dups.reduce((s, d) => s + d.n - 1, 0)} влезни фактури се внесени двапати (ист број и датум: {[...new Set(dups.map((d) => d.number))].slice(0, 5).join(', ')}). Се задржува последно зачуваната, а старите се бришат заедно со налогот.</span>
          <Link className="btn danger" href="/vlez">Прегледај ги во „Влезни фактури“</Link>
        </div>
      )}
      <RepostCallout u={u} firmId={firm.id} year={year} />
      <div className="card">
        <div className="hd">
          <h2>Преглед на финансови налози за книжење</h2>
          <div className="row">
            {settingsOk && <Link className="btn sm" href={sp.cfg !== undefined ? '/nalozi' : '/nalozi?cfg'}>Шифри на налози…</Link>}
            {write && <BankForm action={nalFixAllAction} className="row"><button className="btn sm" title="Броевите на налозите повеќе не се менуваат ако подоцна се внесе документ со постар датум">🔒 Фиксирај броеви</button></BankForm>}
            {firm.lockDate && <span className="pill">🔒 заклучено до {dmy(firm.lockDate)}</span>}
          </div>
        </div>
        {settingsOk && sp.cfg !== undefined && (
          <>
            <form action={saveNalogSettings} className="row" style={{ gap: '8px 16px', marginBottom: 10, flexWrap: 'wrap', alignItems: 'end' }}>
              <label className="mini">Нумерирање <select name="nalogMode" defaultValue={S.nalogMode} style={{ width: 'auto' }}>
                <option value="period">по вид и период (2/1-3, 6/1-3, 12/1-1…)</option><option value="doc">секој документ посебен налог (1, 2, 3…)</option></select></label>
              <label className="mini">Период <select name="nalogPer" defaultValue={S.nalogPer} style={{ width: 'auto' }}>
                <option value="quarter">тромесечно</option><option value="month">месечно</option></select></label>
              <label className="mini">Плати <select name="nalPayPer" defaultValue={S.nalPayPer} style={{ width: 'auto' }}>
                <option value="month">секој месец (12/1-1)</option><option value="year">цела година (12/1-12)</option></select></label>
              {(Object.keys(NAL_DEF) as NalDefKey[]).map((k) => (
                <label className="mini" key={k}>{NAL_DEF[k][1].toLowerCase()} <input name={'nc_' + k} defaultValue={nalCode(k, S)} style={{ width: 70 }} /></label>
              ))}
              <button className="btn sm pri">Зачувај</button>
              <span className="note">Промената важи за новите налози; веќе книжените го задржуваат својот број.</span>
            </form>
            {banks.length > 0 && (
              <form action={saveBankNalCodes} className="row" style={{ gap: '8px 16px', marginBottom: 10, flexWrap: 'wrap', alignItems: 'end' }}>
                {banks.map((b) => <label className="mini" key={b.id}>изводи {b.name} <input name={'bc_' + b.id} defaultValue={b.nal ?? ''} placeholder={bankNalCode(b.id, S.banks)} style={{ width: 70 }} /></label>)}
                <button className="btn sm pri">Зачувај шифри</button>
              </form>
            )}
          </>
        )}
        {closeOk && (
          <form action={setLockDate} className="row" style={{ gap: 8, marginBottom: 10, alignItems: 'end' }}>
            <label className="mini">Заклучи го периодот до <input type="date" name="lockDate" defaultValue={firm.lockDate ?? ''} style={{ width: 'auto' }} /></label>
            <button className="btn sm">🔒 Зачувај заклучување</button>
            <span className="note">До овој датум налозите не може да се книжат, менуваат или бришат (празно = отклучено).</span>
          </form>
        )}
        <div className="tw" style={{ maxHeight: 520 }}><table>
          <thead><tr><th>Датум</th><th>Број</th><th>Опис</th><th className="n">Ставки</th><th className="n">Должи</th><th className="n">Побарува</th><th className="n">Салдо</th><th></th></tr></thead>
          <tbody>
            {G.map((g) => {
              const D = g.journals.reduce((s, j) => s + Number(j.D), 0), P = g.journals.reduce((s, j) => s + Number(j.P), 0);
              const n = g.journals.reduce((s, j) => s + j.n, 0);
              const one = g.journals.length === 1 ? g.journals[0]! : null;
              const href = `/nalozi?n=${encodeURIComponent(g.no)}`;
              return (
                <tr key={g.no}>
                  <td>{dmy(g.date)}</td><td><Link href={href}><b className="num">{g.no}</b></Link></td>
                  <td>{titleOf(g)}{one && schPill(one)}{g.journals.some((j) => ovOf(j)?.applied) && <> <span className="pill warn" title="Рачно коригиран – се разликува од документот">🛠</span></>}</td>
                  <td className="n">{n}</td>
                  <td className="n">{fmt(D)}</td><td className="n">{fmt(P)}</td>
                  <td className="n" style={Math.abs(D - P) > 0.009 ? { color: 'var(--bad)' } : undefined}>{fmt(D - P)}</td>
                  <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                    <Link className="btn sm" href={href}>Отвори</Link>
                    {one && canEdit(one) && <Link className="btn sm" href={`/nalozi?edit=${one.id}`} title="Отвори и измени (корекција)">✎ Измени</Link>}
                    {!one && fix && !g.journals.some(locked) && <Link className="btn sm" href={`/nalozi?n=${encodeURIComponent(g.no)}`} title="Налог со повеќе документи: корекција по документ">✎ Измени</Link>}
                    {write && !g.journals.some(locked) && <Link className="btn sm" href={`/nalozi?nov&n=${encodeURIComponent(g.no)}`} title="Нов рачен дел во истиот налог (ист број и период)">+ Ставки</Link>}
                    <a className="btn sm" href={`/print/nalog?n=${encodeURIComponent(g.no)}`} target="_blank" rel="noopener">PDF</a>
                    {one && del && manualLike(one) && !locked(one) && <RowAction className="btn sm danger" action={deleteJournalAction.bind(null, one.id)} label="🗑 Избриши" title="Избриши го налогот" confirm={`Да се избрише налогот бр. ${g.no}?`} />}
                    {one && del && one.sourceType === 'bank_statement' && one.sourceId && !locked(one) && <RowAction className="btn sm danger" action={deleteStatementAction.bind(null, one.sourceId)} label="🗑 Избриши" title="Избриши го изводот и налогот" confirm={`Да се избрише изводот и налогот бр. ${g.no} со сите ставки?`} />}
                    {one && del && one.sourceType === 'payroll' && one.sourceId && !locked(one) && <RowAction className="btn sm danger" action={unpostRunAction.bind(null, one.sourceId)} label="🗑 Избриши" title="Го брише налогот на платата; пресметката останува зачувана во Плати" confirm={`Да се избрише налогот бр. ${g.no} на платата? Пресметката на платата останува зачувана (може повторно да се прокнижи).`} />}
                    {(!one || docOne(one)) && del && !g.journals.some(locked) && <RowAction className="btn sm danger" action={deleteNalogAction.bind(null, g.no, year)} preview={nalogDeletePreviewAction.bind(null, g.no, year)} label="🗑 Избриши" title="Го брише налогот заедно со документите во него (фактури, калкулации, изводи…); пред бришење ги прикажува документите" confirm={`Да се избрише налогот бр. ${g.no} заедно со документите во него?`} />}
                  </td>
                </tr>
              );
            })}
            {!G.length && <tr><td colSpan={8} className="empty">Нема налози за {year}.</td></tr>}
          </tbody>
        </table></div>
      </div>
      <p className="note">„Отвори“ го прикажува целиот налог со сите ставки – датум, конто, должи, побарува, комитент, опис, документ и девизи – со рачна корекција (F2). Броевите се доделуваат при книжење и не се менуваат кога подоцна ќе се внесе документ со постар датум. Барањето горе (конто, документ, партнер) ги прикажува поединечните ставки од дневникот.</p>
      {q && (
        <>
          <div className="row"><span className="pill info">Филтер: {q}</span><Link className="btn sm" href="/nalozi">Прикажи сè</Link></div>
          {hits.length ? (
            <div className="tw"><table>
              <thead><tr><th>Налог</th><th>Датум</th><th>Извор</th><th>Документ</th><th>Конто</th><th className="n">Должи</th><th className="n">Побарува</th></tr></thead>
              <tbody>{hits.map(({ l, j, p }) => (
                <tr key={l.id}>
                  <td><Link className="btn sm" href={`/nalozi?n=${encodeURIComponent(j.number)}`}>бр. {j.number}</Link></td><td>{dmy(j.date)}</td>
                  <td><span className="pill">{kindLbl(j.kind)}</span></td>
                  <td>{j.description}{l.doc ? ' · ' + l.doc : ''}</td><td><span className="num">{l.account}</span> {kn.get(l.account) ?? ''}{p ? ' · ' + p : ''}</td>
                  <td className="n">{Number(l.debit) ? fmt(l.debit) : ''}</td><td className="n">{Number(l.credit) ? fmt(l.credit) : ''}</td>
                </tr>))}</tbody>
              <tfoot><tr><td colSpan={5}>Вкупно</td><td className="n">{fmt(hits.reduce((s, h) => s + Number(h.l.debit), 0))}</td><td className="n">{fmt(hits.reduce((s, h) => s + Number(h.l.credit), 0))}</td></tr></tfoot>
            </table></div>
          ) : <div className="card empty">Нема ставки за „{q}“ во {year}.</div>}
        </>
      )}
    </>
  );
}
