'use server';
/** ✈️ Службени патувања: save / delete / post / unpost a патен налог and the codebook (office + firm). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { BT_STATUS, type BtCost, type BtStatus, type BtVehicle, type BusinessTrip } from '@wise/core/btrip';
import { BTRIP_SETTINGS_KEY, BtripError, btripFirmKey, btripSettings, deleteBtrip, postBtrip, saveBtrip, saveBtripSettings, unpostBtrip } from '@wise/db';
import type { FreightSegment } from '@wise/core/industry';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fxLookup } from '@/lib/fuel';

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const n = (v: unknown) => { const x = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const err = (e: unknown): ActionState => (e instanceof BtripError ? { error: e.message } : actionError(e));
const json = <T,>(f: FormData, k: string): T[] => { try { const v = JSON.parse(s(f, k) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const VEH: BtVehicle[] = ['own', 'company', 'public', 'none'];

export async function saveBtripAction(_p: ActionState, f: FormData): Promise<ActionState> {
  let id = s(f, 'id');
  try {
    const { u, firm } = await firmAction('btSave');
    const segs = json<FreightSegment>(f, 'segs').filter((g) => g && typeof g.c === 'string' && g.c).map((g) => ({ c: String(g.c).slice(0, 6), in: String(g.in ?? '').slice(0, 16), out: String(g.out ?? '').slice(0, 16), ...(g.units != null && String(g.units) !== '' ? { units: n(g.units) } : {}) }));
    const costs = json<BtCost>(f, 'costs').filter((c) => c && n(c.amt)).map((c) => ({ k: (['transport', 'lodging', 'other'] as const).includes(c.k) ? c.k : 'other', d: String(c.d ?? '').slice(0, 120), amt: n(c.amt), cur: /^[A-Z]{3}$/.test(String(c.cur)) ? String(c.cur) : 'MKD' }));
    const st = s(f, 'status') as BtStatus;
    const t: BusinessTrip = {
      number: s(f, 'number'), date: s(f, 'date'), employeeId: s(f, 'employeeId'), abroad: s(f, 'abroad') === '1', dest: s(f, 'dest'), country: s(f, 'country'),
      purpose: s(f, 'purpose'), vehicle: VEH.includes(s(f, 'vehicle') as BtVehicle) ? s(f, 'vehicle') as BtVehicle : 'none', plate: s(f, 'plate'), km: n(f.get('km')) || null,
      dep: s(f, 'dep'), ret: s(f, 'ret'), segs, red: s(f, 'red') === '' ? 100 : Math.min(100, Math.max(0, n(f.get('red')))), costs,
      advance: n(f.get('advance')) || null, advCur: /^[A-Z]{3}$/.test(s(f, 'advCur')) ? s(f, 'advCur') : 'MKD', advDate: s(f, 'advDate') || null,
      status: st in BT_STATUS && st !== 'done' ? st : 'open', approver: s(f, 'approver'), report: s(f, 'report').slice(0, 2000), note: s(f, 'note').slice(0, 1000),
    };
    if (!t.abroad) { t.country = ''; t.segs = []; }
    id = await db().transaction((tx) => saveBtrip(tx, { firmId: firm.id, userId: u.id }, id || null, t));
  } catch (e) { return err(e); }
  revalidatePath('/patNal');
  redirect(`/patNal?id=${id}`);
}

export async function deleteBtripAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('del');
    await db().transaction((tx) => deleteBtrip(tx, { firmId: firm.id, userId: u.id }, id));
  } catch (e) { return err(e); }
  revalidatePath('/patNal');
  return { ok: 'Налогот е избришан.' };
}

export async function postBtripAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('btPost');
    const fx = await fxLookup(firm.id);
    const r = await db().transaction((tx) => postBtrip(tx, { firmId: firm.id, userId: u.id }, id, fx));
    revalidatePath('/patNal');
    return { ok: `Книжено во налог ${r.number}.` };
  } catch (e) { return err(e); }
}

export async function unpostBtripAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('btPost');
    await db().transaction((tx) => unpostBtrip(tx, { firmId: firm.id, userId: u.id }, id));
    revalidatePath('/patNal');
    return { ok: 'Книжењето е избришано; налогот е повторно отворен.' };
  } catch (e) { return err(e); }
}

/** Codebook: `scope=office` (all firms) or `firm` (this firm only; empty = office value). */
export async function saveBtripSettingsAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('btCfg');
    const office = s(f, 'scope') !== 'firm';
    const rates: Record<string, [number, string]> = {};
    for (const [k, v] of f.entries()) {
      if (!k.startsWith('rate.')) continue;
      const c = k.slice(5), a = n(v);
      if (!/^[A-Z]{2,4}$/.test(c) || !a) continue;
      if (a < 0 || a >= 1000) return { error: `Износот за ${c} мора да е меѓу 0 и 1000.` };
      rates[c] = [a, /^[A-Z]{3}$/.test(s(f, `cur.${c}`)) ? s(f, `cur.${c}`) : 'EUR'];
    }
    const v = { domAmt: n(f.get('domAmt')) || undefined, carPct: s(f, 'carPct') === '' ? undefined : n(f.get('carPct')), fuelPrice: n(f.get('fuelPrice')) || undefined, ...(office ? { rates } : {}) };
    if (v.carPct != null && (v.carPct < 0 || v.carPct > 100)) return { error: 'Процентот за сопствено возило мора да е 0–100.' };
    await db().transaction(async (tx) => {
      const cur = await btripSettings(tx, firm.id);
      const base = office ? cur.office : cur.firm;
      await saveBtripSettings(tx, u.id, office ? BTRIP_SETTINGS_KEY : btripFirmKey(firm.id), office ? { ...base, ...v } : { domAmt: v.domAmt, carPct: v.carPct, fuelPrice: v.fuelPrice });
    });
  } catch (e) { return err(e); }
  revalidatePath('/patNal');
  return { ok: 'Шифрарникот е зачуван.' };
}
