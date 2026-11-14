/**
 * 🌐 Invoice print in English / German: the Macedonian labels of `invoicePrintHtml` translated once, here (a fixed
 * dictionary, the same words on every invoice), and whatever Cyrillic text is left (item names, the amount in words,
 * the firm's own notes) collected for DeepL (`apps/web/lib/deepl.ts`). Names and addresses of the seller and the buyer
 * stay as written.
 *
 * Works on the finished HTML: only text between tags is touched, never attributes or styles.
 */
import { ART32_NOTE, NO_VAT_DED_NOTE } from './scan';
import { INV_NOTE0 } from './docs';

export type InvoiceLang = 'EN' | 'DE';
export const isInvoiceLang = (v: unknown): v is InvoiceLang => v === 'EN' || v === 'DE';

/** [Macedonian, English, German] — longer phrases first is not needed (sorted below). */
const DICT: readonly (readonly [string, string, string])[] = [
  // titles
  ['АВАНСНА ФАКТУРА', 'ADVANCE INVOICE', 'ANZAHLUNGSRECHNUNG'],
  ['ФАКТУРА', 'INVOICE', 'RECHNUNG'],
  ['КНИЖНО ОДОБРЕНИЕ', 'CREDIT NOTE', 'GUTSCHRIFT'],
  ['ПРОФАКТУРА', 'PROFORMA INVOICE', 'PROFORMARECHNUNG'],
  // meta
  ['Датум на промет', 'Date of supply', 'Leistungsdatum'],
  ['Рок на плаќање', 'Payment due', 'Zahlungsziel'],
  ['Важи до', 'Valid until', 'Gültig bis'],
  ['Врска', 'Reference', 'Bezug'],
  ['По документ', 'Per document', 'Laut Dokument'],
  ['Кон фактура', 'Related invoice', 'Zur Rechnung'],
  ['Испратница', 'Delivery note', 'Lieferschein'],
  ['Профактура', 'Proforma invoice', 'Proformarechnung'],
  ['Фактура', 'Invoice', 'Rechnung'],
  ['Валута', 'Currency', 'Währung'],
  ['курс', 'rate', 'Kurs'],
  ['Датум', 'Date', 'Datum'],
  ['Број', 'Number', 'Nummer'],
  ['бр.', 'No.', 'Nr.'],
  ['од', 'of', 'vom'],
  // parties
  ['Купувач', 'Buyer', 'Käufer'],
  ['Фактурирано на', 'Billed to', 'Rechnung an'],
  ['Одобрение за', 'Credit note for', 'Gutschrift für'],
  ['Место на издавање', 'Place of issue', 'Ausstellungsort'],
  ['Место на испорака', 'Place of delivery', 'Lieferort'],
  ['Повикување на број', 'Payment reference', 'Verwendungszweck'],
  ['Жиро сметка', 'Bank account', 'Bankkonto'],
  ['жиро сметка', 'bank account', 'Bankkonto'],
  ['ЕДБ', 'VAT ID', 'USt-IdNr.'],
  ['ЕМБС', 'Reg. No.', 'Reg.-Nr.'],
  ['Тел.', 'Tel.', 'Tel.'],
  ['QR – податоци за плаќање', 'QR – payment data', 'QR – Zahlungsdaten'],
  ['QR за плаќање', 'QR payment', 'QR-Zahlung'],
  // table
  ['Р.б.', 'No.', 'Pos.'],
  ['Опис', 'Description', 'Beschreibung'],
  ['Ед.м.', 'Unit', 'Einh.'],
  ['Кол.', 'Qty', 'Menge'],
  ['Цена без ДДВ', 'Price excl. VAT', 'Preis netto'],
  ['Цена', 'Price', 'Preis'],
  ['Рабат', 'Discount', 'Rabatt'],
  ['Износ без ДДВ', 'Amount excl. VAT', 'Nettobetrag'],
  ['ДДВ %', 'VAT %', 'USt. %'],
  ['Вкупно', 'Total', 'Gesamt'],
  ['шифра', 'code', 'Code'],
  ['Стапка', 'Rate', 'Satz'],
  ['Основица', 'Tax base', 'Bemessungsgrundlage'],
  ['основица', 'base', 'Grundlage'],
  ['данок', 'tax', 'Steuer'],
  ['ДДВ', 'VAT', 'USt.'],
  ['пренесена обврска', 'reverse charge', 'Steuerschuldumkehr'],
  ['Одбиен аванс ф-ра', 'Advance deducted, inv.', 'Abzug Anzahlung, Rg.'],
  ['Одбиен аванс', 'Advance deducted', 'Abzug Anzahlung'],
  ['ЗА ПЛАЌАЊЕ', 'AMOUNT DUE', 'ZAHLBETRAG'],
  ['ИЗНОС НА ОДОБРЕНИЕТО', 'CREDIT AMOUNT', 'GUTSCHRIFTSBETRAG'],
  ['Денарска противвредност', 'Equivalent in MKD', 'Gegenwert in MKD'],
  ['Со зборови:', 'In words:', 'In Worten:'],
  ['Со зборови', 'In words', 'In Worten'],
  ['Плаќање', 'Payment', 'Zahlung'],
  ['рок до', 'due by', 'fällig bis'],
  ['повикување на број', 'reference', 'Verwendungszweck'],
  ['со повикување на број', 'with reference', 'mit Verwendungszweck'],
  ['на', 'to', 'auf'],
  ['кај', 'at', 'bei'],
  ['до', 'by', 'bis'],
  ['ден.', 'MKD', 'MKD'],
  ['Напомена', 'Note', 'Hinweis'],
  ['НАПОМЕНА:', 'NOTE:', 'HINWEIS:'],
  // signatures
  ['Фактурирал', 'Issued by', 'Ausgestellt von'],
  ['Изготвил', 'Prepared by', 'Erstellt von'],
  ['Управител', 'Manager', 'Geschäftsführer'],
  ['Примил', 'Received by', 'Empfangen von'],
  ['М.П.', 'Stamp', 'Stempel'],
  // debt block
  ['Неплатени претходни фактури:', 'Unpaid previous invoices:', 'Offene frühere Rechnungen:'],
  ['Претходен долг:', 'Previous debt:', 'Bisherige Schuld:'],
  ['Вкупен долг со оваа фактура:', 'Total debt incl. this invoice:', 'Gesamtschuld inkl. dieser Rechnung:'],
  ['и уште', 'and', 'und weitere'],
  // units
  ['ком', 'pcs', 'Stk.'],
  ['кг', 'kg', 'kg'],
  ['час', 'h', 'Std.'],
  ['месец', 'month', 'Monat'],
  ['услуга', 'service', 'Leistung'],
  ['пар', 'pair', 'Paar'],
  ['л', 'l', 'l'],
  ['м', 'm', 'm'],
  // fixed sentences
  ['Извоз – ослободено од ДДВ согласно член 24 од ЗДДВ.', 'Export – exempt from VAT under Article 24 of the VAT Law.', 'Ausfuhr – gemäß Artikel 24 des MwSt-Gesetzes von der Umsatzsteuer befreit.'],
  [ART32_NOTE, 'Reverse charge – VAT is accounted for by the recipient under Article 32-a of the VAT Law', 'Steuerschuldnerschaft des Leistungsempfängers – die Umsatzsteuer schuldet der Empfänger gemäß Artikel 32-a des MwSt-Gesetzes'],
  [NO_VAT_DED_NOTE, 'Exempt from VAT with the right to deduct under Article 24 of the VAT Law', 'Von der Umsatzsteuer befreit mit Vorsteuerabzug gemäß Artikel 24 des MwSt-Gesetzes'],
  ['го пресметува и плаќа примателот.', 'is calculated and paid by the recipient.', 'wird vom Empfänger berechnet und abgeführt.'],
  ['Фирмата не е регистрирана за ДДВ – ДДВ не е пресметан.', 'The company is not registered for VAT – no VAT charged.', 'Das Unternehmen ist nicht umsatzsteuerpflichtig – keine USt. berechnet.'],
  ['Профактурата служи за плаќање однапред и не е даночна фактура.', 'This proforma invoice is for advance payment and is not a tax invoice.', 'Diese Proformarechnung dient der Vorauszahlung und ist keine Steuerrechnung.'],
  ['Ве одобруваме за горенаведениот износ. Одобрението го намалува Вашиот долг по наведената фактура. Ве молиме за истиот износ да го намалите претходниот данок.',
    'We credit you with the above amount. The credit note reduces your debt under the stated invoice. Please reduce your input VAT by the same amount.',
    'Wir schreiben Ihnen den obigen Betrag gut. Die Gutschrift mindert Ihre Schuld aus der genannten Rechnung. Bitte kürzen Sie Ihre Vorsteuer um denselben Betrag.'],
  ['Ве одобруваме за горенаведениот износ. Одобрението го намалува Вашиот долг по наведената фактура.',
    'We credit you with the above amount. The credit note reduces your debt under the stated invoice.',
    'Wir schreiben Ihnen den obigen Betrag gut. Die Gutschrift mindert Ihre Schuld aus der genannten Rechnung.'],
  ['Фактурата е издадена во електронска форма и е потпишана со квалификуван електронски потпис, согласно член 53-б од Законот за данокот на додадена вредност; не содржи печат.',
    'This invoice was issued electronically and signed with a qualified electronic signature under Article 53-b of the Value Added Tax Law; it bears no stamp.',
    'Diese Rechnung wurde elektronisch ausgestellt und gemäß Artikel 53-b des Mehrwertsteuergesetzes mit einer qualifizierten elektronischen Signatur unterzeichnet; sie trägt keinen Stempel.'],
  ['Печатот не е задолжителен елемент на фактурата (член 53 од Законот за данокот на додадена вредност); фактурата е валидна со потпис на овластеното лице.',
    'A stamp is not a mandatory element of the invoice (Article 53 of the Value Added Tax Law); the invoice is valid with the signature of the authorised person.',
    'Ein Stempel ist kein Pflichtbestandteil der Rechnung (Artikel 53 des Mehrwertsteuergesetzes); die Rechnung ist mit der Unterschrift der bevollmächtigten Person gültig.'],
  [INV_NOTE0,
    'Complaints about this invoice are accepted only in writing, within 7 days of receipt at the latest. If the invoice is not paid by the due date, you will be charged for any changes in the exchange rate. In case of dispute, the Basic Court Skopje 2 – Skopje shall have jurisdiction.',
    'Reklamationen zu dieser Rechnung werden ausschließlich schriftlich und spätestens 7 Tage nach Erhalt angenommen. Wird die Rechnung nicht fristgerecht bezahlt, werden Ihnen alle Wechselkursänderungen zusätzlich belastet. Gerichtsstand ist das Grundgericht Skopje 2 – Skopje.'],
];

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ESC[c]!);
const unesc = (v: string) => v.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' } as Record<string, string>)[e]!);
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CYR = /[Ѐ-ӿ]/;

const SORTED = [...DICT].sort((a, b) => b[0].length - a[0].length);
const LONG = SORTED.filter((r) => r[0].length >= 30), SHORT = SORTED.filter((r) => r[0].length < 30);
const RX = new Map<string, RegExp>(SORTED.map(([mk]) => [mk, new RegExp(`(?<![\\p{L}])${reEsc(esc(mk))}(?![\\p{L}])`, 'gu')]));

/** Fixed dictionary on one (escaped) text node. Names in `keep` are masked so a word inside a name stays as it is. */
function dictNode(t: string, lang: InvoiceLang, keep: readonly string[]): string {
  const masks: string[] = [];
  const col = lang === 'EN' ? 1 : 2;
  let s = t;
  // whole sentences first (they may contain a name, e.g. „Основен суд Скопје“)
  for (const row of LONG) s = s.replace(RX.get(row[0])!, () => esc(row[col]));
  for (const k of keep) {
    const ek = esc(k);
    if (ek && s.includes(ek)) { s = s.split(ek).join(`\u0001${masks.length}\u0002`); masks.push(ek); }
  }
  for (const row of SHORT) s = s.replace(RX.get(row[0])!, () => esc(row[col]));
  return s.replace(/\u0001(\d+)\u0002/g, (_, i: string) => masks[Number(i)]!);
}

const keepList = (keep: readonly (string | null | undefined)[]) =>
  [...new Set(keep.map((k) => String(k ?? '').trim()).filter((k) => k.length > 1))].sort((a, b) => b.length - a.length);

/** Does a text node still need DeepL (Cyrillic left once the names / addresses are taken out)? */
const needsMt = (t: string, keep: readonly string[]) => {
  let s = unesc(t);
  for (const k of keep) s = s.split(k).join(' ');
  return CYR.test(s);
};

/**
 * Pass 1: the fixed labels translated; returns the HTML and the texts still in Cyrillic (unescaped, unique) for DeepL.
 * `keep`: the seller's and buyer's name, address, city (never translated).
 */
export function localizeInvoiceHtml(html: string, lang: InvoiceLang, keep0: readonly (string | null | undefined)[]): { html: string; rest: string[] } {
  const keep = keepList(keep0);
  const parts = html.split(/(<[^>]*>)/);
  const rest = new Set<string>();
  let inStyle = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.startsWith('<')) { inStyle = /^<(style|script)\b/i.test(p) ? true : /^<\/(style|script)/i.test(p) ? false : inStyle; continue; }
    if (inStyle || !CYR.test(p)) continue;
    const t = dictNode(p, lang, keep);
    // a node the dictionary does not cover whole (item names, the amount in words, own notes) goes to DeepL as written
    if (needsMt(t, keep)) rest.add(unesc(p).trim());
    else parts[i] = t;
  }
  // a lone letter (the logo placeholder) is not worth a DeepL call
  return { html: parts.join(''), rest: [...rest].filter((x) => x.replace(/[^\p{L}]/gu, '').length > 1) };
}

/** Pass 2: put DeepL's translations (unescaped text → translation) into the text nodes. */
export function applyInvoiceTranslations(html: string, tr: ReadonlyMap<string, string>): string {
  if (!tr.size) return html;
  const parts = html.split(/(<[^>]*>)/);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.startsWith('<') || !CYR.test(p)) continue;
    const raw = unesc(p), key = raw.trim();
    const t = tr.get(key);
    if (t != null) parts[i] = esc(raw.slice(0, raw.indexOf(key)) + t + raw.slice(raw.indexOf(key) + key.length));
  }
  return parts.join('');
}

/** Title of the print in the chosen language (the tab / PDF name). */
export const invoiceLangLabel = (l: InvoiceLang) => (l === 'EN' ? 'англиски' : 'германски');
