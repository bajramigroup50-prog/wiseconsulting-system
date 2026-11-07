/**
 * Материјално › Излез › „🚛 Излез – транспорт“ — ONLY for transport firms (module „Превоз за трети лица“): the client's
 * own documents in one place — its transport invoices (read from PDF / photo and booked as outgoing invoices, the CMR
 * attached with the invoice) and its travel orders (read by AI → trip with the countries → per diems abroad booked
 * Д 44001 / П 2411). The same travel-order reader is also in „Дневници во странство“ (for a client who fills it himself).
 */
import Link from 'next/link';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { FR_COUNTRIES, moduleOn } from '@wise/core/industry';
import { freightTours, journals, travelReads } from '@wise/db';
import { Hd } from '@/components/hd';
import { NoFirm } from '@/components/no-firm';
import { ScanUpload } from '@/components/sales/scan-upload';
import { canDo, booksPage } from '@/lib/books';
import { db } from '@/lib/db';
import { TravelReadBox, type ReadRow } from '../frDnev/read-box';
import { TripFiles } from './trip-files';

export default async function IzlezTrPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const sp = await searchParams;
  const { u, firm, year } = await booksPage('izlezTr');
  if (!firm) return <NoFirm t="Излез – транспорт" />;
  if (!moduleOn(firm.mods, 'frt')) {
    return (
      <>
        <Hd t="🚛 Излез – транспорт" sub="само за превозници" />
        <div className="callout">Оваа страница е <b>само за фирми за превоз</b>. Вклучете го модулот „🚛 Превоз за трети лица“ кај фирмата: <Link href="/moduli">Фирми → 🧩 Модули по дејност</Link>.</div>
      </>
    );
  }
  const write = canDo(u, 'write', firm.id);
  const RD = write ? await travelReads(db(), firm.id) : [];
  const refIds = RD.map((r) => r.refId).filter((x): x is string => !!x);
  const [T, B] = await Promise.all([
    refIds.length ? db().select({ id: freightTours.id, number: freightTours.number }).from(freightTours).where(and(eq(freightTours.firmId, firm.id), inArray(freightTours.id, refIds))).orderBy(asc(freightTours.date)) : Promise.resolve([]),
    refIds.length ? db().select({ s: journals.sourceId }).from(journals).where(and(eq(journals.firmId, firm.id), eq(journals.sourceType, 'freight_perdiem'), inArray(journals.sourceId, refIds))) : Promise.resolve([]),
  ]);
  const booked = new Set(B.map((x) => x.s));
  const rows: ReadRow[] = RD.map((r) => ({
    id: r.id, status: r.status, error: r.error, at: r.createdAt.toISOString().slice(0, 16).replace('T', ' '), refId: r.refId,
    tourNo: r.refId ? T.find((t) => t.id === r.refId)?.number ?? null : null, booked: !!r.refId && booked.has(r.refId), r: (r.result ?? null) as ReadRow['r'],
  }));
  return (
    <>
      <Hd t="🚛 Излез – транспорт" sub={`${firm.name} · само за превозници – документите што ги носи клиентот`}>
        <Link className="btn" href="/izlez">Излезни фактури</Link>
        <Link className="btn" href="/frTuri">🚛 Тури</Link>
        <Link className="btn" href="/frDnev">🌍 Дневници</Link>
      </Hd>
      <div className="callout" style={{ marginBottom: 10 }}>
        За клиент превозник што <b>сам</b> ги прави фактурите, CMR и патните налози: овде ги повлекувате, програмот ги чита и ги книжи – <b>фактурите</b> како излезни фактури, <b>патните налози</b> како дневници во странство (трошок, не приход), <b>фискалните сметки</b> од патот (гориво, патарина од сите држави) како трошоци. Во „📁 Досие на патување“ фактурата, CMR, патниот налог и трошоците на едно патување се на едно место и се книжат во <b>еден налог</b>.
      </div>
      {write && (
        <div className="card">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>🧾 1. Фактури за превоз од клиентот (+ CMR)</h2>
          <ScanUpload firmId={firm.id} opts={{ kind: 'sale', batchId: null }} small autoOpen={{ back: '/izlezTr' }} batchView="/masovno"
            label={<><b>Прочитај фактури за превоз</b> — повлечете ги фактурите (PDF, JPG, PNG) тука или кликнете. Програмот ги чита купувачот, бројот, датумите и износите (меѓународен превоз 0%, домашен 18%) и ја отвора фактурата за проверка и книжење. <b>CMR</b> повлечете го заедно со фактурата – се прикачува како нејзина страница.</>} />
        </div>
      )}
      {write && <h2 style={{ fontSize: 15, margin: '14px 0 6px' }}>🚛 2. Патни налози → дневници за возачот (по држави и денови)</h2>}
      {write && <TravelReadBox firmId={firm.id} rows={rows} names={Object.fromEntries(FR_COUNTRIES.map((c) => [c[0], c[1]]))} />}
      <h2 style={{ fontSize: 15, margin: '14px 0 6px' }}>📁 3. Досие на патување – сè за едно патување на едно место, во еден налог</h2>
      <TripFiles firm={firm} year={year} open={sp.t} write={write} />
    </>
  );
}
