/**
 * Staff confidentiality statement (ЗЗЛП) — legacy `zzIzj` 15420 printed from Систем › Корисници („Изјава · Договор“
 * column, v514 15481) through `zzOut` / `zzHTML` (PDF, Times 12 pt) or as Word (`ncDocx`). Name, position and — when
 * the colleague is an employee of the office's own firm — ЕМБГ and address are filled in automatically (`zzPerson`).
 */

export interface IzjPerson { name: string; embg?: string | null; address?: string | null; pos?: string | null }
export interface IzjOffice { name?: string | null; city?: string | null }

/** Blocks of the statement: `h` heading, `sub` sub-heading, `p` paragraph, `pl` place/date line, `sig` signature. */
export type IzjBlock = { h: string } | { sub: string } | { p: string } | { pl: string } | { sig: [string, string][] };

const dmy = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : d);

/** Legacy `zzIzj(name, P)`. */
export function izjavaBlocks(P: IzjPerson, O: IzjOffice, date: string): { t: string; b: IzjBlock[] } {
  const name = P.name;
  return {
    t: 'Изјава за доверливост',
    b: [
      { h: 'ИЗЈАВА' }, { sub: 'за доверливост и заштита на личните податоци' },
      { p: `Јас, долупотпишаниот/ата ${name || '______________________________'}, ЕМБГ ${P.embg || '_____________'}, со живеалиште ${P.address || '______________________________'}, вработен/а во ${O.name || '________'} на работно место ${P.pos || '____________________'}, изјавувам дека:` },
      { p: '1. Личните податоци и деловните информации на клиентите до кои имам пристап при работата ќе ги обработувам само за извршување на работните задачи и според упатствата на работодавачот.' },
      { p: '2. Нема да ги откривам, копирам, изнесувам, фотографирам или на друг начин да ги правам достапни на неовластени лица, ниту за време ниту по престанокот на работниот однос.' },
      { p: '3. Ќе ги почитувам мерките за безбедност (лична лозинка и двостепена најава, работа само од одобрен компјутер, без споделување на пристапот) и веднаш ќе го известам одговорното лице за секое сомнение за нарушување на безбедноста.' },
      { p: '4. Запознаен/а сум дека повредата на оваа изјава претставува потешка повреда на работната обврска и може да повлече одговорност согласно Законот за заштита на личните податоци и другите закони.' },
      { pl: `${O.city || 'Скопје'}, ${dmy(date)} година` },
      { sig: [['Изјавил/а', name || '']] },
    ],
  };
}

const h = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Legacy `zzHTML` for the statement (wrapped like `zzOut` PDF: Times New Roman 12 pt). */
export function izjavaHtml(D: { b: IzjBlock[] }): string {
  const body = D.b.map((x) => {
    if ('h' in x) return `<h2 style="text-align:center;margin:18px 0 0">${h(x.h)}</h2>`;
    if ('sub' in x) return `<div style="text-align:center;font-weight:700;margin:0 0 14px">${h(x.sub)}</div>`;
    if ('p' in x) return `<p style="text-align:justify;margin:0 0 8px">${h(x.p)}</p>`;
    if ('pl' in x) return `<p style="margin:14px 0 6px;white-space:pre-line">${h(x.pl)}</p>`;
    return `<table class="sigrow" style="width:100%;margin-top:30px;border:0;page-break-inside:avoid;break-inside:avoid"><tr>${x.sig.length === 1 ? '<td style="border:0;width:50%"></td>' : ''}${x.sig.map(([l, n]) => `<td style="border:0;text-align:center;vertical-align:top">${h(l)}<br><br><br>______________________________<br><span style="white-space:pre-line">${h(n)}</span></td>`).join('')}</tr></table>`;
  }).join('');
  return `<div style="font-family:Times New Roman,serif;font-size:12pt;line-height:1.45">${body}</div>`;
}

/** Paragraphs for the Word file (`minimalDocx`): one run per paragraph; the signature becomes text lines. */
export function izjavaParagraphs(D: { b: IzjBlock[] }): string[][] {
  return D.b.flatMap((x): string[][] => {
    if ('h' in x) return [[x.h]];
    if ('sub' in x) return [[x.sub], ['']];
    if ('p' in x) return [[x.p]];
    if ('pl' in x) return [[''], [x.pl]];
    return x.sig.flatMap(([l, n]) => [[''], [l], [''], ['______________________________'], [n]]);
  });
}
