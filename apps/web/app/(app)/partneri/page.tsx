/** Legacy `VIEWS.partneri` 6818 → `partneri0` 6819 (`simpleList`), Шифрарник › Комитенти. */
import Link from 'next/link';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { partners } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { nextCode } from '@/lib/codes';
import { db } from '@/lib/db';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { autoCodesAction, deletePartner, deletePartnersAction, setPartnerActive } from './actions';
import { partnerUsage, usedList } from '@/lib/sales-parity';
import { BulkBar, SelAll, SelBox } from '@/components/sales/bulk-select';
import { PartnerForm } from './partner-form';
import { TK_F, tkFromRead, tkMatch } from '@wise/core/firms/resh';
import { loadAiResult } from '@/lib/ai';
import { filesOf } from '@/lib/office';
import { ActionForm } from '@/components/action-form';
import { FileChips } from '@/components/file-chips';
import { saveTk } from './actions';
import { TkScan } from './tk-scan';

const LIMIT = 500;

export default async function PartneriPage({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string; nov?: string; use?: string; tk?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { u, firm } = await booksPage('partneri');
  if (!firm) return <NoFirm t="Партнери" />;
  const q = (sp.q ?? '').trim();
  const where = and(eq(partners.firmId, firm.id), q
    ? or(ilike(partners.name, `%${q}%`), ilike(partners.edb, `%${q}%`), ilike(partners.code, `%${q}%`), ilike(partners.city, `%${q}%`))
    : undefined);
  const [rows, [total], usage, allCodes] = await Promise.all([
    db().select().from(partners).where(where).orderBy(asc(partners.name)).limit(LIMIT),
    db().select({ n: sql<number>`count(*)::int` }).from(partners).where(where),
    partnerUsage(firm.id),
    db().select({ code: partners.code }).from(partners).where(eq(partners.firmId, firm.id)),
  ]);
  const used = usage;
  const admin = u.role === 'admin' && canDo(u, 'del', firm.id);
  const useP = sp.use ? rows.find((r) => r.id === sp.use) : undefined;
  const useL = useP ? await usedList(firm.id, 'partner', useP.id) : [];
  const noCode = allCodes.some((c) => !String(c.code ?? '').trim());
  const write = canDo(u, 'write', firm.id), del = canDo(u, 'del', firm.id);
  const edit = sp.edit ? (await db().select().from(partners).where(and(eq(partners.id, sp.edit), eq(partners.firmId, firm.id))).limit(1))[0] : undefined;
  const showForm = write && (sp.nov !== undefined || !!edit);
  // legacy v404 tkModal: the next read ЦРМ extract to check (`?tk=` = the reads still to go)
  const tkIds = write ? (sp.tk ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 20) : [];
  let tk: { id: string; fileId: string | null; r: ReturnType<typeof tkFromRead>; rest: string[]; n: number } | null = null;
  for (let i = 0; i < tkIds.length && !tk; i++) {
    const d = await loadAiResult(firm.id, tkIds[i], 'tk');
    if (d && d.status === 'done') tk = { id: d.id, fileId: d.fileId, r: tkFromRead(d.result), rest: tkIds.slice(i + 1), n: i };
  }
  const tkEx = tk ? tkMatch(tk.r, await db().select({ id: partners.id, name: partners.name, code: partners.code, edb: partners.edb, embs: partners.embs }).from(partners).where(eq(partners.firmId, firm.id))) : undefined;
  const pFiles = await filesOf('partner', rows.map((r) => r.id));

  return (
    <>
      <Hd t="Партнери" sub={`${total?.n ?? 0} комитенти`}>
        {write && !showForm && <Link className="btn" href="/uvoz?t=partners&back=partneri">Увоз од Excel</Link>}
        {write && noCode && <RowAction className="btn" action={autoCodesAction} label="Додели шифри" title="Автоматски шифри за сите без шифра" />}
        {write && <Link className="btn pri" href="/partneri?nov">+ Додај</Link>}
      </Hd>
      {sp.ok && <div className="callout good">{sp.ok}</div>}
      {write && !tk && <TkScan firmId={firm.id} />}
      {tk && (
        <ActionForm action={saveTk} reset={false} style={{ maxWidth: 720 }}>
          <div className="hd"><h2>📄 Комитент од тековна состојба {tkIds.length > 1 && <span className="mini">({tk.n + 1} од {tkIds.length})</span>}</h2><Link className="btn" href="/partneri">Затвори</Link></div>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{tk.fileId && <a className="btn sm" href={`/api/files/${tk.fileId}`} target="_blank" rel="noreferrer">👁 Документ</a>}{tk.r.docDate && <span className="pill">тековна од {tk.r.docDate.split('-').reverse().join('.')}</span>}</div>
          <div className={`callout ${tk.r.name ? 'good' : 'warn'}`}>{tk.r.name ? '✓ Прочитано – проверете ги податоците.' : 'Не се најде назив – проверете дали документот е тековна состојба или пополнете рачно.'}</div>
          {tkEx && <div className="callout warn">Комитентот веќе постои: <b>{tkEx.name}</b> (шифра {tkEx.code ?? ''}). Со „Зачувај“ ќе се дополнат празните и изменетите податоци и ќе се прикачи тековната состојба.</div>}
          <input type="hidden" name="readId" value={tk.id} />
          <input type="hidden" name="rest" value={tk.rest.join(',')} />
          <div className="form" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {TK_F.map(([k, l]) => <label key={k} className="f" style={k === 'name' || k === 'activity' ? { gridColumn: '1/-1' } : undefined}>{l}<input name={k} defaultValue={tk.r[k]} /></label>)}
          </div>
          <div className="row" style={{ gap: 14, marginTop: 6, flexWrap: 'wrap' }}><label className="chk"><input type="checkbox" name="ddv" defaultChecked={tk.r.ddv} /> ДДВ обврзник</label></div>
          <p className="note">Тековната состојба не покажува дали фирмата е ДДВ обврзник – проверете на фактурата или на УЈП и штиклирајте.</p>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            {tkIds.length > 1 && <Link className="btn" href={tk.rest.length ? `/partneri?tk=${tk.rest.join(',')}` : '/partneri'}>Прескокни</Link>}
            <button className="btn pri">{tkEx ? 'Дополни го комитентот' : 'Зачувај нов комитент'}</button>
          </div>
        </ActionForm>
      )}
      {showForm && <PartnerForm p={edit ?? null} nextCode={nextCode(allCodes.map((c) => c.code))} used={edit ? used.get(edit.id) ?? 0 : 0} />}
      {showForm && edit && !(used.get(edit.id) ?? 0) && canDo(u, 'del', firm.id) && <div className="row" style={{ marginTop: -6, marginBottom: 10 }}><RowAction className="btn danger" action={deletePartner.bind(null, edit.id)} label="Избриши" confirm={`Да се избрише „${edit.name}“?`} /></div>}
      {useP && <div className="card"><div className="hd"><h2>🔒 {useP.name} – се користи во {used.get(useP.id) ?? 0} документи</h2><Link className="btn sm" href="/partneri">✕</Link></div>
        <p className="note">Партнер/артикл што е користен не може да се избрише, за да не се расипат книжењата. Ако документите се погрешни, прво избришете ги нив (во нивната листа) – потоа ќе може да се избрише и овој. Инаку означете го како неактивен.</p>
        <div className="tw"><table className="dense"><thead><tr><th>Вид</th><th>Број</th><th>Датум</th><th className="n">Износ</th></tr></thead><tbody>{useL.map((x, k) => <tr key={k}><td>{x.kind}</td><td>{x.number}</td><td>{x.date.split('-').reverse().join('.')}</td><td className="n">{x.total == null ? '' : x.total.toLocaleString('mk-MK', { minimumFractionDigits: 2 })}</td></tr>)}</tbody></table></div></div>}
      <form className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input name="q" defaultValue={q} placeholder="🔍 Барај по назив, ЕДБ, шифра или град…" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn">Барај</button>
      </form>
      {rows.length ? (<>
        {admin && <BulkBar label={`🗑 Избриши ги избраните ({n})`} confirm={`Да се избришат {n} избрани?\nТие што се користат во фактури, каса, налози или плати НЕ се бришат (може „Неактивен“).\n\nОва не може да се врати.`} action={deletePartnersAction} />}
        <div className="tw"><table>
          <thead><tr>{admin && <th style={{ width: 30 }}><SelAll /></th>}<th>Шифра</th><th>Назив</th><th>ЕДБ</th><th>Адреса</th><th>Град</th><th>Е-пошта</th><th>Телефон (WhatsApp/Viber)</th><th>Жиро сметка</th><th>ДДВ обврзник</th><th>Активен</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const n = used.get(r.id) ?? 0;
              return (
                <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
                  {admin && <td><SelBox id={r.id} /></td>}
                  <td>{r.code}</td><td>{r.name}{pFiles.get(r.id)?.length ? <> <FileChips files={pFiles.get(r.id)} /></> : null}</td><td>{r.edb}</td><td>{r.address}</td><td>{r.city}</td><td>{r.email}</td><td>{r.phone}</td>
                  <td>{r.bankAccount}</td><td>{r.vatRegistered ? 'Да' : 'Не'}</td><td>{r.active ? 'Да' : 'Не'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {write && <Link className="btn sm" href={`/partneri?edit=${r.id}${q ? '&q=' + encodeURIComponent(q) : ''}`}>Измени</Link>}{' '}
                    {n > 0 ? (
                      <>
                        <Link className="btn sm ghost" href={`/partneri?use=${r.id}${q ? '&q=' + encodeURIComponent(q) : ''}`} title={`Користен во ${n} документи – не може да се избрише. Кликнете за да видите каде.`}>🔒 {n}</Link>{' '}
                        {write && <RowAction action={setPartnerActive.bind(null, r.id, !r.active)} label={r.active ? 'Неактивен' : 'Активирај'} />}
                      </>
                    ) : del && (
                      <RowAction action={deletePartner.bind(null, r.id)} label="Избриши" confirm={`Да се избрише „${r.name}“?`} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div></>
      ) : <div className="card empty">{q ? `Нема комитент што одговара на „${q}“.` : 'Листата е празна.'}</div>}
      {(total?.n ?? 0) > LIMIT && <p className="note">Прикажани се првите {LIMIT}. Користете пребарување.</p>}
    </>
  );
}
