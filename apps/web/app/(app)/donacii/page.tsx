/**
 * Финансово › 🎁 Донации и спонзорства: contracts of a firm that receives (здружение, фондација, спортски клуб) or gives
 * donations / sponsorships (Закон за донации и спонзорства во јавните дејности), the confirmation of the realised
 * donation, the signed scans, statement lines that look like donations without a contract, totals per donor and year,
 * and the booking proposal. `?ed=new|<id>` editor (`&mv=<bank line id>` prefill from a statement line).
 */
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { DON_AREAS, DON_KIND_LBL, DON_LIMIT, donAssetKonto, donEntries, donKonto, donTotals, nextDonNo, type DonKind, type DonRole } from '@wise/core/donations';
import { partners, type Donation } from '@wise/db';
import { booksPage, canDo } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { today } from '@/lib/finance';
import { ActionForm } from '@/components/action-form';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { RowAction } from '@/components/row-action';
import { UploadField } from '@/components/upload-field';
import { attachDonSignedAction, bookDonationAction, deleteDonationAction, saveConfAction, saveDonationAction, unbookDonationAction } from './actions';
import { DonationConfirmation, DonationContract } from './contract';
import { donData, realizedOf } from './data';

type SP = { ed?: string; kind?: string; role?: string; mv?: string; y?: string; p?: string; t?: string };
const T = 'Донации и спонзорства';

export default async function DonaciiPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('donacii');
  if (!firm) return <NoFirm t={'🎁 ' + T} />;
  const [D, P] = await Promise.all([donData(firm, year), db().select().from(partners).where(eq(partners.firmId, firm.id)).orderBy(asc(partners.name))]);
  const pm = new Map(P.map((p) => [p.id, p]));
  const write = canDo(u, 'donSave', firm.id);
  const td = today();
  const defRole: DonRole = D.npo ? 'received' : 'given';

  if (sp.ed && write) {
    const ex = sp.ed !== 'new' ? D.list.find((d) => d.id === sp.ed) : undefined;
    const mv = sp.mv ? D.flows.find((r) => r.id === sp.mv) : undefined;
    const kind: DonKind = ex?.kind ?? mv?.kind ?? (sp.kind === 'sponsorship' ? 'sponsorship' : 'donation');
    const role: DonRole = ex?.role ?? mv?.role ?? (sp.role === 'given' ? 'given' : sp.role === 'received' ? 'received' : defRole);
    const date = mv?.date ?? td;
    const E: Donation = ex ?? {
      id: '', firmId: firm.id, kind, role, partnerId: mv?.partnerId || null, partnerName: null,
      number: nextDonNo(D.list.filter((x) => x.kind === kind && x.role === role).map((x) => ({ no: x.number, date: x.date })), date.slice(0, 4)),
      date, place: firm.city ?? null, amount: mv ? mv.amt.toFixed(2) : '', inKind: false, inKindDesc: null, purpose: null, area: null, counter: null, termDate: null,
      cash: false, signed: false, konto: mv?.konto || donKonto(kind, role, D.chartMode), moveIds: mv ? [mv.id] : [],
      confNumber: null, confDate: null, confAmount: null, confNote: null, journalId: null, createdBy: null, createdAt: new Date(), updatedAt: new Date(),
    };
    const lk = (id: string) => D.lineOf.get(id);
    // statement lines of the year in the same direction (and the ones already linked)
    const B = [
      ...E.moveIds.map((id) => lk(id) ?? D.flows.find((r) => r.id === id)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ id: x.id, date: x.date, amt: x.amt, desc: x.desc, partnerId: x.partnerId ?? '' })),
      ...D.flows.filter((r) => r.role === E.role && !E.moveIds.includes(r.id) && (!E.partnerId || !r.partnerId || r.partnerId === E.partnerId) && !D.list.some((x) => x.id !== E.id && x.moveIds.includes(r.id))),
    ];
    const moves = E.moveIds.map((id) => lk(id)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ date: x.date, amt: x.amt, src: x.src }));
    const real = ex ? realizedOf(ex, D.lineOf) : 0;
    const partner = E.partnerId ? pm.get(E.partnerId) : undefined;
    const pdf = (doc: string) => `/print/fin/${doc}?id=${ex?.id}`;
    const konto = E.konto || donKonto(E.kind, E.role, D.chartMode, E.inKind);
    const assetDef = donAssetKonto(E.role, D.chartMode);
    const prop = donEntries({ kind: E.kind, role: E.role, amount: Number(E.confAmount ?? E.amount) || 0, inKind: E.inKind, konto, bankKonto: D.bankKonto, assetKonto: assetDef, chart: D.chartMode });
    return (
      <>
        <Hd t={(ex ? DON_KIND_LBL[E.kind] + ' – договор ' : 'Нов договор – ' + DON_KIND_LBL[E.kind].toLowerCase() + ' ') + (E.number ?? '')} sub={E.role === 'received' ? '📥 фирмата е примател' : '📤 фирмата е донатор / спонзор'}>
          <Link className="btn" href="/donacii">← Листа</Link>
          {ex && <a className="btn" href={pdf('donacija')} target="_blank" rel="noopener">📄 Договор PDF</a>}
          {ex && <a className="btn" href={`/donacii/word?id=${ex.id}`}>Word</a>}
          {ex?.confDate && <a className="btn" href={pdf('donPotvrda')} target="_blank" rel="noopener">🧾 Потврда PDF</a>}
        </Hd>
        <ActionForm action={saveDonationAction} reset={false}>
          <input type="hidden" name="id" value={ex?.id ?? ''} />
          <div className="form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 }}>
            <label className="f">Вид<select name="kind" defaultValue={E.kind}><option value="donation">Донација</option><option value="sponsorship">Спонзорство</option></select></label>
            <label className="f">Фирмата е<select name="role" defaultValue={E.role}><option value="received">примател (здружение, фондација, клуб)</option><option value="given">донатор / спонзор</option></select></label>
            <label className="f">{E.role === 'received' ? 'Донатор / спонзор' : 'Примател'} (комитент)<select name="partnerId" defaultValue={E.partnerId ?? ''} required><option value="">— изберете —</option>{P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="f">Број на договорот<input name="number" defaultValue={E.number ?? ''} /></label>
            <label className="f">Датум<input name="date" type="date" defaultValue={E.date} required /></label>
            <label className="f">Место<input name="place" defaultValue={E.place ?? ''} /></label>
            <label className="f">Износ / вредност (ден.)<input name="amount" type="number" step="0.01" defaultValue={E.amount} required /></label>
            <label className="f">Рок за уплата / предавање<input name="termDate" type="date" defaultValue={E.termDate ?? ''} /></label>
            <label className="f">Област од јавен интерес<input name="area" list="donAreas" defaultValue={E.area ?? ''} placeholder="спорт, култура…" /></label>
            <label className="f">Конто за книжење<input name="konto" defaultValue={E.konto ?? ''} title="примател: 7673 донации во пари, 7672 во добра, 7694 спонзорства (НПО план: 731); донатор: 4433 донации, 4430 спонзорства (НПО план: 450 правни лица, 451 физички лица)" /></label>
            <label className="f" style={{ gridColumn: '1/-1' }}>Намена<input name="purpose" defaultValue={E.purpose ?? ''} placeholder="на пр. за набавка на спортска опрема за младинската школа" /></label>
            <label className="f" style={{ gridColumn: '1/-1' }}>Добра / услуги (ако донацијата е во добра)<input name="inKindDesc" defaultValue={E.inKindDesc ?? ''} placeholder="на пр. 20 комплети дресови, 10 топки" /></label>
            <label className="f" style={{ gridColumn: '1/-1' }}>Противуслуга (само спонзорство)<input name="counter" defaultValue={E.counter ?? ''} placeholder="на пр. логото на спонзорот на дресовите и на банер на теренот во сезоната 2026/27" /></label>
          </div>
          <datalist id="donAreas">{DON_AREAS.map((a) => <option key={a} value={a} />)}</datalist>
          <div className="row" style={{ gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
            <label className="chk"><input type="checkbox" name="inKind" value="1" defaultChecked={E.inKind} /> Во добра / услуги (не во пари)</label>
            <label className="chk"><input type="checkbox" name="cash" value="1" defaultChecked={E.cash} /> Во готово (не преку сметка)</label>
            <label className="chk"><input type="checkbox" name="signed" value="1" defaultChecked={E.signed} /> Договорот е потпишан од двете страни</label>
          </div>
          {B.length > 0 && (
            <div style={{ marginTop: 10 }}><b style={{ fontSize: 13 }}>{E.role === 'received' ? 'Уплати' : 'Исплати'} од изводите за овој договор ({year}):</b>
              {B.map((r) => (
                <label key={r.id} className="chk" style={{ display: 'block', margin: '3px 0' }}>
                  <input type="checkbox" name="mv" value={r.id} defaultChecked={E.moveIds.includes(r.id)} /> {dmy(r.date)} · {pm.get(r.partnerId)?.name ?? ''} · <b>{fmt(r.amt)}</b> · <span className="mini">{r.desc.slice(0, 70)}</span>
                </label>
              ))}
            </div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button className="btn pri">Зачувај</button></div>
        </ActionForm>

        {ex && (
          <div className="card">
            <h2 style={{ margin: '0 0 6px' }}>🧾 Потврда за {E.kind === 'sponsorship' ? 'примено спонзорство' : 'примена донација'}</h2>
            <p className="muted" style={{ fontSize: 12.5, margin: '0 0 6px' }}>
              {E.role === 'received' ? 'Ја издава фирмата (примателот) на донаторот – со неа донаторот го признава расходот.' : 'Ја издава примателот на фирмата – прикачете ја скенирана; овде може да ја подготвите за потпис.'}
              {' '}Реализирано по изводи: <b>{fmt(E.moveIds.reduce((s, id) => s + (lk(id)?.amt ?? 0), 0))}</b> од {fmt(E.amount)} ден.
            </p>
            <ActionForm action={saveConfAction} reset={false}>
              <input type="hidden" name="id" value={ex.id} />
              <div className="form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 8 }}>
                <label className="f">Број на потврдата<input name="confNumber" defaultValue={E.confNumber ?? ''} placeholder="автоматски" /></label>
                <label className="f">Датум<input name="confDate" type="date" defaultValue={E.confDate ?? (moves.at(-1)?.date ?? td)} required /></label>
                <label className="f">Реализиран износ / вредност<input name="confAmount" type="number" step="0.01" defaultValue={E.confAmount ?? (real || Number(E.amount)).toFixed(2)} required /></label>
                <label className="f" style={{ gridColumn: '1/-1' }}>Забелешка (по избор)<input name="confNote" defaultValue={E.confNote ?? ''} placeholder="на пр. добрата се примени со записник бр. 3 од 12.05.2026" /></label>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button className="btn pri">Зачувај потврда</button></div>
            </ActionForm>
          </div>
        )}

        {ex && (
          <div className="card">
            <h2 style={{ margin: '0 0 6px' }}>📒 Предлог за книжење</h2>
            <table className="dense"><thead><tr><th>Конто</th><th>Опис</th><th className="n">Должи</th><th className="n">Побарува</th></tr></thead>
              <tbody>{prop.map((l, i) => (
                <tr key={i}><td>{l.account}</td><td>{D.kName.get(l.account) ?? (E.inKind ? (E.role === 'received' ? 'добра / средства (спротивно конто)' : 'дадени добра (спротивно конто)') : 'жиро сметка')}{l.partner && partner ? ' · ' + partner.name : ''}</td><td className="n">{l.debit ? fmt(l.debit) : ''}</td><td className="n">{l.credit ? fmt(l.credit) : ''}</td></tr>
              ))}</tbody></table>
            {!D.codes.has(konto) && ![...D.codes].some((c) => c.startsWith(konto)) && <p className="callout warn">⚠ Контото {konto} го нема во контниот план на фирмата – додадете го (Шифрарник → Конта) или сменете го во договорот.</p>}
            {E.inKind ? (
              E.journalId
                ? <p className="row" style={{ gap: 8, alignItems: 'center' }}><span className="pill good">✓ прокнижено (налог)</span>{canDo(u, 'donBook', firm.id) && <RowAction label="↩ Избриши го налогот" confirm="Да се избрише налогот на донацијата во добра?" action={unbookDonationAction.bind(null, ex.id)} />}</p>
                : canDo(u, 'donBook', firm.id) && (
                  <ActionForm action={bookDonationAction} reset={false}>
                    <input type="hidden" name="id" value={ex.id} />
                    <div className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                      <label className="f">Спротивно конто за добрата<input name="assetKonto" defaultValue={assetDef} title={D.chartMode === 'npo' ? 'на пр. 310 материјали, 02x опрема, 4xx директен трошок' : E.role === 'received' ? 'на пр. 3100 материјали, 0230 опрема, 4xx директен трошок' : 'на пр. 6600 стоки, 3100 материјали'} /></label>
                      <button className="btn pri">📒 Прокнижи (налог)</button>
                    </div>
                  </ActionForm>
                )
            ) : (
              <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="mini">Уплатите од изводот ({E.moveIds.length}) добиваат конто {konto}{partner ? ' и комитент ' + partner.name : ''}; налогот на изводот се книжи повторно.</span>
                {E.moveIds.some((id) => lk(id)?.konto === konto) && <span className="pill good">✓ {E.moveIds.filter((id) => lk(id)?.konto === konto).length} / {E.moveIds.length} веќе на {konto}</span>}
                {canDo(u, 'donBook', firm.id) && E.moveIds.length > 0 && (
                  <ActionForm action={bookDonationAction} reset={false}><input type="hidden" name="id" value={ex.id} /><button className="btn pri">📒 Книжи ги уплатите на {konto}</button></ActionForm>
                )}
              </div>
            )}
            <p className="note">{E.role === 'received'
              ? (D.chartMode === 'npo' ? 'Контен план за НПО: 731 Приходи од подароци, донации и други извори.' : 'Примател: 7673 Приходи од донации во земјата (пари), 7672 донации во добра, 7694 спонзорства. Донациите и спонзорствата на НПО не се оданочуваат (не се стопанска дејност).')
              : `Донатор: 4433 Донации во земјата / 4430 Спонзорства во земјата. Признаен расход до ${DON_LIMIT.donation * 100}% (донации) и ${DON_LIMIT.sponsorship * 100}% (спонзорства) од вкупниот приход (ЗДД чл. 9) – потребни се договорот и потврдата за примена донација.`}</p>
          </div>
        )}

        {ex && (
          <ActionForm action={attachDonSignedAction} reset={false}>
            <input type="hidden" name="id" value={ex.id} />
            <div className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
              <UploadField firmId={firm.id} label="📎 Прикачи потпишан договор / потврда / записник (скен)" accept="application/pdf,image/*" />
              <button className="btn">Зачувај прилог</button>
              {(D.fileOf.get(ex.id) ?? []).map((f, i) => <a key={f} className="btn sm" href={`/api/files/${f}`} target="_blank" rel="noopener">📎 {i + 1}</a>)}
            </div>
          </ActionForm>
        )}
        <div className="card"><div className="pdfwrap"><div className="pdfdoc" style={{ margin: '0 auto' }}><DonationContract d={E} firm={firm} partner={partner} firmAcct={D.firmAcct} /></div></div></div>
        {ex?.confDate && <div className="card"><div className="pdfwrap"><div className="pdfdoc" style={{ margin: '0 auto' }}><DonationConfirmation d={E} firm={firm} partner={partner} firmAcct={D.firmAcct} moves={moves} /></div></div></div>}
      </>
    );
  }

  // ---- list
  const yAll = sp.y === 'all';
  const fy = yAll ? null : /^\d{4}$/.test(sp.y ?? '') ? sp.y! : String(year);
  const rows = D.list.filter((d) => (!fy || d.date.startsWith(fy)) && (!sp.kind || d.kind === sp.kind) && (!sp.role || d.role === sp.role) && (!sp.p || d.partnerId === sp.p))
    .sort((a, b) => b.date.localeCompare(a.date));
  const tot = donTotals(rows.map((d) => ({ id: d.id, kind: d.kind, role: d.role, partnerId: d.partnerId, partnerName: d.partnerId ? pm.get(d.partnerId)?.name ?? '' : d.partnerName, date: d.date, amount: Number(d.amount), realized: realizedOf(d, D.lineOf) })));
  const years = [...new Set([String(year), ...D.list.map((d) => d.date.slice(0, 4))])].sort().reverse();
  const sum = (r: DonRole) => rows.filter((d) => d.role === r).reduce((s, d) => s + Number(d.amount), 0);
  const noConf = rows.filter((d) => d.role === 'received' && !d.confDate).length;
  const usedP = [...new Set(D.list.map((d) => d.partnerId).filter((x): x is string => !!x))].map((id) => pm.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
  return (
    <>
      <Hd t={'🎁 ' + T} sub={D.npo ? 'здружение / фондација / клуб · договори, потврди за примена донација, книжење' : 'договори за донации и спонзорства · потврди · книжење'}>
        {write && <Link className="btn pri" href={`/donacii?ed=new&kind=donation&role=${defRole}`}>+ Договор за донација</Link>}
        {write && <Link className="btn pri" href={`/donacii?ed=new&kind=sponsorship&role=${defRole}`}>+ Договор за спонзорство</Link>}
        {write && <Link className="btn" href={`/donacii?ed=new&kind=donation&role=${defRole === 'received' ? 'given' : 'received'}`}>{defRole === 'received' ? '+ Фирмата дава донација' : '+ Фирмата прима донација'}</Link>}
      </Hd>
      <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end', margin: '6px 0' }}>
        <label className="f">Вид<select name="kind" defaultValue={sp.kind ?? ''}><option value="">сите</option><option value="donation">Донации</option><option value="sponsorship">Спонзорства</option></select></label>
        <label className="f">Фирмата е<select name="role" defaultValue={sp.role ?? ''}><option value="">примател и донатор</option><option value="received">примател</option><option value="given">донатор / спонзор</option></select></label>
        <label className="f">Година<select name="y" defaultValue={yAll ? 'all' : fy ?? ''}>{years.map((y) => <option key={y} value={y}>{y}</option>)}<option value="all">сите години</option></select></label>
        <label className="f">Донатор / примател<select name="p" defaultValue={sp.p ?? ''}><option value="">сите</option>{usedP.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button className="btn">Филтрирај</button>
      </form>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '6px 0' }}>
        {([['📥 Примени (договорено)', fmt(sum('received'))], ['📤 Дадени (договорено)', fmt(sum('given'))], ['🧾 Примени без потврда', String(noConf)], ['⛔ Уплати без договор', String(D.unlinked.length)]] as const).map(([t, n]) => (
          <div key={t} className="card" style={{ flex: 1, minWidth: 180, margin: 0 }}><div className="muted" style={{ fontSize: 12.5 }}>{t}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{n}</div></div>
        ))}
      </div>
      {D.unlinked.length > 0 && (
        <details className="card" style={{ borderColor: 'var(--warn)' }}>
          <summary><b>⛔ {D.unlinked.length} ставки од изводите ({year}) личат на донација / спонзорство, а немаат договор</b></summary>
          <table className="dense" style={{ marginTop: 6 }}><thead><tr><th>Датум</th><th>Вид</th><th>Комитент</th><th>Опис</th><th className="n">Износ</th><th /></tr></thead>
            <tbody>{D.unlinked.map((r) => (
              <tr key={r.id}><td>{dmy(r.date)}</td><td>{r.role === 'received' ? '📥 ' : '📤 '}{DON_KIND_LBL[r.kind]}</td><td>{pm.get(r.partnerId)?.name ?? '—'}</td><td className="mini">{r.desc.slice(0, 80)}</td><td className="n">{fmt(r.amt)}</td>
                <td>{write && <Link className="btn sm pri" href={`/donacii?ed=new&mv=${r.id}`}>📝 Направи договор</Link>}</td></tr>
            ))}</tbody></table>
        </details>
      )}
      <div className="card tw"><table className="dense">
        <thead><tr><th>Бр.</th><th>Вид</th><th>Донатор → примател</th><th>Датум</th><th>Намена</th><th className="n">Износ</th><th className="n">Реализирано</th><th>Потврда</th><th>Договор</th><th /></tr></thead>
        <tbody>{rows.length ? rows.map((d) => {
          const pn = d.partnerId ? pm.get(d.partnerId)?.name ?? '—' : d.partnerName ?? '—';
          const real = realizedOf(d, D.lineOf);
          return (
            <tr key={d.id}>
              <td>{d.number}</td>
              <td>{d.role === 'received' ? '📥 ' : '📤 '}{DON_KIND_LBL[d.kind]}{d.inKind && <> <span className="pill">во добра</span></>}</td>
              <td>{d.role === 'received' ? <>{pn} → <span className="muted">фирмата</span></> : <><span className="muted">фирмата</span> → {pn}</>}</td>
              <td>{dmy(d.date)}</td><td className="mini">{[d.purpose, d.area].filter(Boolean).join(' · ').slice(0, 60)}</td>
              <td className="n">{fmt(d.amount)}</td><td className="n">{real ? fmt(real) : '—'}</td>
              <td>{d.confDate ? <a href={`/print/fin/donPotvrda?id=${d.id}`} target="_blank" rel="noopener" className="pill good">✓ {d.confNumber}</a> : <span className="pill warn">нема</span>}</td>
              <td>{d.signed ? <span className="pill good">✓ потпишан</span> : <span className="pill warn">непотпишан</span>}{(D.fileOf.get(d.id) ?? []).map((f) => <a key={f} href={`/api/files/${f}`} target="_blank" rel="noopener" title="Прилог"> 📎</a>)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {write && <Link className="btn sm" href={`/donacii?ed=${d.id}`}>✎</Link>}{' '}
                <a className="btn sm" href={`/print/fin/donacija?id=${d.id}`} target="_blank" rel="noopener">PDF</a>{' '}
                <a className="btn sm" href={`/donacii/word?id=${d.id}`}>Word</a>
                {canDo(u, 'del', firm.id) && <RowAction label="🗑" title="Избриши" confirm={`Да се избрише договорот ${d.number ?? ''}?`} action={deleteDonationAction.bind(null, d.id)} />}
              </td>
            </tr>
          );
        }) : <tr><td colSpan={10} className="muted">Нема договори за донации / спонзорства{fy ? ` во ${fy}` : ''}.</td></tr>}</tbody>
      </table></div>
      {tot.length > 0 && (
        <div className="card tw">
          <h2 style={{ margin: '0 0 6px' }}>Вкупно по донатор / примател и година</h2>
          <table className="dense"><thead><tr><th>Година</th><th>Комитент</th><th className="n">Договори</th><th className="n">Договорено</th><th className="n">Реализирано</th></tr></thead>
            <tbody>
              {tot.map((t) => <tr key={(t.partnerId ?? t.name) + t.year}><td>{t.year}</td><td>{t.partnerId ? <Link href={`/donacii?p=${t.partnerId}&y=all`}>{t.name}</Link> : t.name}</td><td className="n">{t.n}</td><td className="n">{fmt(t.amount)}</td><td className="n">{fmt(t.realized)}</td></tr>)}
              <tr className="tot"><td colSpan={2}>Вкупно</td><td className="n">{tot.reduce((s, t) => s + t.n, 0)}</td><td className="n">{fmt(tot.reduce((s, t) => s + t.amount, 0))}</td><td className="n">{fmt(tot.reduce((s, t) => s + t.realized, 0))}</td></tr>
            </tbody></table>
        </div>
      )}
      <p className="note">Закон за донации и спонзорства во јавните дејности: за секоја донација / спонзорство – писмен договор, а примателот издава потврда за примена донација. Донаторот ги признава донациите до 5% и спонзорствата до 3% од вкупниот приход (ЗДД чл. 9); вишокот е непризнат расход. Донацијата е без противуслуга; кај спонзорството примателот го промовира спонзорот.</p>
    </>
  );
}
