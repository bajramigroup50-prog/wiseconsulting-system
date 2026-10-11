'use server';
/**
 * Server actions of the stock, materials & retail screens (zaliha, porachki, nabavki, dopolnuvanje, mrp, lojalnost,
 * m_akcii, lotovi, rasNorm, prodCost, artNames, artQ, artKonta, barkodi, uvoz). Every action goes through
 * `stockAction` → `firmAction` → `requireCan(<legacy action>, firm)` and runs in one transaction with its audit row.
 */
import { redirect } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { Retail } from '@wise/core';
import {
  assignInternalBarcodes, cancelCustomerOrder, createSupplierOrders, deleteManualMove, deletePromotion, deleteWriteoff, firms, importRows,
  invoiceFromOrder, items, mergeItems, patchFirmSettings, renameItems, runPromotion, saveCoupon, saveCustomerOrder, saveLoyaltyCard, saveLots,
  saveManualMove, savePromotion, saveSupplierOrder, saveWriteoff, setItemRoles, setItemUnits, setSupplierOrderStatus, tidyItemNames,
  type LotInput, type Tx,
} from '@wise/db';
import type { ActionState } from '@/lib/books';
import { getUser } from '@/lib/auth';
import { stockAction, todayIso, numIn } from '@/lib/stock';
import { loadArtItems } from '@/lib/retail';

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const nOrNull = (f: FormData, k: string) => { const v = s(f, k); if (v === '') return null; const x = numIn(v); return Number.isFinite(x) ? x : null; };
const fields = (f: FormData, prefix: string) => [...f.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
const done = (st: ActionState, to: string): ActionState => { if (st.error) return st; redirect(to); };
const firmSettings = async (tx: Tx, firmId: string) => ((await tx.select({ s: firms.settings }).from(firms).where(eq(firms.id, firmId)).limit(1))[0]?.s ?? {}) as Record<string, unknown>;
async function role(): Promise<string> { return (await getUser())?.role ?? 'view'; }

function json<T extends z.ZodType>(schema: T, form: FormData): z.infer<T> | { error: string } {
  let raw: unknown;
  try { raw = JSON.parse(String(form.get('payload') ?? '{}')); } catch { return { error: 'Неважечки податоци.' }; }
  const p = schema.safeParse(raw);
  return p.success ? p.data : { error: p.error.issues[0]?.message ?? 'Неважечки податоци.' };
}
const isErr = (x: unknown): x is { error: string } => !!x && typeof x === 'object' && 'error' in x && Object.keys(x).length === 1;
const num = z.union([z.number(), z.string()]).transform((v) => numIn(v)).refine(Number.isFinite, 'Неважечки број.');
const numOpt = z.union([z.number(), z.string(), z.null()]).optional().transform((v) => (v == null || v === '' ? null : numIn(v)));

/* ---------------- Приемници и издатници ---------------- */

export async function saveMoveAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const kind = s(f, 'kind') as 'in' | 'use' | 'tr';
  if (!['in', 'use', 'tr'].includes(kind)) return { error: 'Неважечки вид.' };
  return done(await stockAction('saveMove', ['/zaliha'], (tx, a) => saveManualMove(tx, a, {
    kind, date: s(f, 'date'), itemId: s(f, 'itemId'), qty: numIn(s(f, 'qty')), wh: s(f, 'wh') || null, from: s(f, 'from') || null, to: s(f, 'to') || null,
    price: nOrNull(f, 'price'), account: s(f, 'account') || null, label: s(f, 'label') || null, partnerId: s(f, 'partnerId') || null,
  })), '/zaliha');
}
export async function deleteMoveAction(id: string): Promise<ActionState> {
  return stockAction('del', ['/zaliha'], (tx, a) => deleteManualMove(tx, a, id));
}

/* ---------------- нарачки од купувачи ---------------- */

const OrderIn = z.object({
  id: z.string().uuid().nullish(), number: z.string().max(40).nullish(), date: z.string(), partnerId: z.string().uuid('Изберете купувач.'),
  deliveryDate: z.string().nullish(), note: z.string().max(500).nullish(),
  lines: z.array(z.object({ itemId: z.string().uuid().nullable(), name: z.string().max(300).nullish(), qty: num, price: num, disc: numOpt, rate: numOpt })).max(1000),
});
export async function saveOrderAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const v = json(OrderIn, f);
  if (isErr(v)) return v;
  const st = await stockAction('ordSaveB', ['/porachki'], (tx, a) => saveCustomerOrder(tx, a, v));
  return done(st, '/porachki' + (st.data ? '?id=' + st.data.id : ''));
}
export async function cancelOrderAction(id: string): Promise<ActionState> {
  return stockAction('ordCancel', ['/porachki'], (tx, a) => cancelCustomerOrder(tx, a, id));
}
export async function orderInvoiceAction(id: string): Promise<ActionState> {
  const r = await role();
  const st = await stockAction('ordInv', ['/porachki', '/izlez'], (tx, a) => invoiceFromOrder(tx, { ...a, role: r }, id, todayIso()));
  return done(st, st.data ? `/izlez?edit=${st.data.invoiceId}` : '/porachki');
}

/* ---------------- нарачки до добавувачи ---------------- */

const PoIn = z.object({
  id: z.string().uuid().nullish(), date: z.string(), partnerId: z.string().uuid().nullish().or(z.literal('')), note: z.string().max(500).nullish(),
  lines: z.array(z.object({ itemId: z.string().uuid(), qty: num, price: numOpt })).max(1000),
});
export async function savePoAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const v = json(PoIn, f);
  if (isErr(v)) return v;
  return done(await stockAction('poSaveB', ['/nabavki'], (tx, a) => saveSupplierOrder(tx, a, { ...v, partnerId: v.partnerId || null })), '/nabavki');
}
export async function poStatusAction(id: string, status: 'recv' | 'cancel'): Promise<ActionState> {
  return stockAction(status === 'recv' ? 'poRecv' : 'poCancel', ['/nabavki'], (tx, a) => setSupplierOrderStatus(tx, a, id, status, todayIso()));
}

/** Replenishment / MRP: rows `sel_<item>` (checkbox), `q_<item>`, `pid_<item>`, `pr_<item>`. */
export async function createPosAction(source: 'repl' | 'mrp', _p: ActionState, f: FormData): Promise<ActionState> {
  const rows = fields(f, 'q_').filter((id) => source === 'mrp' || f.get('sel_' + id) === 'on')
    .map((id) => ({ itemId: id, qty: numIn(s(f, 'q_' + id)), pid: s(f, 'pid_' + id) || null, price: numIn(s(f, 'pr_' + id)) || 0 }))
    .filter((r) => r.qty > 0 && /^[0-9a-f-]{36}$/i.test(r.itemId));
  if (!rows.length) return { error: 'Нема избрани артикли.' };
  return done(await stockAction(source === 'mrp' ? 'mrpPo' : 'replMake', ['/nabavki', '/dopolnuvanje', '/mrp'], (tx, a) => createSupplierOrders(tx, a, rows, source, todayIso())), '/nabavki');
}
export async function replCfgAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const repl = { days: numIn(s(f, 'days')) || 90, lead: numIn(s(f, 'lead')) || 7, cover: numIn(s(f, 'cover')) || 14 };
  const st = await stockAction('replCfg', ['/dopolnuvanje'], (tx, a) => patchFirmSettings(tx, a, { repl }, 'replCfg'));
  return st.error ? st : { ok: 'Пресметано со новите параметри.' };
}

/* ---------------- лојалност и купони ---------------- */

export async function saveCardAction(_p: ActionState, f: FormData): Promise<ActionState> {
  return done(await stockAction('lcSave', ['/lojalnost'], (tx, a) => saveLoyaltyCard(tx, a, {
    id: s(f, 'id') || null, number: s(f, 'number'), name: s(f, 'name'), phone: s(f, 'phone'), email: s(f, 'email'), discount: nOrNull(f, 'discount'), points: nOrNull(f, 'points'),
  })), '/lojalnost');
}
export async function saveCouponAction(_p: ActionState, f: FormData): Promise<ActionState> {
  return done(await stockAction('cpSave', ['/lojalnost'], (tx, a) => saveCoupon(tx, a, {
    id: s(f, 'id') || null, code: s(f, 'code'), kind: s(f, 'kind') === 'amt' ? 'amt' : 'pct', value: numIn(s(f, 'value')) || 0,
    validFrom: s(f, 'validFrom') || null, validTo: s(f, 'validTo') || null, maxUses: nOrNull(f, 'maxUses'), minTotal: nOrNull(f, 'minTotal'),
  })), '/lojalnost?t=cp');
}
export async function loyCfgAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const loy = { per: numIn(s(f, 'per')) || 100, val: numIn(s(f, 'val')) || 1, min: numIn(s(f, 'min')) || 0 };
  const st = await stockAction('loyCfgSave', ['/lojalnost'], (tx, a) => patchFirmSettings(tx, a, { loy }, 'loyCfgSave'));
  return st.error ? st : { ok: 'Зачувано.' };
}

/* ---------------- акции ---------------- */

export async function savePromoAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const sel: Record<string, { price?: number | null; pct?: number | null }> = {};
  for (const id of fields(f, 's_')) if (f.get('s_' + id) === 'on') sel[id] = { price: nOrNull(f, 'n_' + id), pct: nOrNull(f, 'p_' + id) };
  return done(await stockAction('akcSave', ['/m_akcii'], (tx, a) => savePromotion(tx, a, {
    id: s(f, 'id') || null, name: s(f, 'name'), wh: s(f, 'wh'), from: s(f, 'from'), to: s(f, 'to'), pct: nOrNull(f, 'pct'), rnd: nOrNull(f, 'rnd'), sel,
  })), '/m_akcii');
}
export async function deletePromoAction(id: string): Promise<ActionState> {
  return stockAction('akDel', ['/m_akcii'], (tx, a) => deletePromotion(tx, a, id));
}
export async function runPromoAction(id: string, back: boolean): Promise<ActionState> {
  const st = await stockAction(back ? 'akEnd' : 'akStart', ['/m_akcii', '/nivel'], (tx, a) => runPromotion(tx, a, id, back, todayIso()));
  return st.error ? st : { ok: `Нивелација ${st.data!.number} од ${st.data!.date.split('-').reverse().join('.')}.` };
}

/* ---------------- лотови ---------------- */

/** Inputs `lot|<purchase|production>|<id>|<line>` and `exp|…` (only changed rows are sent: `chg|…`). */
export async function saveLotsAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const keys = new Set([...f.keys()].filter((k) => /^(lot|exp)\|/.test(k)).map((k) => k.slice(4)));
  const rows: LotInput[] = [...keys].map((k) => {
    const [t, id, ix] = k.split('|');
    return { sourceType: (t === 'production' ? 'production' : 'purchase') as LotInput['sourceType'], sourceId: id!, lineNo: Number(ix) || 0, lot: s(f, 'lot|' + k) || null, expiry: s(f, 'exp|' + k) || null };
  }).filter((r) => /^[0-9a-f-]{36}$/i.test(r.sourceId));
  const st = await stockAction('lotSave', ['/lotovi'], (tx, a) => saveLots(tx, a, rows));
  return st.error ? st : { ok: `Зачувано (${st.data} ставки).` };
}
export async function lotDaysAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const st = await stockAction('lotDays', ['/lotovi'], (tx, a) => patchFirmSettings(tx, a, { lotDays: numIn(s(f, 'days')) || 30 }, 'lotDays'));
  return st.error ? st : { ok: 'Зачувано.' };
}

/* ---------------- раздолжување без норматив ---------------- */

export async function saveWriteoffAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const lines = fields(f, 'q_').map((id) => ({ itemId: id, qty: numIn(s(f, 'q_' + id)) || 0 })).filter((l) => l.qty > 0);
  return done(await stockAction('rnPost', ['/rasNorm', '/prod'], (tx, a) => saveWriteoff(tx, a, {
    date: s(f, 'to'), from: s(f, 'from'), to: s(f, 'to'), mode: s(f, 'mode') === 'pct' ? 'pct' : 'popis', pct: nOrNull(f, 'pct'), wh: s(f, 'wh') || null,
    productId: s(f, 'productId') || null, productQty: nOrNull(f, 'productQty'), lines,
  })), '/rasNorm?ok=1');
}
export async function deleteWriteoffAction(id: string): Promise<ActionState> {
  return stockAction('del', ['/rasNorm'], (tx, a) => deleteWriteoff(tx, a, id));
}

/* ---------------- реална цена на чинење ---------------- */

export async function pcCfgAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const pcost = { oh: s(f, 'oh'), basis: ['mat', 'lab', 'qty'].includes(s(f, 'basis')) ? s(f, 'basis') : 'mat' };
  const st = await stockAction('pcCfgSave', ['/prodCost'], (tx, a) => patchFirmSettings(tx, a, { pcost }, 'pcCfgSave'));
  return st.error ? st : { ok: 'Пресметано.' };
}

/* ---------------- артикли: називи, чистење, конта, баркодови ---------------- */

export async function artNamesAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ch = fields(f, 'n_').map((id) => ({ id, name: s(f, 'n_' + id) })).filter((x) => x.name);
  if (!ch.length) return { error: 'Внесете барем еден назив.' };
  const st = await stockAction('anSave', ['/artNames', '/artikli'], (tx, a) => renameItems(tx, a, ch, 'anSave', false));
  return st.error ? st : { ok: `${st.data} називи се зачувани.` };
}
const NamesIn = z.object({ rows: z.array(z.object({ code: z.string().max(60), name: z.string().max(300) })).max(20000) });
export async function artNamesImportAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const v = json(NamesIn, f);
  if (isErr(v)) return v;
  let miss = 0;
  const st = await stockAction('anImp', ['/artNames', '/artikli'], async (tx, a) => {
    const codes = [...new Set(v.rows.map((r) => r.code.trim()).filter(Boolean))];
    const its = codes.length ? await tx.select({ id: items.id, code: items.code }).from(items).where(and(eq(items.firmId, a.firmId), inArray(items.code, codes))) : [];
    const by = new Map(its.map((i) => [i.code ?? '', i.id]));
    const ch = v.rows.flatMap((r) => { const id = by.get(r.code.trim()); if (!id) { miss++; return []; } return r.name.trim() ? [{ id, name: r.name.trim() }] : []; });
    return renameItems(tx, a, ch, 'anImp', false);
  });
  return st.error ? st : { ok: `${st.data} називи се сменети од Excel${miss ? ` (${miss} шифри не се пронајдени)` : ''}.` };
}

export async function artMergeAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const master = s(f, 'master');
  const ids = s(f, 'ids').split(',').filter(Boolean);
  if (!master || ids.length < 2) return { error: 'Изберете главен артикл.' };
  const st = await stockAction('del', ['/artQ', '/artikli'], (tx, a) => mergeItems(tx, a, master, ids));
  return st.error ? st : { ok: `Споено (${st.data!.refs} записи префрлени).` };
}
export async function artIgnoreAction(key: string): Promise<ActionState> {
  return stockAction('artIgn', ['/artQ'], async (tx, a) => {
    const cur = (await firmSettings(tx, a.firmId)).artIgnore as string[] | undefined;
    await patchFirmSettings(tx, a, { artIgnore: [...new Set([...(cur ?? []), key])] }, 'artIgn');
  });
}
export async function artUnitsAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const map: Record<string, string> = {};
  for (const k of fields(f, 'u_')) { const v = s(f, 'u_' + k); if (v && v !== k) map[k] = v; }
  const st = await stockAction('artUnitsGo', ['/artQ'], async (tx, a) => {
    const cur = ((await firmSettings(tx, a.firmId)).artUnits ?? {}) as Record<string, string>;
    const U = { ...cur };
    for (const [x, y] of Object.entries(map)) if (x) U[x.toLowerCase()] = y;
    const rules = Retail.artRules(null, U);
    const all = await tx.select({ u: items.unit }).from(items).where(eq(items.firmId, a.firmId));
    const full: Record<string, string> = {};
    for (const { u } of all) { const t = String(u ?? '').trim(); const to = map[t] ?? Retail.artUnit(t, rules); if (to && to !== t) full[t] = to; }
    await patchFirmSettings(tx, a, { artUnits: U }, 'artUnitsGo');
    return setItemUnits(tx, a, full);
  });
  return st.error ? st : { ok: `Сменети ${st.data} артикли.` };
}
export async function artAbbrAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const apply = f.get('apply') === '1';
  const st = await stockAction('artAbbrSave', ['/artQ'], async (tx, a) => {
    const cur = ((await firmSettings(tx, a.firmId)).artAbbr ?? {}) as Record<string, string>;
    const A = { ...cur };
    for (const k of fields(f, 'a_')) { const v = s(f, 'a_' + k); if (v) A[k] = v; else delete A[k]; }
    await patchFirmSettings(tx, a, { artAbbr: A }, 'artAbbrSave');
    if (!apply) return 0;
    const ids = fields(f, 'r_').filter((id) => f.get('r_' + id) === 'on');
    const rows = ids.length ? await tx.select({ id: items.id, name: items.name }).from(items).where(and(eq(items.firmId, a.firmId), inArray(items.id, ids))) : [];
    return renameItems(tx, a, rows.map((r) => ({ id: r.id, name: Retail.artApplyAbbr(r.name, A) })), 'artAbbrGo');
  });
  return st.error ? st : { ok: apply ? `Сменети ${st.data} имиња (старите се чуваат за препознавање при увоз).` : 'Правилата се зачувани.' };
}
export async function artFmtAction(): Promise<ActionState> {
  const st = await stockAction('artFmt', ['/artQ', '/artikli'], async (tx, a) => tidyItemNames(tx, a, ((await firmSettings(tx, a.firmId)).artAbbr ?? {}) as Record<string, string>));
  return st.error ? st : { ok: `Средени ${st.data} имиња.` };
}
/** Legacy `artAutoGo`: units → names → merge duplicate groups (twice) → optionally similar ≥ 90 %. */
export async function artAutoAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const sim = f.get('sim') === 'on' ? 0.9 : 0;
  const st = await stockAction('del', ['/artQ', '/artikli'], async (tx, a) => {
    const S = await firmSettings(tx, a.firmId);
    const rules = Retail.artRules(S.artAbbr as Record<string, string>, S.artUnits as Record<string, string>);
    const all = await tx.select({ u: items.unit }).from(items).where(eq(items.firmId, a.firmId));
    const um: Record<string, string> = {};
    for (const { u } of all) { const t = String(u ?? '').trim(); const to = Retail.artUnit(t, rules); if (to && to !== t) um[t] = to; }
    const u = await setItemUnits(tx, a, um);
    const nn = await tidyItemNames(tx, a, rules.abbr);
    let g = 0, d = 0;
    for (let pass = 0; pass < 2; pass++) {
      const { items: its, movesOf } = await loadArtItems(tx, a.firmId);
      const R = Retail.artAnalyze(its, rules, { ignore: (S.artIgnore as string[]) ?? [] });
      const groups = [...R.groups, ...(pass === 1 && sim ? R.sim.filter((x) => x.s >= sim).map((x) => [x.a, x.b]) : [])];
      const gone = new Set<string>();
      for (const grp of groups) {
        const live = grp.filter((x) => !gone.has(x.id));
        if (live.length < 2) continue;
        const M = Retail.artPickMaster(live, movesOf);
        const r = await mergeItems(tx, a, M.id, live.map((x) => x.id));
        for (const x of live) if (x.id !== M.id) gone.add(x.id);
        g += r.merged; d += r.refs;
      }
    }
    return { u, n: nn, g, d };
  });
  if (!st.error && !st.data!.u && !st.data!.n && !st.data!.g) return { ok: 'Нема што да се среди автоматски.' };
  return st.error ? st : { ok: `✓ Средено: ${st.data!.u} единици, ${st.data!.n} имиња, ${st.data!.g} артикли споени (${st.data!.d} записи префрлени).` };
}

/** Legacy `artDupAll` / `artSimAll` (11336): merge every duplicate group, or every similar pair ≥ 90 % (master: with code, then more moves). */
export async function artMergeAllAction(kind: 'dup' | 'sim'): Promise<ActionState> {
  const st = await stockAction('del', ['/artQ', '/artikli'], async (tx, a) => {
    const S = await firmSettings(tx, a.firmId);
    const rules = Retail.artRules(S.artAbbr as Record<string, string>, S.artUnits as Record<string, string>);
    const { items: its, movesOf } = await loadArtItems(tx, a.firmId);
    const R = Retail.artAnalyze(its, rules, { ignore: (S.artIgnore as string[]) ?? [] });
    const groups = kind === 'dup' ? R.groups : R.sim.filter((x) => x.s >= 0.9).map((x) => [x.a, x.b]);
    const gone = new Set<string>();
    let g = 0, n = 0;
    for (const grp of groups) {
      const live = grp.filter((x) => !gone.has(x.id));
      if (live.length < 2) continue;
      const M = Retail.artPickMaster(live, movesOf);
      const r = await mergeItems(tx, a, M.id, live.map((x) => x.id));
      for (const x of live) if (x.id !== M.id) gone.add(x.id);
      g += r.merged; n++;
    }
    return { g, n, empty: !groups.length };
  });
  if (st.error) return st;
  const d = st.data!;
  if (d.empty) return { error: kind === 'sim' ? 'Нема парови над 90%.' : 'Нема што да се среди.' };
  return { ok: kind === 'sim' ? `Споени ${d.n} пара.` : `Споени ${d.g} артикли.` };
}

export async function artKontaAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const rawK = s(f, 'rawK') || '3100';
  if (!/^\d{3,10}$/.test(rawK)) return { error: 'Контото мора да има само цифри.' };
  // rows whose role / cost differ from the original (`o_<id>` = "role|cp|pc"); a bulk role applies to the ticked rows
  const bulk = s(f, 'bulk') as Retail.ArtRole | '';
  const ch = fields(f, 'o_').map((id) => {
    const role = (bulk && f.get('sel_' + id) === 'on' ? bulk : s(f, 'role_' + id) || 'goods') as Retail.ArtRole;
    return { id, role, cp: s(f, 'cp_' + id), pc: s(f, 'pc_' + id) };
  }).filter((x) => `${x.role}|${x.cp}|${x.pc}` !== s(f, 'o_' + x.id))
    .map((x) => ({ id: x.id, role: x.role, ...(f.has('cp_' + x.id) ? { costPrice: nOrNull(f, 'cp_' + x.id), costPct: nOrNull(f, 'pc_' + x.id) } : {}) }));
  const st = await stockAction('akSave', ['/artKonta', '/artikli'], async (tx, a) => {
    const S = await firmSettings(tx, a.firmId);
    if (S.prodRawK !== rawK) await patchFirmSettings(tx, a, { prodRawK: rawK }, 'akRaw');
    return setItemRoles(tx, a, ch, rawK);
  });
  return st.error ? st : { ok: `Зачувани ${st.data!.n} артикли.${st.data!.missing.length ? ' Без себечена цена: ' + st.data!.missing.join(', ') + ' – внесете ја за да се раздолжи ' + rawK + '.' : ''}` };
}

export async function bkGenAction(): Promise<ActionState> {
  const st = await stockAction('bkGen', ['/barkodi', '/artikli'], (tx, a) => assignInternalBarcodes(tx, a));
  return st.error ? st : { ok: `Доделени ${st.data} баркодови.` };
}

/* ---------------- увоз ---------------- */

const ImpIn = z.object({
  t: z.enum(['partners', 'items', 'employees', 'purchases', 'invoices', 'stock', 'journal', 'in', 'pop', 'nivel']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), wh: z.string().max(40).nullish(),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).max(50000),
});
export async function importAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const v = json(ImpIn, f);
  if (isErr(v)) return v;
  const r = await role();
  const st = await stockAction('impRun', ['/uvoz', '/artikli', '/partneri', '/vlez', '/izlez', '/nalozi', '/g_lager', '/m_lager', '/m_izlez', '/nivel'],
    (tx, a) => importRows(tx, { ...a, role: r }, v.t, v.rows, { date: v.date, wh: v.wh || null, today: todayIso() }));
  if (st.error) return st;
  const R = st.data!;
  return { ok: `Готово: ${R.add} додадени, ${R.upd} ажурирани${R.newP ? `, ${R.newP} нови комитенти` : ''}${R.skip.length ? `, ${R.skip.length} прескокнати: ` + R.skip.slice(0, 12).join(' · ') + (R.skip.length > 12 ? ' …' : '') : '.'}` };
}
