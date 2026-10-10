/**
 * Store-door notice „Побарај фискална сметка“ (legacy `KL_INSP` / `klInspDef` / `klNoteHTML` 9104–9124, printed by
 * `klNotePdf` from the client-portal screen): the УЈП sticker (or the uploaded original image), the duty to take the
 * fiscal receipt, the inspectorates to report irregularities to and the firm's data; optionally bilingual (MK / SQ).
 */
import type { KlNote } from '../office/portal';

/** [id, name MK, name SQ, phone, e-mail, profiles that select it by default] */
export type KlInsp = readonly [string, string, string, string, string, readonly string[]];
export const KL_INSP: readonly KlInsp[] = [
  ['dpi', 'Државен пазарен инспекторат', 'Inspektorati Shtetëror i Tregut', '191 · 02 3 220-547', 'nepravilnosti@dpi.gov.mk', ['retail', 'wholesale', 'auto', 'service', 'hotel', 'prod', 'construct']],
  ['ahv', 'Агенција за храна и ветеринарство', 'Agjencia e Ushqimit dhe Veterinarisë', '0800 3 2222', 'sin@fva.gov.mk', ['hotel']],
  ['dszi', 'Државен санитарен и здравствен инспекторат', 'Inspektorati Shtetëror Sanitar dhe Shëndetësor', '0800 255 55', 'prijavi.dszi@gmail.com', ['hotel']],
  ['dti', 'Државен инспекторат за транспорт', 'Inspektorati Shtetëror i Transportit', '', 'prijavi@dti.gov.mk', []],
  ['malmed', 'Агенција за лекови и медицински средства', 'Agjencia për Barna dhe Mjete Medicinale', '', 'prijavi@malmed.gov.mk', []],
  ['dit', 'Државен инспекторат за труд', 'Inspektorati Shtetëror i Punës', '151 31', 'poplaki@dit.gov.mk', []],
];

/** Legacy `klInspDef`: ДПИ always, plus the inspectorates of the firm's profiles. NB legacy reads `kl.prof` only. */
export const klInspDefault = (prof: readonly string[] = []): string[] =>
  KL_INSP.filter((x) => x[0] === 'dpi' || x[5].some((p) => prof.includes(p))).map((x) => x[0]);

/** Normalise the notice form (trimmed strings, only known inspectorates). */
export function klNoteClean(o: KlNote): KlNote {
  const t = (v: unknown) => String(v ?? '').trim().slice(0, 300);
  return {
    obj: t(o.obj), hrs: t(o.hrs), ujp: t(o.ujp), ujp2: t(o.ujp2),
    insp: (o.insp ?? []).filter((k) => KL_INSP.some((x) => x[0] === k)), sq: !!o.sq,
  };
}

export interface KlNoteFirm { name: string; address?: string | null; city?: string | null; edb?: string | null; embs?: string | null; activity?: string | null; signer?: string | null; phone?: string | null }

const h = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Legacy `klNoteHTML(o)` — `img` is the uploaded sticker (URL or data URI); without it the design is drawn. */
export function klNoteHtml(o: KlNote & { img?: string | null }, f: KlNoteFirm): string {
  const sq = !!o.sq, two = sq;
  const I = KL_INSP.filter((x) => (o.insp ?? ['dpi']).includes(x[0]));
  const L = (mk: string, al: string) => (sq ? mk + ' / ' + al : mk);
  const sticker = o.img
    ? `<img src="${h(o.img)}" style="width:125mm;max-height:130mm;object-fit:contain;display:block;margin:0 auto 12px">`
    : `<div style="width:150mm;margin:0 auto 12px;border:4px solid #111;border-radius:14px;overflow:hidden;background:#f2c500"><div style="padding:18px 10px 14px"><div style="font-size:${two ? 38 : 46}pt;font-weight:900;line-height:1.05;letter-spacing:.5px">ПОБАРАЈ<br>ФИСКАЛНА<br>СМЕТКА!</div>${sq ? '<div style="font-size:22pt;font-weight:900;margin-top:8px">KËRKONI KUPONIN FISKAL!</div>' : ''}</div>
   <div style="background:#111;color:#f2c500;display:flex;align-items:center;justify-content:space-between;padding:10px 18px"><span style="font-size:30pt;line-height:1">☎</span><span style="font-size:${two ? 12 : 14}pt;font-weight:700;text-align:left;line-height:1.25;flex:1;margin-left:14px">${sq ? 'ПРИЈАВЕТЕ<br>НЕПРАВИЛНОСТИ<br><span style="font-weight:400">LAJMËRONI PARREGULLSITË</span>' : 'ПРИЈАВЕТЕ<br>НЕПРАВИЛНОСТИ'}</span><span style="font-size:58pt;font-weight:900;line-height:1">${h(o.ujp2 || '198')}</span></div>
   <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px;font-size:${two ? 9.5 : 10.5}pt"><span style="font-weight:700;text-align:left;line-height:1.2">Република Северна Македонија<br>Министерство за финансии<br>УПРАВА ЗА ЈАВНИ ПРИХОДИ</span><span style="font-style:italic;font-size:${two ? 11 : 13}pt">Твој данок, твоја иднина!</span></div></div>`;
  const insp = I.length
    ? `<div style="text-align:left;border:2px solid #b0122a;border-radius:8px;overflow:hidden;margin-bottom:14px"><div style="background:#b0122a;color:#fff;font-weight:900;font-size:${two ? 13 : 15}pt;padding:6px 12px">${L('ПРИЈАВИ НЕРЕГУЛАРНОСТИ!', 'LAJMËRO PARREGULLSITË!')}</div>${I.map((x) => `<div style="padding:6px 12px;border-top:1px solid #b0122a;font-size:${two ? 11 : 12.5}pt"><b>${h(x[1])}</b>${sq ? ' <span style="color:#555">/ ' + h(x[2]) + '</span>' : ''}<div style="display:flex;justify-content:space-between"><span>✉ ${h(x[4])}</span>${x[3] ? `<b>☎ ${h(x[3])}</b>` : ''}</div></div>`).join('')}</div>`
    : '';
  const seat = [f.address, f.city].filter(Boolean).join(', ');
  return `<div style="border:6px solid #111;padding:24px 28px;text-align:center;font-family:Arial,sans-serif;color:#111;min-height:250mm;box-sizing:border-box">
  ${sticker}
  <div style="margin:4px auto 12px;max-width:165mm;font-size:${two ? 12.5 : 15}pt;line-height:1.4"><p style="margin:0 0 6px">Купувачот е должен да побара и да ја земе фискалната сметка за купеното добро, односно за користената услуга.</p>${sq ? '<p style="margin:0">Blerësi është i detyruar të kërkojë dhe të marrë kuponin fiskal për mallin e blerë, përkatësisht për shërbimin e shfrytëzuar.</p>' : ''}</div>
  ${insp}
  <div style="border-top:2px solid #111;padding-top:10px;display:flex;gap:14px;align-items:flex-start"><div style="flex:1;font-size:${two ? 12 : 14}pt;line-height:1.55;text-align:left">
   <div><b>${L('Фирма', 'Firma')}:</b> ${h(f.name)}</div>
   ${seat ? `<div><b>${L('Седиште', 'Selia')}:</b> ${h(seat)}</div>` : ''}
   <div><b>${L('Даночен број (ЕДБ)', 'Numri tatimor (NUT)')}:</b> ${h(f.edb ?? '')}${f.embs ? ` · <b>${L('Матичен број', 'Numri amë')}:</b> ${h(f.embs)}` : ''}</div>
   ${f.activity ? `<div><b>${L('Дејност', 'Veprimtaria')}:</b> ${h(f.activity)}</div>` : ''}${f.signer ? `<div><b>${L('Одговорно лице', 'Personi përgjegjës')}:</b> ${h(f.signer)}</div>` : ''}${f.phone ? `<div><b>${L('Телефон', 'Telefoni')}:</b> ${h(f.phone)}</div>` : ''}
   ${o.obj ? `<div><b>${L('Продажен објект', 'Objekti i shitjes')}:</b> ${h(o.obj)}</div>` : ''}${o.hrs ? `<div><b>${L('Работно време', 'Orari i punës')}:</b> ${h(o.hrs)}</div>` : ''}${o.ujp ? `<div>☎ ${h(o.ujp)} – ${L('УЈП, бесплатен телефон', 'DHP, telefon falas')} · www.ujp.gov.mk</div>` : ''}</div></div></div>`;
}
