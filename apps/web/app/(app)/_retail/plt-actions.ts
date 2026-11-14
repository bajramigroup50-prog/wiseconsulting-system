'use server';
/**
 * „📄 ПЛТ на клиентот“ (Малопродажба → Влезни калкулации): a client who keeps its own приемен лист (ПЛТ) brings the
 * supplier's invoice and its ПЛТ – the office only registers them. Per VAT rate: the purchase value without VAT and
 * the input VAT (from the invoice) and the retail value with VAT (from the client's ПЛТ). Saved as a store
 * calculation with one line per rate („Стока по ПЛТ 18%“, qty 1, price = purchase value, МПЦ = the ПЛТ's value), so
 * the usual posting applies: stock at retail value (6630), price difference (6694), VAT in stock (6640), ЕТ.
 */
import { revalidatePath } from 'next/cache';
import { stockAccount } from '@wise/core';
import { loadStockContext, savePurchase, type PurchaseStockInput } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { actorOf } from '@/lib/sales';

const RATES = [18, 10, 5, 0] as const;
const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return 0;
  // 1.234,56 / 1,234.56 / 1234.56
  const t = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const x = Number(t);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : NaN;
};

export async function savePltAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    const wh = String(f.get('wh') ?? '');
    const date = String(f.get('date') ?? '');
    const number = String(f.get('number') ?? '').trim();
    const partnerId = String(f.get('partnerId') ?? '') || null;
    const supplierName = String(f.get('supplierName') ?? '').trim() || null;
    if (!wh) return { error: 'Изберете продавница.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Внесете датум.' };
    if (!number) return { error: 'Внесете број на фактурата.' };
    if (!partnerId && !supplierName) return { error: 'Изберете добавувач.' };
    const groups: { account: string; rate: number; base: number; vat: number }[] = [];
    const stock: PurchaseStockInput[] = [];
    for (const r of RATES) {
      const base = num(f.get(`b${r}`)), vat = num(f.get(`v${r}`)), sp = num(f.get(`s${r}`));
      if ([base, vat, sp].some((x) => Number.isNaN(x))) return { error: `Неправилен износ кај ${r}%.` };
      if (!base && !vat && !sp) continue;
      if (!base) return { error: `${r}%: внесете набавна вредност од фактурата.` };
      if (!sp) return { error: `${r}%: внесете продажна вредност со ДДВ од приемниот лист (ПЛТ).` };
      groups.push({ account: '§', rate: r, base, vat: firm.vatRegistered ? vat : 0 });
      stock.push({ name: `Стока по ПЛТ ${r}%`, code: `PLT${r}`, unit: 'ден', qty: 1, price: base, sp, rate: r, type: 'goods' });
    }
    if (!stock.length) return { error: 'Внесете ги износите барем за една даночна стапка.' };
    const due = String(f.get('due') ?? '');
    const r = await db().transaction(async (tx) => {
      // the store's stock konto (its own konto in the store codebook, else the scheme's) – as a normal store calculation
      const L0 = await loadStockContext(tx, firm.id);
      const acc = stockAccount(L0.ctx, wh, { type: 'goods' });
      for (const g of groups) g.account = acc;
      return savePurchase(tx, firm.id, {
      number, date, due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null, partnerId, supplierName,
      supplierEdb: String(f.get('supplierEdb') ?? '').trim() || null,
      ptype: 'stock', warehouseId: wh, groups, stock, costs: {},
      data: { plt: true, pltNo: String(f.get('pltNo') ?? '').trim() || undefined } as never,
    }, actorOf(u));
    });
    for (const p of ['/kalkM', '/vlez', '/m_lager', '/nalozi']) revalidatePath(p);
    const pltNo = String(f.get('pltNo') ?? '').trim();
    return { ok: `Зачувано и прокнижано: фактура ${number}${pltNo ? ' по ПЛТ бр. ' + pltNo : ' по ПЛТ'}${r.warnings?.length ? ' · ' + r.warnings.join('; ') : ''}.` };
  } catch (e) { return actionError(e); }
}
