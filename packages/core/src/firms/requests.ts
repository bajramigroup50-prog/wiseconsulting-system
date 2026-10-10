/**
 * Requests and official forms (legacy `TPL0` / `FORMS0` / `FORM_BG` / `PH` / `phVals` / `fillTpl` / `askFields` / `reqHTML`
 * / `fSrcVal` / `formVals` / `formHTML` 3935–3973). Text templates use `{фирма}` (firm data) and `{?Поле}` (asked each
 * time); official forms are a scanned background (`/forms/<id>[_page].jpg`) with positioned fields.
 */
import TPL0_JSON from '../data/requests-tpl.json';
import FORMS0_JSON from '../data/requests-forms.json';

export const INST = ['ЦРСМ', 'УЈП', 'АВРМ', 'ФЗО', 'ПИОМ', 'Банка', 'Суд', 'Општина', 'Нотар', 'Друго'] as const;

export interface ReqTpl { id: string; inst: string; name: string; to?: string; title: string; body: string; free?: boolean }
export interface FormField { k: string; l: string; x: number; y: number; w: number; h: number; t: 't' | 'c' | 'x' | 's' | 'm'; src: string; g?: string; p?: number }
export interface ReqForm { id: string; inst: string; name: string; form: true; W?: number; H?: number; pages?: { W: number; H: number }[]; fields: FormField[] }

export const TPL0: readonly ReqTpl[] = TPL0_JSON as ReqTpl[];
export const FORMS0: readonly ReqForm[] = FORMS0_JSON as ReqForm[];

/** Firm data the templates use (legacy firm fields). */
export interface ReqFirm { name?: string; short?: string; edb?: string; embs?: string; address?: string; city?: string; bank?: string; bankName?: string; signer?: string; phone?: string; email?: string; activity?: string; nkd?: string; signerEmbg?: string }

export const PH: readonly (readonly [string, string])[] = [
  ['фирма', 'Назив'], ['скратен', 'Скратен назив'], ['едб', 'ЕДБ'], ['ембс', 'ЕМБС'], ['адреса', 'Адреса'], ['град', 'Град'], ['жиро', 'Жиро сметка'],
  ['банка', 'Банка'], ['управител', 'Управител'], ['телефон', 'Телефон'], ['email', 'Е-пошта'], ['датум', 'Денешен датум'],
];

const dmy = (d: string) => d.split('-').reverse().join('.');

export function phVals(f: ReqFirm, today: string): Record<string, string> {
  return {
    'фирма': f.name || '', 'скратен': f.short || f.name || '', 'едб': f.edb || '', 'ембс': f.embs || '', 'адреса': f.address || '', 'град': f.city || '',
    'жиро': f.bank || '', 'банка': f.bankName || '', 'управител': f.signer || '', 'телефон': f.phone || '', 'email': f.email || '', 'датум': dmy(today),
  };
}

/** Legacy `askFields`: `{?…}` placeholders, in order, once. */
export const askFields = (b: string) => [...new Set([...String(b || '').matchAll(/\{\?([^}]+)\}/g)].map((x) => x[1]!))];

/** Legacy `fillTpl`. */
export function fillTpl(txt: string, f: ReqFirm, ask: Record<string, string>, today: string): string {
  const V = phVals(f, today);
  return String(txt || '').replace(/\{\?([^}]+)\}/g, (_, k: string) => ask[k] || '________________')
    .replace(/\{([^}?]+)\}/g, (m0, k: string) => (V[k.toLowerCase()] !== undefined ? V[k.toLowerCase()] || '________' : m0));
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Legacy `reqHTML`: letterhead, number/date, recipient, title, body, signature line. */
export function reqHtml(tp: { to?: string; inst?: string; title: string; body: string }, f: ReqFirm, ask: Record<string, string>, today: string): string {
  const T = fillTpl(tp.title, f, ask, today), B = fillTpl(tp.body, f, ask, today);
  return `<div style="font-size:11px;line-height:1.6"><div style="text-align:center;border-bottom:1.5px solid #111;padding-bottom:6px"><b style="font-size:14px">${esc(f.name)}</b><div style="font-size:9.5px">${esc([f.address, f.city].filter(Boolean).join(', '))}${f.edb ? ' · ЕДБ ' + esc(f.edb) : ''}${f.embs ? ' · ЕМБС ' + esc(f.embs) : ''}${f.phone ? ' · ' + esc(f.phone) : ''}</div></div>
<div style="display:flex;justify-content:space-between;margin:14px 0"><div>Бр. ______________<br>${esc(f.city || '________')}, ${dmy(today)}</div><div style="text-align:right">До:<br><b>${esc(fillTpl(tp.to || tp.inst || '', f, ask, today))}</b></div></div>
<div style="text-align:center;font-weight:700;font-size:14px;margin:18px 0 14px;white-space:pre-line">${esc(T)}</div><div style="white-space:pre-line;text-align:justify">${esc(B)}</div>
<div style="display:flex;justify-content:space-between;margin-top:26mm"><span></span><span>М.П.</span><span style="border-top:1px solid #333;min-width:50mm;text-align:center;padding-top:2px">Управител${f.signer ? '<br><b>' + esc(f.signer) + '</b>' : ''}</span></div></div>`;
}

/** Legacy `fSrcVal`: value of a form field from the firm. */
export function fSrcVal(src: string, f: ReqFirm, today: string): string {
  if (!src || src === 'opt') return '';
  if (src === 'today') return dmy(today);
  if (src === 'f.addr') return [f.address, f.city].filter(Boolean).join(', ');
  if (src === 'f.nameaddr') return [f.name, f.address, f.city].filter(Boolean).join(', ');
  if (src === 'f.activity') return [f.nkd, f.activity].filter(Boolean).join(' – ');
  if (src.startsWith('f.')) { const k = src.slice(2); return k === 'sign' ? '1' : String((f as Record<string, unknown>)[k] ?? ''); }
  return src;
}

/** Legacy `formVals`: own input wins, then the firm's value, then a twin field, then the remembered value. */
export function formVals(tp: ReqForm, f: ReqFirm, ask: Record<string, string>, today: string, mem: Record<string, string> = {}): Record<string, string> {
  const V: Record<string, string> = {};
  for (const x of tp.fields) {
    const own = ask[x.k];
    if (own !== undefined) { V[x.k] = own; continue; }
    if (x.t === 'x') { V[x.k] = x.src === '1' ? '1' : ''; continue; }
    const sv = fSrcVal(x.src, f, today);
    const twin = x.src && x.src.startsWith('f.') ? tp.fields.find((y) => y !== x && y.src === x.src && ask[y.k]) : undefined;
    V[x.k] = sv !== '' ? sv : twin ? ask[twin.k]! : x.src && x.src.startsWith('f.') ? '' : mem[x.k] || '';
  }
  if (!tp.fields.some((x) => x.t === 'c' && V[x.k])) { const c0 = tp.fields.find((x) => x.t === 'c'); if (c0) V[c0.k] = '1'; }
  return V;
}

/** Background image path of a form page. */
export const formBg = (tp: ReqForm, page: number) => `/forms/${tp.pages ? `${tp.id}_${page}` : tp.id}.jpg`;

/** Legacy `formHTML`: the scanned form with the values on top (percent positions). `sign` = signature image URL. */
export function formHtml(tp: ReqForm, V: Record<string, string>, opts: { sign?: string | null; base?: string } = {}): string {
  const PG = tp.pages ?? [{ W: tp.W!, H: tp.H! }];
  return PG.map((pg, pi) => {
    const { W, H } = pg;
    const fields = tp.fields.filter((x) => (x.p ?? 0) === pi).map((x) => {
      const v = V[x.k];
      if (!v) return '';
      const st = `position:absolute;left:${x.x / W * 100}%;top:${x.y / H * 100}%;width:${x.w / W * 100}%;height:${x.h / H * 100}%;display:flex;align-items:center;overflow:hidden`;
      if (x.t === 'c' || x.t === 'x') return `<div style="${st};justify-content:center;font-weight:800;font-size:${x.t === 'x' ? 12 : 15}px;overflow:visible">✕</div>`;
      if (x.t === 's') return opts.sign ? `<div style="${st};justify-content:center;overflow:visible"><img src="${esc(opts.sign)}" alt="" style="max-height:${x.h > 30 ? 100 : 260}%;max-width:90%"></div>` : '';
      if (x.t === 'm') return `<div style="${st};align-items:flex-start;padding:0.3% 0.6%;font-size:10.5px;font-family:Arial,sans-serif;white-space:pre-wrap;line-height:1.35">${esc(v)}</div>`;
      return `<div style="${st};padding-left:0.6%;font-size:10.5px;font-family:Arial,sans-serif;white-space:nowrap">${esc(v)}</div>`;
    }).join('');
    return `<div style="position:relative;width:100%;line-height:1;${pi < PG.length - 1 ? 'page-break-after:always;break-after:page;margin-bottom:10px' : ''}"><img src="${esc((opts.base ?? '') + formBg(tp, pi))}" alt="" style="width:100%;display:block">${fields}</div>`;
  }).join('');
}
