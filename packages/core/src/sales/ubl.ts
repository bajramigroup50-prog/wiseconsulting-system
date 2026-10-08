/**
 * UBL 2.1 e-invoice export (legacy `ublXml`, 5117) and import (legacy `ublToScan`, 5398).
 */
import { r2 } from '../money';
import type { InvoiceItem } from '../posting';
import { ART32_TXT, reverseChargeVat } from '../vat';
import { invoiceTotals } from './docs';
import { parseXml, xmlAll, xmlOne, xmlText } from './xml';
import type { ScanInvoice } from './scan';

const xe = (v: unknown) => String(v ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
const n2 = (v: number) => r2(v).toFixed(2);

export interface UblParty { name: string; address?: string | null; city?: string | null; edb?: string | null; embs?: string | null; vatRegistered?: boolean; country?: string | null }
export interface UblInvoice {
  number: string;
  date: string;
  /** Tax point (датум на промет). */
  pdate?: string | null;
  due?: string | null;
  credit?: boolean;
  art32?: boolean;
  /** Document currency (default MKD); item prices are in this currency. */
  cur?: string | null;
  items: (InvoiceItem & { code?: string | null })[];
  advances?: Parameters<typeof invoiceTotals>[0]['advances'];
  /** Credit note → number of the corrected invoice. */
  refNumber?: string | null;
}
export interface UblOptions { nonVat?: boolean; bankAccount?: string | null }

/** Unit of measure → UN/ECE rec. 20 code. */
export function unitCode(unit: string | null | undefined): string {
  const u = String(unit ?? '').toLowerCase().replace(/\.$/, '').trim();
  if (['ком', 'парче', 'pcs', 'pc', 'kom'].includes(u)) return 'H87';
  if (['кг', 'kg'].includes(u)) return 'KGM';
  if (['г', 'гр', 'g'].includes(u)) return 'GRM';
  if (['л', 'лит', 'l', 'lit'].includes(u)) return 'LTR';
  if (['м', 'm'].includes(u)) return 'MTR';
  if (['м2', 'm2'].includes(u)) return 'MTK';
  if (['м3', 'm3'].includes(u)) return 'MTQ';
  if (['час', 'h', 'ч'].includes(u)) return 'HUR';
  if (['ден', 'day'].includes(u)) return 'DAY';
  if (['пак', 'pak', 'пакет'].includes(u)) return 'PK';
  return 'C62';
}

/** Tax id as used in PartyTaxScheme: `MK` + 13-digit ЕДБ for VAT payers. */
const taxId = (edb: string | null | undefined) => {
  const d = String(edb ?? '').replace(/^MK/i, '').replace(/\D/g, '');
  return d ? 'MK' + d : '';
};

/**
 * UBL 2.1 Invoice / CreditNote.
 * FIX (LEGACY-MAP 3.4 item 7): credit notes are a `CreditNote` document (type 381, `CreditNoteLine`,
 * `CreditedQuantity`, `BillingReference` to the invoice) instead of an `<Invoice>` with code 381; `PayableAmount`
 * deducts advances (`PrepaidAmount`) and is the base only for art. 32-a; line amounts are rounded to cents; real
 * unit codes instead of always C62; `CompanyID` is `MK` + ЕДБ; the document currency is the invoice currency.
 * FIX (item 6): a non-VAT firm emits no VAT (category `O`, 0%), consistent with `calcLines`.
 */
export function ublXml(inv: UblInvoice, seller: UblParty, buyer: UblParty, opts: UblOptions = {}): string {
  const cur = (inv.cur || 'MKD').toUpperCase();
  const C = `currencyID="${xe(cur)}"`;
  const T = invoiceTotals({ items: inv.items, art32: inv.art32, credit: inv.credit, advances: inv.advances }, { nonVat: opts.nonVat });
  const cat = (r: number) => (opts.nonVat ? 'O' : inv.art32 ? 'AE' : r > 0 ? 'S' : 'Z');
  const pct = (r: number) => (opts.nonVat || inv.art32 ? 0 : r);
  const party = (x: UblParty, tag: string) => `<cac:${tag}><cac:Party><cac:PartyName><cbc:Name>${xe(x.name)}</cbc:Name></cac:PartyName><cac:PostalAddress><cbc:StreetName>${xe(x.address ?? '')}</cbc:StreetName>${x.city ? `<cbc:CityName>${xe(x.city)}</cbc:CityName>` : ''}<cac:Country><cbc:IdentificationCode>${xe(x.country || 'MK')}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>${x.edb && x.vatRegistered !== false ? `<cac:PartyTaxScheme><cbc:CompanyID>${xe(taxId(x.edb))}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}<cac:PartyLegalEntity><cbc:RegistrationName>${xe(x.name)}</cbc:RegistrationName>${x.embs ? `<cbc:CompanyID>${xe(x.embs)}</cbc:CompanyID>` : ''}</cac:PartyLegalEntity></cac:Party></cac:${tag}>`;
  const root = inv.credit ? 'CreditNote' : 'Invoice';
  const line = inv.credit ? 'CreditNoteLine' : 'InvoiceLine';
  const qtyTag = inv.credit ? 'CreditedQuantity' : 'InvoicedQuantity';
  const notes = [inv.art32 ? ART32_TXT + (opts.nonVat ? '' : `; ДДВ ${n2(reverseChargeVat(T.base))} го пресметува примателот`) : ''].filter(Boolean);
  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:ID>${xe(inv.number)}</cbc:ID><cbc:IssueDate>${xe(inv.date)}</cbc:IssueDate>${!inv.credit && inv.due ? `<cbc:DueDate>${xe(inv.due)}</cbc:DueDate>` : ''}<cbc:${root}TypeCode>${inv.credit ? 381 : 380}</cbc:${root}TypeCode>${notes.map((n) => `<cbc:Note>${xe(n)}</cbc:Note>`).join('')}<cbc:TaxPointDate>${xe(inv.pdate || inv.date)}</cbc:TaxPointDate><cbc:DocumentCurrencyCode>${xe(cur)}</cbc:DocumentCurrencyCode>
${inv.credit && inv.refNumber ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${xe(inv.refNumber)}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>\n` : ''}${party(seller, 'AccountingSupplierParty')}
${party(buyer, 'AccountingCustomerParty')}
<cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>${inv.credit ? '' : inv.due ? `<cbc:PaymentDueDate>${xe(inv.due)}</cbc:PaymentDueDate>` : ''}<cbc:PaymentID>${xe(inv.number)}</cbc:PaymentID><cac:PayeeFinancialAccount><cbc:ID>${xe(opts.bankAccount ?? '')}</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
<cac:TaxTotal><cbc:TaxAmount ${C}>${n2(T.vat)}</cbc:TaxAmount>${T.by.map((g) => `<cac:TaxSubtotal><cbc:TaxableAmount ${C}>${n2(g.base)}</cbc:TaxableAmount><cbc:TaxAmount ${C}>${n2(g.vat)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>${cat(g.rate)}</cbc:ID><cbc:Percent>${pct(g.rate)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`).join('')}</cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount ${C}>${n2(T.base)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount ${C}>${n2(T.base)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount ${C}>${n2(inv.art32 ? T.base : T.total)}</cbc:TaxInclusiveAmount>${T.advTotal ? `<cbc:PrepaidAmount ${C}>${n2(T.advTotal)}</cbc:PrepaidAmount>` : ''}<cbc:PayableAmount ${C}>${n2(T.pay)}</cbc:PayableAmount></cac:LegalMonetaryTotal>
${inv.items.map((it, i) => {
  const b = r2((Number(it.qty) || 0) * (Number(it.price) || 0) * (1 - (Number(it.disc) || 0) / 100));
  const r = inv.art32 ? 18 : opts.nonVat ? 0 : Number(it.rate) || 0;
  return `<cac:${line}><cbc:ID>${i + 1}</cbc:ID><cbc:${qtyTag} unitCode="${unitCode(it.unit)}">${Number(it.qty) || 0}</cbc:${qtyTag}><cbc:LineExtensionAmount ${C}>${n2(b)}</cbc:LineExtensionAmount><cac:Item><cbc:Name>${xe(it.name)}</cbc:Name>${it.code ? `<cac:SellersItemIdentification><cbc:ID>${xe(it.code)}</cbc:ID></cac:SellersItemIdentification>` : ''}<cac:ClassifiedTaxCategory><cbc:ID>${cat(r)}</cbc:ID><cbc:Percent>${pct(r)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount ${C}>${Math.round((Number(it.price) || 0) * 1e4) / 1e4}</cbc:PriceAmount></cac:Price></cac:${line}>`;
}).join('\n')}
</${root}>`;
}

/**
 * UBL Invoice / CreditNote → the scan object the AI reader also produces (legacy `ublToScan`, 5398).
 * FIX (LEGACY-MAP 3.4 item 8): a CreditNote is returned with `credit: true` and negative amounts (legacy imported it
 * as a positive purchase); art. 32-a is detected from tax category `AE` (legacy always `false`); groups are `goods`
 * only when the document has item lines, otherwise `other` (legacy always `goods`, i.e. konto 6600).
 * Returns null when the XML is not a UBL invoice.
 */
export function ublToScan(txt: string): ScanInvoice | null {
  let root;
  try { root = parseXml(txt); } catch { return null; }
  if (!/^(Invoice|CreditNote)$/.test(root.name)) return null;
  const credit = root.name === 'CreditNote' || xmlText(root, 'InvoiceTypeCode') === '381';
  const sg = credit ? -1 : 1;
  const num = (s: string) => Number(s) || 0;
  const sup = xmlOne(root, 'AccountingSupplierParty/Party');
  const buy = xmlOne(root, 'AccountingCustomerParty/Party');
  const partyName = (p: typeof sup) => (p ? xmlText(p, 'PartyLegalEntity/RegistrationName') || xmlText(p, 'PartyName/Name') : '');
  const partyEdb = (p: typeof sup) => (p ? (xmlText(p, 'PartyTaxScheme/CompanyID') || xmlText(p, 'PartyLegalEntity/CompanyID') || xmlText(p, 'EndpointID')).replace(/\D/g, '') : '');
  const lineEls = [...xmlAll(root, 'InvoiceLine'), ...xmlAll(root, 'CreditNoteLine')];
  const cats = [...xmlAll(root, 'TaxTotal/TaxSubtotal').map((t) => xmlText(t, 'TaxCategory/ID')), ...lineEls.map((l) => xmlText(l, 'Item/ClassifiedTaxCategory/ID'))];
  const art32 = cats.some((c) => c === 'AE');
  const kind = lineEls.length ? 'goods' : 'other';
  const groups = xmlAll(root, 'TaxTotal/TaxSubtotal').map((t) => ({
    rate: art32 ? 18 : num(xmlText(t, 'TaxCategory/Percent')) || num(xmlText(t, 'Percent')),
    base: sg * num(xmlText(t, 'TaxableAmount')),
    vat: art32 ? 0 : sg * num(xmlText(t, 'TaxAmount')),
    kind,
  }));
  const lines = lineEls.map((l) => {
    const qEl = xmlOne(l, 'InvoicedQuantity') ?? xmlOne(l, 'CreditedQuantity');
    const qty = num(qEl?.text.trim() ?? '');
    const amt = num(xmlText(l, 'LineExtensionAmount'));
    const pr = num(xmlText(l, 'Price/PriceAmount'));
    const bq = num(xmlText(l, 'Price/BaseQuantity')) || 1;
    const uc = qEl?.attrs.unitCode;
    return {
      name: xmlText(l, 'Item/Name') || xmlText(l, 'Item/Description'),
      code: xmlText(l, 'Item/SellersItemIdentification/ID'),
      barcode: xmlText(l, 'Item/StandardItemIdentification/ID'),
      unit: uc === 'KGM' ? 'кг' : uc === 'LTR' ? 'л' : uc === 'MTR' ? 'м' : 'ком',
      qty: sg * qty,
      price: pr ? pr / bq : qty ? amt / qty : 0,
      amount: sg * amt,
      discount: 0,
      rate: art32 ? 18 : num(xmlText(l, 'Item/ClassifiedTaxCategory/Percent')),
    };
  });
  return {
    supplierName: partyName(sup), supplierEdb: partyEdb(sup), buyerName: partyName(buy), buyerEdb: partyEdb(buy),
    number: xmlText(root, 'ID'), date: xmlText(root, 'IssueDate'),
    dueDate: xmlText(root, 'DueDate') || xmlText(root, 'PaymentMeans/PaymentDueDate'),
    art32, credit, groups, lines,
    total: sg * num(xmlText(root, 'LegalMonetaryTotal/PayableAmount')),
    currency: xmlText(root, 'DocumentCurrencyCode') || 'MKD',
  };
}
