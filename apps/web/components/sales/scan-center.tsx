/**
 * Скенирање документ (legacy `VIEWS.skan` 4628 → 14435 → 16235) and Масовно внесување фактури (legacy `VIEWS.masovno`
 * 5361 / `masovnoM` 5360): upload → `ai.read-document` job → review drafts → save (one by one or all "во ред").
 * Sales invoices issued by the firm (legacy `outRun` / `outBatchHTML` 8415–8439) are reviewed on the same screen (`?k=sale`).
 */
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { aiDocuments, files, journals, partners, type AiDocument } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { locationOptions } from '@/lib/sales';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { clearBatch, deepScan, ensureScanBuyer, removeScan, retryScan, saveBatchOk, saveSalesOk } from '@/app/(app)/skan/actions';
import { AutoRefresh, ScanUpload } from './scan-upload';

/** Legacy batch pills (5361) and the sales-scan pills (8424). */
const PILL: Record<string, [string, string]> = {
  queued: ['', 'чека'], reading: ['info', 'се чита…'], ok: ['good', '✓ во ред'], check: ['warn', 'провери'], dup: ['bad', 'дупликат'],
  error: ['bad', 'грешка'], saved: ['good', '✓ зачувано'],
};
const PILL_SALE: Record<string, [string, string]> = {
  queued: ['info', 'се чита…'], reading: ['info', 'се чита…'], ok: ['good', '✓ спремна'], check: ['warn', 'провери'], dup: ['bad', 'веќе внесена'],
  error: ['bad', 'грешка'], saved: ['good', 'зачувана'],
};

type Row = { doc: AiDocument; i: number | null; fileName: string };

function rowsOf(docs: AiDocument[], names: Map<string, string>): Row[] {
  return docs.flatMap((doc): Row[] => (doc.status === 'done' || doc.status === 'saved') && doc.drafts.length
    ? doc.drafts.map((_, i) => ({ doc, i, fileName: ((doc.fileId ? names.get(doc.fileId) : undefined) ?? '') + (doc.drafts.length > 1 ? ` #${i + 1}/${doc.drafts.length}` : '') }))
    : [{ doc, i: null, fileName: (doc.fileId ? names.get(doc.fileId) : undefined) ?? '' }]);
}

type PurDraft = { partnerId?: string; supplierName?: string; number?: string; date?: string; groups?: { base: number; vat: number }[]; stock?: unknown[]; art32?: boolean };
type SaleDraft = { partnerId?: string; buyer?: { name?: string }; number?: string; date?: string; total?: number; calcTotal?: number };

export async function ScanCenter({ mode, sp }: { mode: 'skan' | 'masovno' | 'masovnoM'; sp: { k?: string; b?: string; wh?: string; cash?: string; cost?: string; saved?: string } }) {
  const { u, firm } = await booksPage(mode);
  const title = mode === 'skan' ? 'Скенирање документ' : 'Масовно внесување на влезни фактури';
  if (!firm) return <NoFirm t={title} />;
  const write = canDo(u, 'write', firm.id), admin = canDo(u, 'del', firm.id);
  const kind: 'purchase' | 'sale' = mode === 'skan' && sp.k === 'sale' ? 'sale' : 'purchase';
  const batchId = mode === 'skan' ? null : sp.b && /^[0-9a-f-]{36}$/i.test(sp.b) ? sp.b : null;
  const locs = await locationOptions(firm.id);
  const stores = locs.filter((l) => l.kind === 'store');
  const wh = sp.wh ?? (mode === 'masovnoM' ? stores[0]?.id ?? '' : '');
  const notInline = sql`not (${aiDocuments.options} ? 'inline')`;
  const docs = mode === 'skan'
    ? await db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), eq(aiDocuments.kind, kind), isNull(aiDocuments.batchId), notInline)).orderBy(desc(aiDocuments.createdAt)).limit(60)
    : batchId ? await db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), eq(aiDocuments.batchId, batchId))).orderBy(aiDocuments.createdAt) : [];
  const names = new Map((docs.length ? await db().select({ id: files.id, n: files.name }).from(files).where(inArray(files.id, docs.flatMap((d) => (d.fileId ? [d.fileId] : [])))) : []).map((f) => [f.id, f.n]));
  const P = new Map((await db().select({ id: partners.id, n: partners.name }).from(partners).where(eq(partners.firmId, firm.id))).map((p) => [p.id, p.n]));
  const R = rowsOf(docs, names);
  const savedIds = R.flatMap((r) => (r.i != null && r.doc.drafts[r.i]!.savedId ? [r.doc.drafts[r.i]!.savedId!] : []));
  const J = new Map((savedIds.length ? await db().select({ s: journals.sourceId, n: journals.number }).from(journals)
    .where(and(eq(journals.firmId, firm.id), inArray(journals.sourceId, savedIds))) : []).map((x) => [x.s, x.n]));
  const st = (r: Row) => (r.i == null ? r.doc.status : r.doc.drafts[r.i]!.savedId ? 'saved' : r.doc.drafts[r.i]!.status);
  const cnt = (k: string) => R.filter((r) => st(r) === k).length;
  const busy = docs.some((d) => d.status === 'queued' || d.status === 'reading');
  const editor = kind === 'sale' ? '/izlez' : '/vlez';
  const back = mode === 'skan' ? `/skan${kind === 'sale' ? '?k=sale' : ''}`
    : `/${mode}?` + new URLSearchParams({ b: batchId ?? '', wh, ...(sp.cash === '1' ? { cash: '1' } : {}), ...(sp.cost === '1' ? { cost: '1' } : {}) }).toString();
  const newBatch = randomUUID();
  const opts = { kind, batchId, cash: sp.cash === '1', warehouseId: wh, costOnly: sp.cost === '1' };
  const pills = kind === 'sale' ? PILL_SALE : PILL;

  return (
    <>
      <AutoRefresh active={busy} />
      <Hd t={title} sub={mode === 'skan' ? 'автоматско внесување' : 'повеќе фактури одеднаш'}>
        {mode === 'skan' && <Link className={'btn' + (kind === 'purchase' ? ' pri' : '')} href="/skan">Влезни</Link>}
        {mode === 'skan' && <Link className={'btn' + (kind === 'sale' ? ' pri' : '')} href="/skan?k=sale">Излезни (издадени)</Link>}
        {mode === 'skan' && kind === 'sale' && write && <RowAction className="btn pri" action={saveSalesOk} label={`Зачувај ги сите спремни (${cnt('ok')})`} confirm={`Да се зачуваат и прокнижат ${cnt('ok')} фактури?`} />}
        {mode === 'skan' && admin && <Link className="btn sm" href="/skan?cmp=1" title="Спореди брз и детален AI модел">🧪 Тест AI</Link>}
        {mode !== 'skan' && batchId && R.length > 0 && write && <RowAction className="btn" action={clearBatch.bind(null, batchId)} label="Исчисти листа" />}
        {mode !== 'skan' && batchId && write && <RowAction className="btn pri" action={saveBatchOk.bind(null, batchId)} label={`Зачувај ги сите што се во ред (${cnt('ok')})`} confirm={`Да се зачуваат и прокнижат ${cnt('ok')} фактури?`} />}
        {mode !== 'skan' && batchId && <Link className="btn" href={`/${mode}`}>Нова листа</Link>}
      </Hd>
      {mode !== 'skan' && !batchId ? (
        <form className="card" method="get">
          <input type="hidden" name="b" value={newBatch} />
          <div className="row" style={{ gap: '10px 16px', alignItems: 'end' }}>
            <label className="f">Стоката во објект<select name="wh" defaultValue={wh}><option value="">01 Главен магацин</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="cash" value="1" style={{ width: 'auto' }} /> Фискални сметки платени во готово (1020)</label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="cost" value="1" style={{ width: 'auto' }} /> Директни трошоци – без приемница / калкулација</label>
            <button className="btn pri">Почни нова листа</button>
          </div>
        </form>
      ) : write && (
        <div className="card">
          {mode === 'skan' && kind === 'purchase' && <p className="note">Прикачете PDF, фотографија или скен од влезна фактура. Програмот ги чита добавувачот, ЕДБ, бројот, датумот, ставките и основиците по даночна стапка, и препознава член 32-а. Артиклите што постојат во шифрарникот сами се поврзуваат со залихата. Вие само проверувате и зачувувате.</p>}
          {mode === 'skan' && kind === 'sale' && <p className="note">PDF или слики од фактури што клиентот сам ги издал – програмот ги чита и ги внесува.</p>}
          {mode !== 'skan' && <p className="note">Објект: <b>{locs.find((l) => l.id === wh)?.name ?? 'Главен магацин'}</b>{opts.cash && ' · готовина (1020)'}{opts.costOnly && ' · директни трошоци'}</p>}
          <ScanUpload firmId={firm.id} opts={opts} small={false}
            autoOpen={mode === 'skan' && kind === 'purchase' ? { back } : undefined} batchView={mode === 'skan' && kind === 'purchase' ? '/masovno' : undefined}
            label={mode === 'skan'
              ? (kind === 'sale'
                ? <><b>📷 Скенирај фактури (PDF)</b> — повлечете една или повеќе издадени фактури (PDF, JPG, PNG) тука или кликнете.</>
                : <>Повлечете PDF или слика тука, или кликнете за да ја изберете<br /><small>Оригиналот се чува прикачен на фактурата за евиденција</small></>)
              : <><b>Повлечете ги сите фактури одеднаш</b> (PDF, JPG, PNG) или кликнете за избор.<br /><small>Се читаат по неколку истовремено; секоја се проверува (износи, ДДВ по стапки, дупликати). Оние „во ред“ се зачувуваат со едно копче, другите ги отворате и поправате.</small></>} />
        </div>
      )}
      {mode === 'skan' && kind === 'purchase' && (
        <div className="cols">
          <div className="callout">Банкарски извод? <Link className="btn sm" href="/banka">Изводи</Link></div>
          <div className="callout">Излезни фактури што клиентот сам ги издал? <Link className="btn sm" href="/skan?k=sale">Излезни фактури → 📷 Скенирај</Link></div>
          <div className="callout">Фактура без автоматско читање? Во „Влезни фактури“ → „Рачен внес“ можете само да го прикачите PDF-от.</div>
          <div className="callout">Повратница или одобрение (добавувач)? <Link className="btn sm" href="/povratDob?scan=1">📷 Скенирај повратница</Link></div>
        </div>
      )}
      {R.length > 0 && mode !== 'skan' && (
        <div className="tiles kpi k4">{[['Вкупно', R.length, 't3'], ['Во ред', cnt('ok'), 't1'], ['За проверка', cnt('check') + cnt('dup') + cnt('error'), 't2'], ['Зачувани', cnt('saved'), 't8']].map(([a, b, t]) => <div key={String(a)} className={'tile kt ' + t}><span>{a}</span><b className="num">{b}</b></div>)}</div>
      )}
      {kind === 'sale' && R.length > 0 && <h2 style={{ fontSize: 16 }}>📷 Скенирани излезни фактури ({R.length})</h2>}
      {R.length ? (
        <div className="tw"><table className={kind === 'sale' ? 'dense' : undefined}>
          {kind === 'sale'
            ? <thead><tr><th>Документ</th><th>Број</th><th>Датум</th><th>Купувач</th><th className="n">Износ</th><th>Статус</th><th></th></tr></thead>
            : <thead><tr><th>#</th><th>Датотека</th><th>Добавувач</th><th>Број</th><th>Датум</th><th className="n">Основица</th><th className="n">ДДВ</th><th className="n">Вкупно</th><th className="n">Артикли</th><th>Статус</th><th></th></tr></thead>}
          <tbody>{R.map((r, k) => {
            const x = r.i == null ? null : r.doc.drafts[r.i]!;
            const s0 = st(r);
            const [pc, pt] = pills[s0] ?? ['', s0];
            const file = <a href={`/api/files/${r.doc.fileId}`} target="_blank" rel="noreferrer" title={r.fileName}>{r.fileName.slice(0, 34)}</a>;
            const status = <td><span className={'pill ' + pc}>{pt}</span>{(x?.msg || r.doc.error) && <div className="mini">{x?.msg || r.doc.error}</div>}{r.doc.model && <div className="mini">{r.doc.model}</div>}</td>;
            const acts = (
              <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                {x && !x.savedId && write && <Link className="btn sm" href={`${editor}?scan=${r.doc.id}&i=${r.i}&back=${encodeURIComponent(back)}`}>{kind === 'sale' ? (s0 === 'dup' ? 'Отвори сепак' : 'Провери') : s0 === 'ok' ? 'Прегледај' : 'Отвори и поправи'}</Link>}
                {x?.savedId && J.get(x.savedId) && <Link className="btn sm ghost" href={`/nalozi?n=${encodeURIComponent(J.get(x.savedId)!)}`}>Налог</Link>}
                {x?.savedId && <Link className="btn sm ghost" href={`${editor}?edit=${x.savedId}`}>Отвори</Link>}
                {kind === 'sale' && x && !x.savedId && s0 === 'check' && !(r.doc.options as { deep?: boolean }).deep && write && <RowAction action={deepScan.bind(null, r.doc.id)} label="🔍 Подетално" title="Повторно читање со подетален модел (побавно, ~1–2 мин.)" />}
                {write && r.doc.status === 'error' && <RowAction action={retryScan.bind(null, r.doc.id)} label="↻ Повторно" />}
                {write && r.doc.status !== 'reading' && r.doc.status !== 'saved' && !x?.savedId && <RowAction action={removeScan.bind(null, r.doc.id)} label="✕" title="Отстрани" confirm={kind === 'sale' ? `Да се отстрани „${r.fileName}“ од листата за проверка?` : undefined} />}
              </td>);
            if (kind === 'sale') {
              const d = (x?.draft ?? {}) as SaleDraft;
              return (
                <tr key={r.doc.id + ':' + r.i}>
                  <td className="mini">{file}</td><td>{d.number}</td><td>{dmy(d.date)}</td>
                  <td>{d.partnerId ? P.get(d.partnerId) : d.buyer?.name}{x && !d.partnerId && d.buyer?.name && <> <span className="pill info">нов</span>{write && !x.savedId && <RowAction action={ensureScanBuyer.bind(null, r.doc.id, r.i!)} label="+ во комитенти" />}</>}</td>
                  <td className="n">{x ? fmt(d.calcTotal ?? d.total ?? 0) : ''}</td>{status}{acts}
                </tr>);
            }
            const d = (x?.draft ?? {}) as PurDraft;
            const b = (d.groups ?? []).reduce((a, g) => a + g.base, 0), v = d.art32 ? 0 : (d.groups ?? []).reduce((a, g) => a + g.vat, 0);
            return (
              <tr key={r.doc.id + ':' + r.i}>
                <td>{k + 1}</td><td>{file}</td>
                <td>{d.partnerId ? P.get(d.partnerId) : d.supplierName}</td><td>{d.number}</td><td>{dmy(d.date)}</td>
                <td className="n">{x ? fmt(b) : ''}</td><td className="n">{x ? fmt(v) : ''}</td><td className="n">{x ? fmt(b + v) : ''}</td><td className="n">{x ? (d.stock ?? []).length : ''}</td>
                {status}{acts}
              </tr>);
          })}</tbody></table></div>
      ) : (mode === 'skan' || batchId) && <div className="card empty">{mode === 'skan' ? 'Нема скенирани документи. Прикачете PDF или слика.' : 'Изберете повеќе фактури. Секоја ќе се прочита, провери и подготви за книжење.'}</div>}
      {kind === 'sale' && R.length > 0 && <p className="mini" style={{ margin: '6px 0 0' }}>„Спремна“ = купувачот, износите и артиклите се совпаѓаат. Новите купувачи се додаваат во комитенти при зачувување. Секоја фактура го задржува бројот од документот и оригиналот (PDF) е прикачен.</p>}
      <p className="note">Читањето го прави вештачка интелигенција (брзо читање; ако износите не се совпаѓаат – подетално). Трошокот се евидентира по фирма. UBL XML (е-фактура) се увезува без читање.</p>
    </>
  );
}
