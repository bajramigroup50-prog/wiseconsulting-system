/**
 * 📥 Прием на документи – print: the dossier cover (stays in the folder), the receipt for the client (two copies on
 * one A4) and the spine label. Issued by the office's own firm (Фирми → „фирма на канцеларијата“, legal name),
 * „WISE CONSULTING“ only as the brand; the client's name is the big one. The QR opens the receipt in WISE.
 */
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { PRIEM_KIND_NAME, PRIEM_KINDS, priemNo, priemPeriodName, priemShort, priemSubRanges, priemTotal, type PriemItem } from '@wise/core/office/priem';
import { firms, receiptById } from '@wise/db';
import { Qr } from '@/components/qr';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { allowedFirms } from '@/lib/office';
import { viewAllowed } from '@/lib/nav';

export const metadata = { title: 'Прием на документи' };

const CSS = `
.pr{width:182mm;font-family:'Segoe UI',Arial,sans-serif;color:#1d2b27;font-size:13px}
.pr .pgx{page-break-after:always;min-height:262mm;position:relative}
.pr .pgx:last-child{page-break-after:auto}
.pr .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0C3F34;padding-bottom:8px}
.pr .iss b{font-size:16px;color:#0C3F34}.pr .iss div{font-size:10.5px;color:#556}
.pr .brand{font-size:10px;letter-spacing:2px;color:#0C3F34;font-weight:700}
.pr .ttl{font-size:10.5px;letter-spacing:3px;color:#0C3F34;font-weight:700;margin-top:18px}
.pr h1{font-size:30px;margin:4px 0 2px}.pr .ids{font-size:12px;color:#445}
.pr .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 28px;margin:18px 0}
.pr .grid span{display:block;font-size:9.5px;letter-spacing:1.5px;color:#778;text-transform:uppercase}
.pr .big{font-size:23px;font-weight:700;color:#0C3F34}
.pr table{width:100%;border-collapse:collapse;margin-top:6px}
.pr th{background:#0C3F34;color:#fff;text-align:left;padding:6px 8px;font-size:11px}
.pr td{border-bottom:1px solid #ccd;padding:7px 8px}.pr td.c{text-align:center;width:70px}
.pr .box{display:inline-block;width:13px;height:13px;border:1.5px solid #333;vertical-align:middle;margin-right:7px}
.pr .box.x{background:#0C3F34}
.pr .keep{margin-top:14px;padding:9px 11px;background:#EEF5F1;border-left:4px solid #0C3F34;font-size:12px}
.pr .sig{display:flex;justify-content:space-between;margin-top:40px;font-size:12px}.pr .sig div{width:44%;border-top:1px solid #333;padding-top:5px;text-align:center}
.pr .foot{position:absolute;bottom:0;left:0;right:0;font-size:9.5px;color:#889;border-top:1px solid #dde;padding-top:5px;display:flex;justify-content:space-between}
.pr .half{border:1px dashed #99a;padding:12px 14px;min-height:124mm}
.pr .half h2{margin:8px 0 2px;font-size:16px}
.pr .cut{text-align:center;font-size:10px;color:#889;margin:5px 0}
.pr .spine{width:38mm;height:190mm;border:1.5px solid #0C3F34;display:flex;flex-direction:column;align-items:center;padding:6mm 2mm;text-align:center;float:left;margin-right:8mm}
.pr .spine.w{width:58mm}
.pr .spine .v{writing-mode:vertical-rl;transform:rotate(180deg);font-size:18px;font-weight:700;margin:6mm 0;color:#0C3F34;max-height:120mm;overflow:hidden;line-height:1.15}
.pr .spine.w .v{font-size:22px}
.pr .spine .s{font-size:11px;font-weight:700}
.pr .note{font-size:11px;color:#556}
`;

type Office = { name: string; edb: string | null; address: string | null };
type R = NonNullable<Awaited<ReturnType<typeof receiptById>>>;

const dt = (d: Date | null) => (d ? d.toLocaleString('mk-MK', { timeZone: 'Europe/Skopje', dateStyle: 'short', timeStyle: 'short' }) : '');
const label = (i: PriemItem) => (i.k === 'other' && i.text ? i.text : PRIEM_KIND_NAME[i.k]);
const cnt = (i: PriemItem) => `${i.n}${i.pack ? ' пак.' : ''}`;

function Issuer({ o }: { o: Office }) {
  return <div className="iss"><b>{o.name}</b><div>{[o.edb && `ЕДБ ${o.edb}`, o.address].filter(Boolean).join(' · ')}</div><div className="brand">WISE CONSULTING · сметководствена канцеларија</div></div>;
}

async function Cover({ r, o, url }: { r: R; o: Office; url: string }) {
  const sub = new Map(priemSubRanges(r.items).map((s) => [s.k, s]));
  const has = new Map(r.items.map((i) => [i.k, i]));
  const no = priemShort(r.no);
  return (
    <div className="pgx">
      <div className="top"><Issuer o={o} /><Qr text={url} size="24mm" /></div>
      <div className="ttl">ДОСИЕ НА ДОКУМЕНТИ</div>
      <h1>{r.firmName}</h1>
      <div className="ids">{[r.edb && `ЕДБ ${r.edb}`, r.embs && `ЕМБС ${r.embs}`, r.address].filter(Boolean).join(' · ')}</div>
      <div className="grid">
        <div><span>Период</span><div className="big">{priemPeriodName(r.period)}</div></div>
        <div><span>Архивски број</span><div className="big">{no}</div></div>
        <div><span>Примено</span>{dt(r.receivedAt)}</div>
        <div><span>Деловодник</span>01 · Примени документи · {r.year}</div>
        <div><span>Донесе</span>{r.broughtBy || '—'}</div>
        <div><span>Прими</span>{r.receivedByName || '—'}</div>
      </div>
      <table><thead><tr><th>Содржина</th><th style={{ textAlign: 'center' }}>Број</th><th style={{ textAlign: 'center' }}>✔ Книжено</th><th>Арх. подброеви</th></tr></thead><tbody>
        {PRIEM_KINDS.map(([k]) => {
          const i = has.get(k), s = sub.get(k);
          return <tr key={k}><td><span className={`box ${i ? 'x' : ''}`} />{i ? label(i) : k === 'other' ? 'Друго: ____________________' : PRIEM_KIND_NAME[k]}</td>
            <td className="c">{i ? cnt(i) : ''}</td><td className="c"><span className="box" /></td>
            <td>{s ? (s.from === s.to ? `${no}/${s.from}` : `${no}/${s.from} – /${s.to}`) : ''}</td></tr>;
        })}
      </tbody></table>
      {r.note && <p className="note">Забелешка: {r.note}</p>}
      <div className="keep"><b>Се чува до: {dmy(r.keepUntil)}</b> · Оригиналите се враќаат на клиентот до: {r.returnDue ? dmy(r.returnDue) : '____________'}</div>
      <div className="sig"><div>Предал ({r.firmName})</div><div>Примил ({o.name})</div></div>
      <div className="foot"><span>{priemNo(r.no, r.year)} · {r.firmName} · {priemPeriodName(r.period).toLowerCase()}</span><span>Скенирај го QR-кодот → приемот во WISE</span></div>
    </div>
  );
}

function Half({ r, o, who }: { r: R; o: Office; who: string }) {
  return (
    <div className="half">
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><Issuer o={o} /><div className="note"><b>{who}</b></div></div>
      <h2>ПОТВРДА ЗА ПРИЕМ НА ДОКУМЕНТИ бр. {priemNo(r.no, r.year)}</h2>
      <div className="note">од {dt(r.receivedAt)}</div>
      <p style={{ margin: '10px 0 4px' }}><b>{o.name}</b> потврдува дека од <b>{r.firmName}</b>{r.edb ? ` (ЕДБ ${r.edb})` : ''} прими документи за период <b>{priemPeriodName(r.period).toLowerCase()}</b>:</p>
      <table><tbody>
        {r.items.map((i) => <tr key={i.k}><td>{label(i)}</td><td className="c">{cnt(i)}</td></tr>)}
        <tr><td><b>Вкупно</b></td><td className="c"><b>{priemTotal(r.items)}</b></td></tr>
      </tbody></table>
      <p className="note" style={{ marginTop: 6 }}>Документите се чуваат во досие {priemShort(r.no)}. При барање наведете го овој број.{r.returnDue ? ` Оригиналите се враќаат до ${dmy(r.returnDue)}.` : ''}</p>
      <div className="sig" style={{ marginTop: 20 }}><div>Предал: {r.broughtBy || ''}</div><div>Примил: {r.receivedByName || ''}</div></div>
    </div>
  );
}

/** Spine label for the binder's label pocket: 4 × 19 cm (5 cm binders), `wide` 6 × 19 cm (8 cm binders). */
function Spine({ r, wide }: { r: R; wide: boolean }) {
  return (
    <div className="pgx">
      <div className={`spine ${wide ? 'w' : ''}`}><div className="s">{priemShort(r.no)}</div><div className="v">{r.firmName}</div><div className="s">{r.period.slice(5)}/{r.period.slice(0, 4)}</div><div className="note" style={{ marginTop: 'auto', fontSize: 9 }}>до {dmy(r.keepUntil)}</div></div>
      <p className="note" style={{ clear: 'both', paddingTop: '4mm' }}>Етикета за 'рбетот ({wide ? '6' : '4'} × 19 cm) – се сече по рабовите.</p>
    </div>
  );
}

export default async function PrintPriem({ searchParams }: { searchParams: Promise<{ id?: string; p?: string }> }) {
  const u = await requireUser();
  if (!viewAllowed(u.role, 'priem')) notFound();
  const sp = await searchParams;
  if (!sp.id || !/^[0-9a-f-]{36}$/i.test(sp.id)) notFound();
  const r = await receiptById(db(), sp.id);
  if (!r || !(await allowedFirms(u, { year: 'all' })).some((f) => f.id === r.firmId)) notFound();
  const all = await db().select({ name: firms.name, edb: firms.edb, address: firms.address, settings: firms.settings }).from(firms).where(eq(firms.active, true));
  const of = all.find((f) => (f.settings as { officeFirm?: boolean } | null)?.officeFirm);
  const o: Office = of ? { name: of.name, edb: of.edb, address: of.address } : { name: 'WISE CONSULTING', edb: null, address: null };
  const url = `https://app.wiseconsulting.com.mk/priem?id=${r.id}&all=1`;
  const p = sp.p ?? 'site';
  return (
    <div className="pdfdoc pr">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {(p === 'site' || p === 'dosje') && <Cover r={r} o={o} url={url} />}
      {(p === 'site' || p === 'potvrda') && (
        <div className="pgx"><Half r={r} o={o} who="ПРИМЕРОК ЗА КЛИЕНТОТ" /><div className="cut">✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - ✂</div><Half r={r} o={o} who="ПРИМЕРОК ЗА КАНЦЕЛАРИЈАТА" /></div>
      )}
      {(p === 'site' || p === 'etiketa' || p === 'etiketa6') && <Spine r={r} wide={p === 'etiketa6'} />}
    </div>
  );
}
