'use server';
/**
 * Legacy travel-order ACT (9337, 9417) and freight ACT (14498–14697). FIX LEGACY-MAP 10.4 item 1: every save goes to
 * `travel_orders` (legacy `pnSave` was the payroll-notes function and nothing persisted).
 */
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { can, fxRate } from '@wise/core';
import { mailableStops, newTravelOrderDefaults, podHtml, podMailText, transportConfig, travelLoad, vehicleOdo, type TravelStop } from '@wise/core/industry';
import { PDFDOC_CSS } from '@wise/core/print-css';
import {
  deleteDoc, deleteFreightTour, deleteTravelOrder, firms, industryConfigOf, invoiceFreightTours, loadFxSources, postTravelCash, saveDoc, saveFreightTour,
  saveIndustryConfig, saveTravelOrder, stopsFrom, travelOrderEvent, travelOrders, travelReturnCredit, unassignedDocs, type FreightDoc,
} from '@wise/db';
import {
  editedTravelStops, employees, files, fleetVehicles, IndustryError, lastTravelOrder, markStopsMailed, partners, saveTravelLoading, stopsOf, textMailHtml, travelItemInfo,
} from '@wise/db';
import { dispatchMail, queueMail, validAddresses } from '@/lib/mail';
import { renderPdf } from '@/lib/jobs';
import { dataUri } from '@/lib/print-pdf';
import { getObjectBytes } from '@/lib/storage';
import { requireUser } from '@/lib/auth';
import { storeImageDataUrl } from '@/lib/data-url-file';
import { bankError } from '@/lib/bank';
import { db } from '@/lib/db';
import { indRun, num, nz, rows, str, today } from '@/lib/industry';
import type { FormState } from '@/components/bank-form';

const P = ['/pnalozi', '/pnGorivo', '/mojpn', '/blagajna', '/odobrenija', '/frTuri', '/frDnev', '/frDok', '/izlez'];

const refOf = (v: string): { type: 'invoice' | 'dispatch' | 'purchase'; id: string } | null => {
  const [t, id] = v.split(':');
  return (t === 'invoice' || t === 'dispatch' || t === 'purchase') && id && /^[0-9a-f-]{36}$/i.test(id) ? { type: t, id } : null;
};

/**
 * Legacy `pnSaveB` (FIX item 1: it now really persists). The stops are the stored ones with the editor's changes
 * (✕ remove, ☑ loaded, „+ Додај фактура…“, „+ Рачно застанување“); a load over the vehicle's capacity needs the
 * confirmation „Сепак зачувај“ (legacy `askConfirm`).
 */
export async function saveTravelOrderAction(_p: FormState, f: FormData): Promise<FormState> {
  let id = '';
  const r = await indRun('pnSaveB', P, async ({ tx, a }) => {
    const mp = str(f.get('mPartner'));
    const stops = await editedTravelStops(tx, a.firmId, str(f.get('id')) || null, {
      rm: f.getAll('rm').map(Number).filter(Number.isInteger),
      loaded: f.get('ldf') ? new Set(f.getAll('ld').map(String)) : undefined,
      add: f.getAll('add').map((v) => refOf(String(v))).filter((x): x is NonNullable<typeof x> => !!x),
      manual: mp ? { kind: str(f.get('mKind')) === 'deliv' ? 'deliv' : 'pick', partner: mp, addr: str(f.get('mAddr')), goods: str(f.get('mGoods')) } : null,
    });
    const vid = str(f.get('veh')) || null;
    if (vid && f.get('overOk') !== 'on') {
      const [v] = await tx.select({ capKg: fleetVehicles.capKg }).from(fleetVehicles).where(and(eq(fleetVehicles.id, vid), eq(fleetVehicles.firmId, a.firmId))).limit(1);
      const info = await travelItemInfo(tx, a.firmId, stops.flatMap((s) => s.goods.map((g) => g.itemId)));
      const ld = travelLoad(stops, (g) => ((g.itemId ? info.get(g.itemId)?.kg : 0) || Number(g.kg) || 0) * (Number(g.qty) || 0));
      if (v?.capKg && ld.peak > v.capKg) throw new IndustryError(`Товарот (${ld.peak} кг) ја надминува носивоста (${v.capKg} кг). Сепак да се зачува? – штиклирајте „Сепак зачувај (товар над носивоста)“ и зачувајте повторно.`);
    }
    const x = await saveTravelOrder(tx, a, {
      id: str(f.get('id')) || null, date: str(f.get('date')), number: str(f.get('number')), vehicleId: vid, driverId: str(f.get('drv')) || null,
      codriver: str(f.get('codriver')), from: str(f.get('from')), purpose: str(f.get('purpose')), stops, depKm: num(f.get('depKm')), retKm: num(f.get('retKm')),
      fuelL: num(f.get('fuelL')), fuelAmt: num(f.get('fuelAmt')), assigneeId: str(f.get('assignee')) || null, dnev: f.get('dnev') === 'on',
    });
    id = x.id;
    return `Патниот налог ${x.number} е зачуван.`;
  });
  if (r.error || str(f.get('id'))) return r;
  redirect(`/pnalozi?id=${id}`);
}

/** Legacy `pnFromDay`: a new order with every unassigned document of the day as a stop (defaults as `pnNew`). */
export async function travelOrderFromDayAction(_p: FormState, f: FormData): Promise<FormState> {
  let id = '';
  const r = await indRun('pnFromDay', P, async ({ tx, a, firm }) => {
    const date = str(f.get('date')) || today();
    const cfg = transportConfig(industryConfigOf(firm, 'transport'));
    const U = await unassignedDocs(tx, a.firmId, date);
    if (!U.length) return 'Нема документи без патен налог.';
    const V = await tx.select({ id: fleetVehicles.id, odo: fleetVehicles.odo }).from(fleetVehicles).where(and(eq(fleetVehicles.firmId, a.firmId), eq(fleetVehicles.active, true), eq(fleetVehicles.trailer, false))).orderBy(asc(fleetVehicles.plate));
    const Dr = await tx.select({ id: employees.id }).from(employees).where(eq(employees.firmId, a.firmId));
    const last = await lastTravelOrder(tx, a.firmId);
    const O = await tx.select({ vehicleId: travelOrders.vehicleId, depKm: travelOrders.depKm, retKm: travelOrders.retKm }).from(travelOrders).where(eq(travelOrders.firmId, a.firmId));
    const d = newTravelOrderDefaults({ cfg, last, vehicles: V, drivers: Dr, odoOf: (vid) => vehicleOdo(vid, O, V.find((v) => v.id === vid)?.odo) });
    const x = await saveTravelOrder(tx, a, {
      date, vehicleId: str(f.get('veh')) || d.vehicleId || null, driverId: str(f.get('drv')) || d.driverId || null, from: cfg.from || [firm.address, firm.city].filter(Boolean).join(', '),
      purpose: 'Превоз на стока (преземање и испорака)', depKm: d.depKm,
      stops: await stopsFrom(tx, a.firmId, U.map((u) => ({ type: u.type, id: u.id }))), assigneeId: d.assigneeId || null, dnev: d.dnev,
    });
    id = x.id;
    return `Креиран е патен налог ${x.number}.`;
  });
  if (r.error || !id) return r;
  redirect(`/pnalozi?id=${id}`);
}

export async function travelOrderStepAction(id: string, step: 'cash' | 'del' | `ret${number}`): Promise<FormState> {
  return indRun(step === 'cash' ? 'pnCashPost' : step === 'del' ? 'pnlDel' : 'pnRetCr', P, async ({ tx, a, u, firm }) => {
    if (step === 'cash') return `Прокнижени ${await postTravelCash(tx, a, id)} уплатници во благајна.`;
    if (step === 'del') { await deleteTravelOrder(tx, a, id, can(u.principal, 'del', firm.id)); return 'Избришано.'; }
    return `Креирана е повратница ${await travelReturnCredit(tx, a, id, Number(step.slice(3)), today())} – стоката е вратена на залиха.`;
  });
}

/**
 * Legacy `pnMail`: „Испорачано“ notice with the delivery confirmation PDF (signature, time, GPS) to the buyer of one
 * stop or of every delivered, not yet notified stop (`all`). The PDF is rendered by the worker (`pdf.render`); the
 * message is sent as soon as the PDF is stored (else by the `mail.flush` sweep a few minutes later).
 */
export async function travelMailAction(id: string, which: number | 'all'): Promise<FormState> {
  const mails: { mailId: string; fileId: string }[] = [];
  const r = await indRun('pnMail', P, async ({ tx, a, u, firm }) => {
    const [x] = await tx.select().from(travelOrders).where(and(eq(travelOrders.id, id), eq(travelOrders.firmId, firm.id))).limit(1);
    if (!x) throw new IndustryError('Патниот налог не постои.');
    const S = stopsOf(x);
    const pids = [...new Set(S.map((s) => s.partnerId).filter((p): p is string => !!p))];
    const PE = pids.length ? await tx.select({ id: partners.id, email: partners.email }).from(partners).where(and(eq(partners.firmId, firm.id), inArray(partners.id, pids))) : [];
    const emailOf = (s: TravelStop) => s.email || PE.find((p) => p.id === s.partnerId)?.email || '';
    const idx = which === 'all' ? mailableStops(S, emailOf) : [which];
    const J = idx.filter((i) => S[i]).map((i) => ({ i, s: S[i]!, to: emailOf(S[i]!) })).filter((j) => j.s.status === 'done' && j.s.kind !== 'pick');
    const ok = J.filter((j) => validAddresses(j.to));
    if (!ok.length) throw new IndustryError('Купувачот нема е-пошта во „Комитенти“.');
    const fids = [...new Set(ok.flatMap((j) => [j.s.sig, j.s.photo]).filter((v): v is string => !!v))];
    const F = fids.length ? await tx.select().from(files).where(and(eq(files.firmId, firm.id), inArray(files.id, fids))) : [];
    const img = new Map<string, string>();
    for (const fl of F) if (fl.mime.startsWith('image/')) img.set(fl.id, dataUri(fl.mime, await getObjectBytes(fl.bucketKey).catch(() => new Uint8Array())));
    for (const j of ok) {
      const html = `<div class="pdfdoc">${podHtml({ firm: { name: firm.name, edb: firm.edb, address: firm.address }, order: { number: x.number, plate: x.plate, driver: x.driver }, stop: j.s, img: (fid) => img.get(fid) ?? '' })}</div>`;
      const fileId = await renderPdf({ html, css: PDFDOC_CSS, title: `Potvrda_isporaka_${j.s.doc}`, firmId: firm.id, userId: u.id });
      const t = podMailText({ firm: { name: firm.name, phone: (firm as { phone?: string | null }).phone ?? null }, stop: j.s });
      const mailId = await queueMail(tx, { firmId: firm.id, to: j.to, subject: t.subject, html: textMailHtml(t.body), attachments: [fileId], entityType: 'travel_order', entityId: x.id, userId: u.id });
      mails.push({ mailId, fileId });
    }
    await markStopsMailed(tx, a, x.id, ok.map((j) => j.i), new Date().toISOString());
    const bad = J.length - ok.length;
    return `Испратени ${ok.length} известувања.${bad ? ` ${bad} без е-пошта.` : ''}`;
  });
  if (!r.error && mails.length) {
    // the PDF must be stored before `mail.send` reads the attachment; wait up to ~15 s, else `mail.flush` sends later
    for (let t = 0; t < 30; t++) {
      const R = await db().select({ id: files.id }).from(files).where(and(inArray(files.id, mails.map((m) => m.fileId)), eq(files.status, 'ready')));
      if (R.length === mails.length) { await dispatchMail(mails.map((m) => m.mailId)); break; }
      await new Promise((ok) => setTimeout(ok, 500));
    }
  }
  return r;
}

/**
 * Departure / delivery / return — from the office (`write`) or by the assigned field user (`mojpn`, role `teren`).
 * The firm comes from the order; the user must be its assignee or have `write` on that firm.
 */
export async function travelEventAction(_p: FormState, f: FormData): Promise<FormState> {
  try {
    const u = await requireUser();
    const id = str(f.get('id'));
    const [o] = await db().select({ firmId: travelOrders.firmId, assigneeId: travelOrders.assigneeId }).from(travelOrders).where(eq(travelOrders.id, id)).limit(1);
    if (!o) return { error: 'Патниот налог не постои.' };
    if (o.assigneeId !== u.id && !can(u.principal, 'write', o.firmId)) return { error: 'Немате дозвола за овој налог.' };
    const [fm] = await db().select().from(firms).where(and(eq(firms.id, o.firmId))).limit(1);
    if (!fm?.mods.includes('pn')) return { error: 'Модулот за патни налози не е вклучен за фирмата.' };
    const k = str(f.get('k'));
    const geo = num(f.get('lat')) != null && num(f.get('lon')) != null ? { lat: num(f.get('lat'))!, lon: num(f.get('lon'))!, acc: num(f.get('acc')) } : null;
    const at = new Date().toISOString();
    await db().transaction(async (tx) => {
      // Driver flow (legacy `pnDeliv`): signature and photo are stored as files and referenced from the stop.
      const sig = k === 'deliv' ? await storeImageDataUrl(tx, { firmId: o.firmId, userId: u.id, dataUrl: str(f.get('sig')), name: `potpis-${id.slice(0, 8)}-${f.get('i')}` }) : null;
      const photo = k === 'deliv' ? await storeImageDataUrl(tx, { firmId: o.firmId, userId: u.id, dataUrl: str(f.get('photo')), name: `isporaka-${id.slice(0, 8)}-${f.get('i')}` }) : null;
      await travelOrderEvent(tx, { firmId: o.firmId, userId: u.id, role: u.role }, id,
        k === 'dep' ? { k: 'dep', km: num(f.get('km')) }
          : k === 'deliv' ? { k: 'deliv', i: Number(f.get('i')), recv: str(f.get('recv')), cash: num(f.get('cash')) ?? 0, ret: rows(f, 'r', ['k', 'qty'], (r) => nz(r.qty) > 0).map((r) => ({ k: Number(r.k), qty: nz(r.qty) })), sig, photo }
            : { k: 'ret', km: num(f.get('km')), fuelL: num(f.get('fuelL')), fuelAmt: num(f.get('fuelAmt')) }, at, u.name, geo);
    });
  } catch (e) { return bankError(e); }
  for (const p of P) revalidatePath(p);
  return { ok: 'Забележано.' };
}

/** Legacy `pnScanCode` / `pnScanFull` auto-save from the phone (assignee) or the office (`write`). */
export async function saveTravelScanAction(id: string, L: { i: number; k: number; lq: number }[]): Promise<{ ok?: number; error?: string }> {
  try {
    const u = await requireUser();
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) return { error: 'Патниот налог не постои.' };
    const R = (Array.isArray(L) ? L : []).slice(0, 2000).map((r) => ({ i: Number(r?.i), k: Number(r?.k), lq: Number(r?.lq) })).filter((r) => Number.isInteger(r.i) && Number.isInteger(r.k) && Number.isFinite(r.lq));
    const k = await db().transaction((tx) => saveTravelLoading(tx, u, id, R, (firmId) => can(u.principal, 'write', firmId)));
    revalidatePath('/pnalozi');
    return { ok: k };
  } catch (e) {
    return { error: e instanceof IndustryError ? e.message : 'Грешка при зачувување.' };
  }
}

/** Legacy `pnDefsSave` (ACT_NEED `settings`). */
export async function saveTransportConfigAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('settings', P, async ({ tx, a }) => {
    await saveIndustryConfig(tx, a, 'transport', { vehicleId: str(f.get('veh')), driverId: str(f.get('drv')), assignee: str(f.get('assignee')), from: str(f.get('from')), dnevAmt: num(f.get('dnevAmt')) ?? '', dnevOn: f.get('dnevOn') === 'on' });
    return 'Зачувано.';
  });
}

/* ---------------- freight ---------------- */

export async function saveFreightAction(_p: FormState, f: FormData): Promise<FormState> {
  const r = await indRun('frSave', P, async ({ tx, a }) => {
    const s = (k: string) => str(f.get(k)) || null;
    await saveFreightTour(tx, a, {
      id: str(f.get('id')) || null, number: str(f.get('number')), date: str(f.get('date')), status: (str(f.get('status')) || 'plan') as 'plan', partnerId: s('partner'), orderNo: s('orderNo'),
      km: num(f.get('km')), vehicleId: s('veh'), trailer: s('trailer'), driverId: s('drv'), driver2Id: s('drv2'), loadPlace: s('loadPlace'), loadC: s('loadC'), sender: s('sender'),
      unloadDate: s('unloadDate'), unloadPlace: s('unloadPlace'), unloadC: s('unloadC'), consignee: s('consignee'), retDate: s('retDate'), goods: s('goods'), packages: s('packages'),
      kg: num(f.get('kg')), m3: num(f.get('m3')), adr: s('adr'), docsAtt: s('docsAtt'), price: num(f.get('price')), cur: str(f.get('cur')) || 'EUR', fx: num(f.get('fx')),
      vat: str(f.get('vat')) === 'dom' ? 'dom' : 'intl', red: num(f.get('red')) ?? 100, tolls: num(f.get('tolls')), tollCur: s('tollCur'), otherCost: num(f.get('otherCost')), note: s('note'),
      segs: rows(f, 'g', ['c', 'in', 'out', 'units'], (g) => !!g.c).map((g) => ({ c: g.c, in: g.in, out: g.out, units: g.units === '' ? null : nz(g.units) })),
    });
    return 'Турата е зачувана.';
  });
  if (r.error) return r;
  redirect('/frTuri');
}

export async function deleteFreightAction(id: string): Promise<FormState> {
  return indRun('del', P, async ({ tx, a }) => { await deleteFreightTour(tx, a, id); return 'Избришано.'; });
}

export async function invoiceFreightAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('frInv', P, async ({ tx, a }) => {
    const fx = await loadFxSources(tx, a.firmId);
    const inv = await invoiceFreightTours(tx, a, f.getAll('sel').map(String), today(), async (c, d) => fxRate(c, d, fx));
    return `Издадена е фактура ${inv.number}.`;
  });
}

export async function saveFreightDocAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('frDocSave', P, async ({ tx, a }) => {
    const who = str(f.get('who')) === 'drv' ? 'drv' : 'veh';
    if (!str(f.get('ref'))) return 'Изберете возило / возач.';
    await saveDoc<FreightDoc>(tx, a, 'frdoc', { id: str(f.get('id')) || null, date: str(f.get('validTo')) || null, data: { who, ref: str(f.get('ref')), kind: str(f.get('kind')), no: str(f.get('no')), validFrom: str(f.get('validFrom')) || null, validTo: str(f.get('validTo')) || null, note: str(f.get('note')) } });
    return 'Документот е зачуван.';
  });
}
export async function deleteFreightDocAction(id: string): Promise<FormState> {
  return indRun('del', P, async ({ tx, a }) => { await deleteDoc(tx, a, 'frdoc', id); return 'Избришано.'; });
}

export async function saveFreightRatesAction(_p: FormState, f: FormData): Promise<FormState> {
  return indRun('frCfgSave', P, async ({ tx, a }) => {
    const rates: Record<string, [number, string]> = {};
    for (const [k, v] of f.entries()) if (k.startsWith('rate.') && nz(String(v)) > 0) rates[k.slice(5)] = [nz(String(v)), str(f.get('cur.' + k.slice(5))) || 'EUR'];
    await saveIndustryConfig(tx, a, 'frt', { rates });
    return 'Износите се зачувани.';
  });
}
