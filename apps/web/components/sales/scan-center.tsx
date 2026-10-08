/**
 * Скенирање документ (legacy `VIEWS.skan` 4628 → 16235) and Масовно внесување фактури (legacy `VIEWS.masovno`
 * 5361 / `masovnoM` 5360): upload → `ai.read-document` job → review drafts → save (one by one or all "во ред").
 */
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { aiDocuments, files, partners, type AiDocument } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { locationOptions } from '@/lib/sales';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { removeScan, retryScan, saveBatchOk } from '@/app/(app)/skan/actions';
import { AutoRefresh, ScanUpload } from './scan-upload';

const PILL: Record<string, [string, string]> = {
  queued: ['', 'чека'], reading: ['info', 'се чита…'], ok: ['good', '✓ во ред'], check: ['warn', 'провери'], dup: ['bad', 'дупликат'],
  error: ['bad', 'грешка'], saved: ['good', '✓ зачувано'],
};

type Row = { doc: AiDocument; i: number | null; fileName: string };

function rowsOf(docs: AiDocument[], names: Map<string, string>): Row[] {
  return docs.flatMap((doc): Row[] => (doc.status === 'done' || doc.status === 'saved') && doc.drafts.length
    ? doc.drafts.map((_, i) => ({ doc, i, fileName: (names.get(doc.fileId) ?? '') + (doc.drafts.length > 1 ? ` #${i + 1}/${doc.drafts.length}` : '') }))
    : [{ doc, i: null, fileName: names.get(doc.fileId) ?? '' }]);
}

export async function ScanCenter({ mode, sp }: { mode: 'skan' | 'masovno' | 'masovnoM'; sp: { k?: string; b?: string; wh?: string; cash?: string; cost?: string; saved?: string } }) {
  const { u, firm } = await booksPage(mode);
  const title = mode === 'skan' ? 'Скенирање документ' : 'Масовно внесување на влезни фактури';
  if (!firm) return <NoFirm t={title} />;
  const write = canDo(u, 'write', firm.id);
  const kind: 'purchase' | 'sale' = mode === 'skan' && sp.k === 'sale' ? 'sale' : 'purchase';
  const batchId = mode === 'skan' ? null : sp.b && /^[0-9a-f-]{36}$/i.test(sp.b) ? sp.b : null;
  const locs = await locationOptions(firm.id);
  const stores = locs.filter((l) => l.kind === 'store');
  const wh = sp.wh ?? (mode === 'masovnoM' ? stores[0]?.id ?? '' : '');
  const docs = mode === 'skan'
    ? await db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), eq(aiDocuments.kind, kind), isNull(aiDocuments.batchId))).orderBy(desc(aiDocuments.createdAt)).limit(60)
    : batchId ? await db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), eq(aiDocuments.batchId, batchId))).orderBy(aiDocuments.createdAt) : [];
  const names = new Map((docs.length ? await db().select({ id: files.id, n: files.name }).from(files).where(inArray(files.id, docs.map((d) => d.fileId))) : []).map((f) => [f.id, f.n]));
  const P = new Map((await db().select({ id: partners.id, n: partners.name }).from(partners).where(eq(partners.firmId, firm.id))).map((p) => [p.id, p.n]));
  const R = rowsOf(docs, names);
  const st = (r: Row) => (r.i == null ? r.doc.status : r.doc.drafts[r.i]!.savedId ? 'saved' : r.doc.drafts[r.i]!.status);
  const cnt = (k: string) => R.filter((r) => st(r) === k).length;
  const busy = docs.some((d) => d.status === 'queued' || d.status === 'reading');
  const editor = kind === 'sale' ? '/izlez' : '/vlez';
  const back = mode === 'skan' ? `/skan${kind === 'sale' ? '?k=sale' : ''}`
    : `/${mode}?` + new URLSearchParams({ b: batchId ?? '', wh, ...(sp.cash === '1' ? { cash: '1' } : {}), ...(sp.cost === '1' ? { cost: '1' } : {}) }).toString();
  const newBatch = randomUUID();
  const opts = { kind, batchId, cash: sp.cash === '1', warehouseId: wh, costOnly: sp.cost === '1' };

  return (
    <>
      <AutoRefresh active={busy} />
      <Hd t={title} sub={mode === 'skan' ? (kind === 'sale' ? 'излезни фактури што фирмата ги издала' : 'влезни фактури, сметки, UBL XML') : 'повеќе фактури одеднаш'}>
        {mode === 'skan' && <Link className={'btn' + (kind === 'purchase' ? ' pri' : '')} href="/skan">Влезни</Link>}
        {mode === 'skan' && <Link className={'btn' + (kind === 'sale' ? ' pri' : '')} href="/skan?k=sale">Излезни (издадени)</Link>}
        {mode !== 'skan' && batchId && write && <RowAction className="btn pri" action={saveBatchOk.bind(null, batchId)} label={`Зачувај ги сите што се во ред (${cnt('ok')})`} confirm={`Да се зачуваат и прокнижат ${cnt('ok')} фактури?`} />}
        {mode !== 'skan' && batchId && <Link className="btn" href={`/${mode}`}>Нова листа</Link>}
      </Hd>
      {mode !== 'skan' && !batchId ? (
        <form className="card" method="get">
          <input type="hidden" name="b" value={newBatch} />
          <div className="row" style={{ gap: '10px 16px', alignItems: 'end' }}>
            <label className="f">Стоката во објект<select name="wh" defaultValue={wh}><option value="">01 Главен магацин</option>{locs.map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="cash" value="1" style={{ width: 'auto' }} /> Фискални сметки платени во готово</label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="cost" value="1" style={{ width: 'auto' }} /> Директни трошоци – без приемница / калкулација</label>
            <button className="btn pri">Почни нова листа</button>
          </div>
        </form>
      ) : write && (
        <div className="card">
          {mode !== 'skan' && <p className="note">Објект: <b>{locs.find((l) => l.id === wh)?.name ?? 'Главен магацин'}</b>{opts.cash && ' · готовина'}{opts.costOnly && ' · директни трошоци'}</p>}
          <ScanUpload firmId={firm.id} opts={opts} small={mode === 'skan'} label={mode === 'skan'
            ? <><b>{kind === 'sale' ? 'Скенирај излезни фактури' : 'Прочитај фактура од PDF'}</b> — повлечете една или повеќе датотеки (PDF, JPG, PNG{kind === 'purchase' ? ', UBL XML' : ''}) тука или кликнете. Се читаат автоматски; потоа ги проверувате и зачувувате.</>
            : <><b>Повлечете ги сите фактури одеднаш</b> (PDF, JPG, PNG, XML) или кликнете за избор.<br /><small>Секоја се проверува (износи, ДДВ по стапки, дупликати). Оние „во ред“ се зачувуваат со едно копче, другите ги отворате и поправате.</small></>} />
        </div>
      )}
      {R.length > 0 && mode !== 'skan' && (
        <div className="tiles kpi k4">{[['Вкупно', R.length, 't3'], ['Во ред', cnt('ok'), 't1'], ['За проверка', cnt('check') + cnt('dup') + cnt('error'), 't2'], ['Зачувани', cnt('saved'), 't8']].map(([a, b, t]) => <div key={String(a)} className={'tile kt ' + t}><span>{a}</span><b className="num">{b}</b></div>)}</div>
      )}
      {R.length ? (
        <div className="tw"><table><thead><tr><th>#</th><th>Датотека</th><th>{kind === 'sale' ? 'Купувач' : 'Добавувач'}</th><th>Број</th><th>Датум</th><th className="n">Износ</th><th>Статус</th><th></th></tr></thead>
          <tbody>{R.map((r, k) => {
            const x = r.i == null ? null : r.doc.drafts[r.i]!;
            const d = (x?.draft ?? {}) as { partnerId?: string; supplierName?: string; buyer?: { name?: string }; number?: string; date?: string; groups?: { base: number; vat: number }[]; total?: number; art32?: boolean };
            const tot = kind === 'sale' ? d.total ?? 0 : (d.groups ?? []).reduce((a, g) => a + g.base + (d.art32 ? 0 : g.vat), 0);
            const s0 = st(r);
            const [pc, pt] = PILL[s0] ?? ['', s0];
            return (
              <tr key={r.doc.id + ':' + r.i}>
                <td>{k + 1}</td><td title={r.fileName}><a href={`/api/files/${r.doc.fileId}`} target="_blank" rel="noreferrer">{r.fileName.slice(0, 34)}</a></td>
                <td>{d.partnerId ? P.get(d.partnerId) : d.supplierName ?? d.buyer?.name}</td><td>{d.number}</td><td>{dmy(d.date)}</td><td className="n">{x ? fmt(tot) : ''}</td>
                <td><span className={'pill ' + pc}>{pt}</span>{(x?.msg || r.doc.error) && <div className="mini">{x?.msg || r.doc.error}</div>}{r.doc.model && <div className="mini">{r.doc.model}</div>}</td>
                <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  {x && !x.savedId && write && <Link className="btn sm" href={`${editor}?scan=${r.doc.id}&i=${r.i}&back=${encodeURIComponent(back)}`}>{s0 === 'ok' ? 'Прегледај' : 'Отвори и поправи'}</Link>}
                  {x?.savedId && <Link className="btn sm ghost" href={`${editor}?edit=${x.savedId}`}>Отвори</Link>}
                  {write && r.doc.status === 'error' && <RowAction action={retryScan.bind(null, r.doc.id)} label="↻ Повторно" />}
                  {write && r.doc.status !== 'reading' && r.doc.status !== 'saved' && !x?.savedId && <RowAction action={removeScan.bind(null, r.doc.id)} label="✕" title="Отстрани" />}
                </td>
              </tr>);
          })}</tbody></table></div>
      ) : (mode === 'skan' || batchId) && <div className="card empty">{mode === 'skan' ? 'Нема скенирани документи. Прикачете PDF или слика.' : 'Изберете повеќе фактури. Секоја ќе се прочита, провери и подготви за книжење.'}</div>}
      <p className="note">Читањето го прави вештачка интелигенција (брзо читање; ако износите не се совпаѓаат – подетално). Трошокот се евидентира по фирма. UBL XML (е-фактура) се увезува без читање.</p>
    </>
  );
}
