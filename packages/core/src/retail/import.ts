/**
 * Generic Excel / CSV / XML import (legacy `IMP_T` 5381, `impN`, `impAuto`, `impHeaderRow`, `detectDec`, `impNum`,
 * `impDate`, and the stock-list imports `lagParse` 4945). Column recognition works on Macedonian, Albanian and English
 * headers. Rows are arrays of cell values (string | number | Date).
 */

export type ImpType = 'partners' | 'items' | 'employees' | 'purchases' | 'invoices' | 'stock' | 'journal' | 'in' | 'pop' | 'nivel';
/** [key, label (`*` = required), synonyms]. */
export type ImpField = readonly [string, string, string];

export const IMP_T: Readonly<Record<ImpType, { t: string; f: readonly ImpField[]; note: string }>> = {
  partners: { t: 'Комитенти (купувачи и добавувачи)', note: 'Постоечките комитенти (ист ЕДБ или назив) се ажурираат, новите се додаваат.', f: [['name', 'Назив*', 'назив,име,name,emri,kompania,firma,партнер,комитент,купувач,добавувач'], ['edb', 'ЕДБ', 'едб,edb,даночен,tax,vat,nipt,nui'], ['code', 'Шифра', 'шифра,code,kodi,sifra'], ['address', 'Адреса', 'адреса,address,adresa'], ['city', 'Град', 'град,city,qyteti,место'], ['bank', 'Жиро сметка', 'жиро,сметка,account,iban,llogaria,banka'], ['email', 'E-mail', 'email,e-mail,пошта'], ['phone', 'Телефон', 'телефон,phone,tel'], ['ddv', 'ДДВ обврзник (да/не)', 'ддв обврзник,vat payer,tvsh']] },
  items: { t: 'Артикли и услуги', note: 'Постоечките артикли (иста шифра или баркод) се ажурираат, новите се додаваат.', f: [['name', 'Назив*', 'назив,име,артикл,производ,name,emri,artikulli,produkti'], ['code', 'Шифра', 'шифра,code,kodi,sifra,šifra'], ['barcode', 'Баркод', 'баркод,barcode,ean,barkodi'], ['unit', 'Ед. мерка', 'мерка,ем,unit,njesia,ед'], ['price', 'Продажна цена без ДДВ', 'продажна,цена,price,cmimi,мпц'], ['rate', 'ДДВ %', 'ддв,vat,tvsh,стапка,tarifa'], ['type', 'Вид (стока/услуга/материјал/производ)', 'вид,type,lloji'], ['min', 'Минимална залиха', 'минимална,min'], ['weight', 'Тежина (кг)', 'тежина,weight,pesha,маса,kg'], ['oe', 'OE броеви', 'oe,оригинален број,oem,oe number'], ['cross', 'Замени', 'замени,cross,еквивалент,zevendes'], ['fits', 'Возила', 'возила,vozila,fits,makina,vehicle']] },
  employees: { t: 'Вработени', note: 'Постоечките вработени (ист ЕМБГ) се ажурираат.', f: [['name', 'Име и презиме*', 'име,презиме,name,emri,mbiemri,вработен,punetori'], ['embg', 'ЕМБГ', 'ембг,embg,matični,nr personal'], ['position', 'Работно место', 'работно место,позиција,position,pozita,vendi'], ['netBase', 'Нето плата', 'нето,плата,net,paga,rroga'], ['start', 'Датум на вработување', 'вработување,почеток,start,fillimi,data e punesimit'], ['end', 'Договор до', 'договор до,end,mbarimi,до'], ['bankAcc', 'Сметка за плата', 'сметка,account,llogaria,iban'], ['bank', 'Банка', 'банка,bank,banka'], ['address', 'Адреса', 'адреса,address,adresa'], ['city', 'Град', 'град,city,qyteti,место'], ['coef', 'Коефициент (скратено време)', 'коеф,coef,koef'], ['email', 'Е-пошта', 'е-пошта,email,mail,e-mail']] },
  purchases: { t: 'Влезни фактури (износи по стапки)', note: 'Секој ред = една влезна фактура; се книжи автоматски (налог 2/…). Добавувачите што ги нема се додаваат. Фактури што веќе постојат се прескокнуваат.', f: [['number', 'Број на фактура*', 'број,бр,фактура,number,nr,numri,invoice'], ['date', 'Датум*', 'датум,date,data'], ['partner', 'Добавувач*', 'добавувач,партнер,комитент,supplier,furnitori,name,назив'], ['edb', 'ЕДБ', 'едб,edb,nipt,tax'], ['due', 'Валута / рок', 'валута,рок,due,afati'], ['base18', 'Основица 18%', 'основица 18,osnovica 18,base 18,baza 18'], ['vat18', 'ДДВ 18%', 'ддв 18,vat 18,tvsh 18'], ['base10', 'Основица 10%', 'основица 10,base 10,baza 10'], ['vat10', 'ДДВ 10%', 'ддв 10,vat 10,tvsh 10'], ['base5', 'Основица 5%', 'основица 5,base 5,baza 5'], ['vat5', 'ДДВ 5%', 'ддв 5,vat 5,tvsh 5'], ['base0', 'Износ без ДДВ / 0%', 'ослободен,0%,без ддв,pa tvsh'], ['total', 'Вкупно', 'вкупно,total,gjithsej,за плаќање'], ['konto', 'Конто', 'конто,konto,account']] },
  invoices: { t: 'Излезни фактури (ставки)', note: 'Редовите со ист број на фактура се спојуваат во една фактура со повеќе ставки; стоката се раздолжува од магацин.', f: [['number', 'Број на фактура*', 'број,бр,фактура,number,nr,numri'], ['date', 'Датум*', 'датум,date,data'], ['partner', 'Купувач*', 'купувач,партнер,комитент,customer,bleresi,klienti,назив'], ['edb', 'ЕДБ', 'едб,edb,nipt'], ['due', 'Рок за плаќање', 'рок,валута,due,afati'], ['code', 'Шифра артикл', 'шифра,code,kodi'], ['item', 'Артикл / опис', 'артикл,опис,назив на артикл,item,description,pershkrimi,artikulli'], ['qty', 'Количина', 'количина,кол,qty,sasia'], ['price', 'Цена без ДДВ', 'цена,price,cmimi'], ['disc', 'Рабат %', 'рабат,discount,zbritja'], ['rate', 'ДДВ %', 'ддв,vat,tvsh,стапка']] },
  stock: { t: 'Почетна залиха', note: 'Се внесува почетна залиха по артикл (приемница). Артиклите што ги нема се додаваат.', f: [['code', 'Шифра*', 'шифра,code,kodi'], ['barcode', 'Баркод', 'баркод,barcode,ean,barkodi'], ['name', 'Назив', 'назив,name,emri,артикл'], ['qty', 'Количина*', 'количина,qty,sasia,залиха'], ['cost', 'Набавна цена', 'набавна,cost,kosto,cena'], ['wh', 'Објект (шифра)', 'објект,магацин,warehouse,magazina']] },
  journal: { t: 'Налог за книжење (ставки)', note: 'Редовите со ист број на налог (или ист датум) се спојуваат во еден налог; мора да е во рамнотежа.', f: [['no', 'Број на налог', 'налог,број,nr'], ['date', 'Датум*', 'датум,date,data'], ['k', 'Конто*', 'конто,konto,account,llogaria'], ['d', 'Должи', 'должи,debit,debi,d'], ['p', 'Побарува', 'побарува,credit,kredi,p'], ['partner', 'Комитент', 'комитент,партнер,partner'], ['desc', 'Опис', 'опис,desc,description,pershkrimi']] },
  in: { t: 'Приемница / почетна залиха во објект (количина + набавна цена + МПЦ)', note: 'Приемница во избраниот објект, без книжење (почетна состојба). Непознатите шифри се креираат како нови артикли. Во продавница МПЦ се поставува кога артиклот нема залиха.', f: [['code', 'Шифра', 'шифра,code,kodi,sifra'], ['barcode', 'Баркод', 'баркод,barcode,ean,barkodi'], ['name', 'Назив', 'назив,name,emri,артикл,производ'], ['qty', 'Количина*', 'количина,кол,qty,sasia,залиха'], ['cost', 'Набавна цена', 'набавна,nabavna,cost,kosto'], ['amount', 'Набавна вредност', 'износ,вредност,amount,vlera'], ['mpc', 'МПЦ со ДДВ', 'мпц,малопрод,продажна цена со,mpc,cmim shitje']] },
  pop: { t: 'Попис во објект (пописани количини)', note: 'Кусок / вишок се пресметува автоматски; артиклите што не се во датотеката ја задржуваат состојбата.', f: [['code', 'Шифра', 'шифра,code,kodi,sifra'], ['barcode', 'Баркод', 'баркод,barcode,ean,barkodi'], ['name', 'Назив', 'назив,name,emri,артикл'], ['cnt', 'Пописано*', 'пописано,попис,количина,кол,qty,sasia']] },
  nivel: { t: 'Нови малопродажни цени → нивелација', note: 'Нивелација во избраната продавница со датум денес (или крајот на годината); количината е залихата на тој ден.', f: [['code', 'Шифра', 'шифра,code,kodi,sifra'], ['barcode', 'Баркод', 'баркод,barcode,ean,barkodi'], ['name', 'Назив', 'назив,name,emri,артикл'], ['mpc', 'Нова МПЦ со ДДВ*', 'мпц,нова цена,малопрод,цена,price,cmim']] },
};

/** Example row of the downloadable template (legacy `impTpl`). */
export const IMP_EXAMPLE: Readonly<Record<ImpType, readonly string[]>> = {
  partners: ['Пример ДООЕЛ', '4030000000000', '', 'ул. Пример 1', 'Скопје', '200000000000000', 'info@primer.mk', '070000000', 'да'],
  items: ['Кафе 200г', '101', '5310000000000', 'ком', '120', '18', 'стока', '10'],
  employees: ['Петар Петровски', '0101990450000', 'Возач', '30000', '01.09.2026', '', '210000000000000', 'Стопанска', 'ул. Пример 1', 'Скопје', '1', 'petar@primer.mk'],
  purchases: ['F-123', '15.09.2026', 'Добавувач ДООЕЛ', '4030000000000', '15.10.2026', '1000', '180', '', '', '500', '25', '', '1705', '4000'],
  invoices: ['001/2026', '15.09.2026', 'Купувач ДОО', '4030000000000', '15.10.2026', '101', 'Кафе 200г', '10', '120', '0', '18'],
  stock: ['101', '', 'Кафе 200г', '50', '85', '01'],
  journal: ['1', '01.01.2026', '1000', '10000', '', '', 'Почетна'],
  in: ['101', '', 'Кафе 200г', '50', '85', '', '150'],
  pop: ['101', '', 'Кафе 200г', '48'],
  nivel: ['101', '', 'Кафе 200г', '140'],
};

/** Legacy `impN`: lower-case, anything but letters/digits/% → space. */
export const impN = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^0-9a-zа-шѓќљњџѕјëç%]+/gi, ' ').trim();

/** Column index per field: exact synonym first, then a synonym (> 2 chars) contained in the header (legacy `impAuto`). */
export function impAuto(t: ImpType, hdr: readonly unknown[]): Record<string, number> {
  const H = hdr.map(impN);
  const map: Record<string, number> = {};
  const used = new Set<number>();
  for (const [k, , syn] of IMP_T[t].f) {
    const S2 = syn.split(',').map(impN);
    let best = -1;
    H.forEach((x, i) => { if (!used.has(i) && best < 0 && S2.some((s) => x === s)) best = i; });
    if (best < 0) H.forEach((x, i) => { if (!used.has(i) && best < 0 && S2.some((s) => s.length > 2 && (x.startsWith(s) || x.includes(s)))) best = i; });
    if (best >= 0) { map[k] = best; used.add(best); }
  }
  return map;
}

export type DecMode = 'comma' | 'dot' | '';

/** Legacy `detectDec`: decimal separator used in the file's numeric text cells. */
export function detectDec(rows: readonly (readonly unknown[])[]): DecMode {
  let c = 0, d = 0;
  for (const r of rows) for (const x of r) {
    if (typeof x !== 'string') continue;
    const t = x.trim().replace(/\s/g, '');
    if (!/^-?[\d.,]+$/.test(t) || !/\d/.test(t)) continue;
    if (/\d\.\d{3},\d/.test(t) || /^-?\d+,\d{1,2}$/.test(t) || /^-?\d+,\d{4,}$/.test(t)) c++;
    else if (/\d,\d{3}\.\d/.test(t) || /^-?\d+\.\d{1,2}$/.test(t) || /^-?\d+\.\d{4,}$/.test(t)) d++;
  }
  return c > d * 2 && c ? 'comma' : d > c * 2 && d ? 'dot' : '';
}

/** Legacy `impNum`: a number from a cell, honouring the detected decimal separator; 0 when empty or invalid. */
export function impNum(v: unknown, dec: DecMode = ''): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let t = String(v ?? '').trim().replace(/\s|ден\.?|mkd/gi, '');
  if (!t) return 0;
  if (dec === 'comma') { const n = parseFloat(t.replace(/\./g, '').replace(',', '.')); return Number.isNaN(n) ? 0 : n; }
  if (dec === 'dot') { const n = parseFloat(t.replace(/,/g, '')); return Number.isNaN(n) ? 0 : n; }
  if (/,\d{1,2}$/.test(t) || /\.\d{3},/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = parseFloat(t);
  return Number.isNaN(n) ? 0 : n;
}

/** Legacy `impDate`: Date, Excel serial, `YYYY-M-D` or `D.M.YYYY` / `D/M/YY` → `YYYY-MM-DD`, else `''`. */
export function impDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return new Date(v.getTime() - v.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
  const t = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return m[1] + '-' + m[2]!.padStart(2, '0') + '-' + m[3]!.padStart(2, '0');
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(t);
  if (m) return (m[3]!.length === 2 ? '20' + m[3] : m[3]) + '-' + m[2]!.padStart(2, '0') + '-' + m[1]!.padStart(2, '0');
  return '';
}

/** Legacy `impHeaderRow`: among the first 15 rows, the one with the most non-numeric text cells. */
export function impHeaderRow(rows: readonly (readonly unknown[])[]): number {
  let bi = 0, bs = -1;
  rows.slice(0, 15).forEach((r, i) => {
    const sc = r.filter((c) => typeof c === 'string' && c.trim() && Number.isNaN(Number(c.replace(',', '.')))).length;
    if (sc > bs) { bs = sc; bi = i; }
  });
  return bi;
}

/** Required fields of a type that are not mapped. */
export const impMissing = (t: ImpType, map: Readonly<Record<string, number | undefined>>): string[] =>
  IMP_T[t].f.filter(([k, n]) => n.includes('*') && map[k] == null).map(([, n]) => n.replace('*', ''));

/** Item type from a text cell (legacy: услуг/sherb/serv → service, матер → material, произв → product, else goods). */
export function impItemType(s: string): 'service' | 'material' | 'product' | 'goods' {
  const t = s.toLowerCase();
  return /услуг|sherb|serv/.test(t) ? 'service' : /матер|mater/.test(t) ? 'material' : /произв|prod/.test(t) ? 'product' : 'goods';
}

/** Yes-like cell (legacy `/^(да|po|yes|y|1|true|x)/i`). */
export const impYes = (s: string): boolean => /^(да|po|yes|y|1|true|x)/i.test(s.trim());

/** Purchase VAT groups from a row (legacy `impExec` purchases): 18/10/5 bases (+ VAT or computed), 0 %, or total / 1.18. */
export function impPurchaseGroups(get: (k: string) => number, has: (k: string) => boolean, konto: string): { account: string; rate: number; base: number; vat: number }[] {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const G: { account: string; rate: number; base: number; vat: number }[] = [];
  for (const rt of [18, 10, 5]) {
    const b = get('base' + rt);
    if (b) G.push({ account: konto, rate: rt, base: r2(b), vat: r2(has('vat' + rt) ? get('vat' + rt) : (b * rt) / 100) });
  }
  const b0 = get('base0');
  if (b0) G.push({ account: konto, rate: 0, base: r2(b0), vat: 0 });
  const tot = get('total');
  if (!G.length && tot) G.push({ account: konto, rate: 18, base: r2(tot / 1.18), vat: r2(tot - tot / 1.18) });
  return G;
}
