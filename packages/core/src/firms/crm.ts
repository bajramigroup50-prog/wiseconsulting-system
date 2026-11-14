/**
 * CRM of the office's own sales (`/crm`): pipeline stages, lead sources, the offer („Понуда за сметководствени
 * услуги“, same office memo and services as the contract `kdog.ts`) and the report (leads by stage / source, win rate).
 * Pure — the screen stores leads in `crm_leads`, notes in `crm_notes`, offers in `crm_offers`.
 */
import { kdAmt, kdDocHead, kdVat, kdWords, KD_SVC, KD_SVC_DEF, type KdFirm, type KdOffice } from './kdog';

export const CRM_STAGES = [
  ['nov', 'Нов', '#64748b'],
  ['kontakt', 'Контакт', '#2563eb'],
  ['ponuda', 'Понуда', '#7c3aed'],
  ['pregovori', 'Преговори', '#d97706'],
  ['dobien', 'Добиен', '#15803d'],
  ['izguben', 'Изгубен', '#b42318'],
] as const;
export type CrmStage = (typeof CRM_STAGES)[number][0];
export const CRM_OPEN: readonly CrmStage[] = ['nov', 'kontakt', 'ponuda', 'pregovori'];
export const isCrmStage = (s: unknown): s is CrmStage => CRM_STAGES.some(([k]) => k === s);
export const crmStageName = (s: string): string => CRM_STAGES.find(([k]) => k === s)?.[1] ?? s;

export const CRM_SOURCES = [
  ['web', 'Веб-форма'],
  ['preporaka', 'Препорака'],
  ['telefon', 'Телефон'],
  ['drugo', 'Друго'],
] as const;
export type CrmSource = (typeof CRM_SOURCES)[number][0];
export const isCrmSource = (s: unknown): s is CrmSource => CRM_SOURCES.some(([k]) => k === s);
export const crmSourceName = (s: string): string => CRM_SOURCES.find(([k]) => k === s)?.[1] ?? s;

export const CRM_NOTE_KINDS = [['note', '📝 Белешка'], ['call', '📞 Разговор'], ['meeting', '🤝 Средба'], ['mail', '✉ Е-пошта'], ['stage', '➡ Фаза']] as const;

/** Offer number: `ПН-001/2026`. */
export const crmOfferNumber = (n: number, year: number | string) => `ПН-${String(n).padStart(3, '0')}/${year}`;

/** The offer (`crm_offers.data` + number / date / validity columns). Amounts as entered (`feeMode`). */
export interface CrmOffer {
  number: string; date: string; validUntil: string; start: string;
  svc: string[]; extra: string; feeMode: 'gross' | 'net'; fee: number | string; empFree: number; feeEmp: number | string;
  feeYear: number | string; feeHour: number | string; docDay: number; payDay: number; note: string;
}

export interface CrmLeadLike { company: string; edb?: string | null; contact?: string | null; address?: string | null; city?: string | null; email?: string | null; phone?: string | null; employees?: number | null; fee?: string | number | null }

const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** A new offer prefilled from the office defaults and the lead (its estimated fee wins). */
export function crmOfferNew(O: KdOffice, l: CrmLeadLike, today: string): CrmOffer {
  return {
    number: '', date: today, validUntil: addDays(today, 30), start: '', svc: [...KD_SVC_DEF], extra: '',
    feeMode: 'net', fee: Number(l.fee) || O.fee || '', empFree: Number(O.empFree) || 3, feeEmp: O.feeEmp || '', feeYear: O.feeYear || '', feeHour: O.feeHour || '',
    docDay: Number(O.docDay) || 5, payDay: 10, note: '',
  };
}

const posInt = (x: unknown, def: number) => { const q = Math.round(Number(x)); return Number.isFinite(q) && q > 0 ? q : def; };
const amt = (x: unknown) => { const s = String(x ?? '').replace(',', '.').trim(); return s && Number.isFinite(Number(s)) && Number(s) >= 0 ? Number(s) : ''; };
const iso = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : '');

/** Normalise a stored / posted offer. */
export function crmOfferNormalize(v: Partial<Record<keyof CrmOffer, unknown>>, today: string): CrmOffer {
  const svc = Array.isArray(v.svc) ? v.svc.filter((s): s is string => KD_SVC.some(([k]) => k === s)) : [...KD_SVC_DEF];
  const date = iso(v.date) || today;
  return {
    number: String(v.number ?? ''), date, validUntil: iso(v.validUntil) || addDays(date, 30), start: iso(v.start),
    svc, extra: String(v.extra ?? '').slice(0, 2000), feeMode: v.feeMode === 'gross' ? 'gross' : 'net',
    fee: amt(v.fee), empFree: posInt(v.empFree, 3), feeEmp: amt(v.feeEmp), feeYear: amt(v.feeYear), feeHour: amt(v.feeHour),
    docDay: Math.min(posInt(v.docDay, 5), 28), payDay: Math.min(posInt(v.payDay, 10), 28), note: String(v.note ?? '').slice(0, 4000),
  };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const dmy = (d: string | null | undefined) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');
const fmt = (n: number) => (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface CrmOfferCtx { lead: CrmLeadLike; O: KdOffice; off?: KdFirm | null; img: (fileId: string) => string; signed?: boolean }

/** The offer as HTML (screen / print / PDF) in the office style: the office memo, services, prices, terms, signature. */
export function crmOfferHtml(p: CrmOffer, x: CrmOfferCtx): string {
  const { lead: l, O } = x;
  const r = kdVat(O);
  const row = (label: string, v: unknown, unit: string) => {
    if (!Number(v)) return '';
    const a = kdAmt(p.feeMode, v as number, r);
    return `<tr><td style="padding:5px 8px;border:1px solid #cfd8d5">${esc(label)}</td><td style="padding:5px 8px;border:1px solid #cfd8d5;text-align:right;white-space:nowrap"><b>${fmt(a.net)}</b></td>${r ? `<td style="padding:5px 8px;border:1px solid #cfd8d5;text-align:right;white-space:nowrap">${fmt(a.gross)}</td>` : ''}<td style="padding:5px 8px;border:1px solid #cfd8d5">${esc(unit)}</td></tr>`;
  };
  const S = KD_SVC.filter(([k]) => p.svc.includes(k)).map(([, n]) => n);
  const extra = p.extra.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const main = kdAmt(p.feeMode, p.fee as number, r);
  const of = x.off ?? {};
  const memo: KdFirm = { ...of, name: O.name || of.name, address: O.address || of.address, city: O.city || of.city, edb: O.edb || of.edb, embs: O.embs || of.embs, bank: O.bank || of.bank, phone: O.phone || of.phone, email: O.email || of.email };
  const logo = O.logo || of.logo;
  const to = [l.address, l.city].filter(Boolean).join(', ');
  const H = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.5;color:#111">
  <div style="display:flex;justify-content:space-between;gap:20px;margin:6px 0 14px">
   <div><div style="font-size:9.5px;color:#555;text-transform:uppercase;letter-spacing:.4px">До</div><b style="font-size:13px">${esc(l.company)}</b>${to ? `<br>${esc(to)}` : ''}${l.edb ? `<br>ЕДБ ${esc(l.edb)}` : ''}${l.contact ? `<br>н.р. ${esc(l.contact)}` : ''}</div>
   <div style="text-align:right">Број: <b>${esc(p.number || '—')}</b><br>Датум: ${esc(dmy(p.date))}<br>Важи до: <b>${esc(dmy(p.validUntil))}</b></div>
  </div>
  <h1 style="text-align:center;font-size:18px;color:#0d5b4b;margin:6px 0 2px;letter-spacing:1px">ПОНУДА</h1>
  <p style="text-align:center;margin:0 0 14px;font-size:12.5px">за вршење на сметководствени услуги</p>
  <p>Почитувани${l.contact ? ` ${esc(l.contact)}` : ''},</p>
  <p style="text-align:justify">Ви благодариме за интересот за соработка. Во продолжение Ви ја доставуваме нашата понуда за водење на сметководството на <b>${esc(l.company)}</b>${l.employees ? ` (${esc(l.employees)} вработени)` : ''}. Услугите ги вршиме стручно, во законските рокови и со современа програма, со портал за клиенти преку кој документите се доставуваат и следат електронски.</p>
  <h3 style="font-size:12.5px;color:#0d5b4b;margin:14px 0 4px;border-bottom:1px solid #cfd8d5;padding-bottom:2px">1. Опфат на услугите</h3>
  <ul style="margin:4px 0 0 18px;padding:0">${[...S, ...extra].map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
  <h3 style="font-size:12.5px;color:#0d5b4b;margin:14px 0 4px;border-bottom:1px solid #cfd8d5;padding-bottom:2px">2. Цена</h3>
  <table style="border-collapse:collapse;width:100%;font-size:11px"><thead><tr style="background:#e8f1ee"><th style="padding:5px 8px;border:1px solid #cfd8d5;text-align:left">Услуга</th><th style="padding:5px 8px;border:1px solid #cfd8d5;text-align:right">${r ? 'Без ДДВ' : 'Износ'} (ден.)</th>${r ? `<th style="padding:5px 8px;border:1px solid #cfd8d5;text-align:right">Со ДДВ ${r}% (ден.)</th>` : ''}<th style="padding:5px 8px;border:1px solid #cfd8d5;text-align:left">Период</th></tr></thead><tbody>
   ${Number(p.fee) ? row('Месечен надоместок за услугите од точка 1', p.fee, 'месечно') : `<tr><td colspan="${r ? 4 : 3}" style="padding:5px 8px;border:1px solid #cfd8d5">Месечен надоместок: по договор</td></tr>`}
   ${row(`За секој вработен над ${p.empFree}`, p.feeEmp, 'месечно, по вработен')}
   ${row('Годишна сметка и даночен биланс', p.feeYear, 'еднократно, годишно')}
   ${row('Услуги надвор од опфатот', p.feeHour, 'по час')}
  </tbody></table>
  ${Number(p.fee) ? `<p style="margin:4px 0 0;font-size:10px;color:#444">Месечниот надоместок со зборови: ${esc(kdWords(main.net))}${r ? ' (без ДДВ)' : ''}.${r ? '' : ' Давателот на услугата не е обврзник за ДДВ.'}</p>` : ''}
  <h3 style="font-size:12.5px;color:#0d5b4b;margin:14px 0 4px;border-bottom:1px solid #cfd8d5;padding-bottom:2px">3. Услови</h3>
  <ul style="margin:4px 0 0 18px;padding:0">
   <li>Документите за претходниот месец се доставуваат до <b>${esc(p.docDay)}-ти</b> во тековниот месец (преку порталот, е-пошта или во хартиена форма).</li>
   <li>Надоместокот се плаќа по фактура до <b>${esc(p.payDay)}-ти</b> во месецот за претходниот месец.</li>
   ${p.start ? `<li>Почеток на соработката: <b>${esc(dmy(p.start))}</b>.</li>` : ''}
   <li>По прифаќањето на понудата се склучува Договор за вршење на сметководствени услуги.</li>
   <li>Понудата важи до ${esc(dmy(p.validUntil))}.</li>
  </ul>
  ${p.note ? `<p style="margin:10px 0 0;text-align:justify;white-space:pre-line">${esc(p.note)}</p>` : ''}
  <p style="margin:14px 0 0">Со почит,</p>
  <div style="page-break-inside:avoid;break-inside:avoid;display:flex;justify-content:flex-end;margin-top:10px"><div style="text-align:center;min-width:72mm;position:relative"><b>${esc(O.name || '')}</b><div style="height:62px;position:relative;margin-top:6px">${x.signed && O.sig ? `<img src="${esc(x.img(O.sig))}" style="height:58px;object-fit:contain;position:relative;z-index:2">` : ''}${x.signed && O.stamp ? `<img src="${esc(x.img(O.stamp))}" style="height:30mm;max-width:34mm;object-fit:contain;position:absolute;left:58%;top:-14px;opacity:.9;z-index:1">` : ''}</div><div style="border-top:1px solid #111;padding-top:3px">${esc(O.rep || '')}<br><small>${esc(O.repRole || 'Управител')}</small></div></div></div>
  </div>`;
  return kdDocHead(memo, { logoSrc: logo ? x.img(logo) : null }) + H;
}

/* ---------------- report ---------------- */

export interface CrmStatLead { stage: string; source: string; fee?: string | number | null; createdAt?: Date | string | null }
export interface CrmStats {
  total: number; open: number; won: number; lost: number; winRate: number | null; pipelineFee: number; wonFee: number;
  byStage: { stage: string; name: string; n: number; fee: number }[];
  bySource: { source: string; name: string; n: number; won: number; lost: number; winRate: number | null }[];
}

/** Leads by stage and source, win rate = won / (won + lost) (open leads are not counted). */
export function crmStats(L: readonly CrmStatLead[]): CrmStats {
  const fee = (l: CrmStatLead) => Number(l.fee) || 0;
  const rate = (w: number, x: number) => (w + x ? Math.round((w * 1000) / (w + x)) / 10 : null);
  const won = L.filter((l) => l.stage === 'dobien'), lost = L.filter((l) => l.stage === 'izguben');
  const open = L.filter((l) => (CRM_OPEN as readonly string[]).includes(l.stage));
  const srcKeys = [...CRM_SOURCES.map(([k]) => k as string), ...new Set(L.map((l) => l.source).filter((s) => !isCrmSource(s)))];
  return {
    total: L.length, open: open.length, won: won.length, lost: lost.length, winRate: rate(won.length, lost.length),
    pipelineFee: open.reduce((s, l) => s + fee(l), 0), wonFee: won.reduce((s, l) => s + fee(l), 0),
    byStage: CRM_STAGES.map(([k, n]) => { const X = L.filter((l) => l.stage === k); return { stage: k, name: n, n: X.length, fee: X.reduce((s, l) => s + fee(l), 0) }; }),
    bySource: srcKeys.map((k) => {
      const X = L.filter((l) => l.source === k);
      const w = X.filter((l) => l.stage === 'dobien').length, x = X.filter((l) => l.stage === 'izguben').length;
      return { source: k, name: crmSourceName(k), n: X.length, won: w, lost: x, winRate: rate(w, x) };
    }).filter((s) => s.n > 0 || isCrmSource(s.source)),
  };
}

/** Web-form submission → lead fields (trimmed, length-capped); `null` when there is no name / company and no contact. */
export function crmFromWebForm(b: Record<string, unknown>): { company: string; contact: string | null; phone: string | null; email: string | null; activity: string | null; employees: number | null; message: string | null } | null {
  const s = (k: string, max = 200) => { const v = String(b[k] ?? '').trim().slice(0, max); return v || null; };
  const company = s('company') ?? s('firma');
  const contact = s('name') ?? s('ime');
  const email = s('email');
  const phone = s('phone') ?? s('tel');
  if (!(company || contact) || !(email || phone)) return null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const emp = Math.round(Number(b.employees));
  return { company: company ?? contact!, contact, phone, email, activity: s('activity'), employees: Number.isFinite(emp) && emp > 0 && emp < 100000 ? emp : null, message: s('message', 3000) };
}
