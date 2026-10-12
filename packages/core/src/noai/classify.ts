/**
 * Office inbox classification WITHOUT AI (owner policy: AI only when nothing free can do it): a document with a text
 * layer (PDF / XML / Word / TXT / CSV) is classified by its title words; UBL e-invoices by the seller's ЕДБ. Returns
 * null when the text does not say clearly what the document is (then AI, on the user's click). Same shape as the
 * model's answer (`CLASSIFY_PROMPT` → `inboxClassification`).
 */
import type { ClassifyKind } from '../ai/classify';

export interface FreeClassification { kind: ClassifyKind; what: string; noai: true }

/** Ordered: the most specific titles first (an МПИН declaration mentions „плата“, a statement mentions „фактура“). */
const RULES: [ClassifyKind, RegExp, string][] = [
  ['payroll', /декларација\s+за\s+прием|мпин|рекапитулар|платн[аи]\s+список|пресметка\s+на\s+плат/iu, 'Плата / МПИН'],
  ['fiscal', /(дневен|периодичен|фискален)\s+(финансиски\s+)?извештај|z[\s-]*извештај|контролна\s+лента/iu, 'Фискален извештај'],
  ['bank', /извод\s+(бр|број|по\s+сметка|на\s+сметка|за\s+промет)|izvod\s+br|bank\s+statement|statement\s+of\s+account|претходна\s+состојба[\s\S]{0,400}нова\s+состојба/iu, 'Банкарски извод'],
  ['travel', /патен\s+налог/iu, 'Патен налог'],
  ['cash', /благајнички\s+(извештај|дневник)|исплатница|уплатница\s+бр|налог\s+за\s+наплата/iu, 'Благајна'],
  ['stock', /приемница|испратница|попис(на)?\s+листа|повратница/iu, 'Магацин'],
  ['employee', /договор\s+за\s+вработување|решение\s+за\s+годишен\s+одмор|м1\s*\/\s*м2|пријава\s+за\s+задолжително/iu, 'Документ за вработен'],
];
const INVOICE = /(?<!\p{L})(фактура|faktura|invoice|сметка[\s-]*фактура)(?!\p{L})/iu;
const EDB = /(?<!\d)(40\d{11}|\d{13})(?!\d)/g;

/** Classify by text. `ownEdb` decides issued (sale) vs received (purchase) invoices: the first ЕДБ is the issuer's. */
export function classifyText(text: string, o: { ownEdb?: string | null } = {}): FreeClassification | null {
  const head = text.slice(0, 4000);
  for (const [kind, re, what] of RULES) if (re.test(head)) return { kind, what, noai: true };
  if (INVOICE.test(head)) {
    const own = (o.ownEdb ?? '').replace(/\D/g, '');
    const first = [...head.replace(/MK\s?(?=\d{13})/g, '').matchAll(EDB)].map((m) => m[1]!)[0];
    if (!own || !first) return null;
    return first === own ? { kind: 'sale', what: 'Излезна фактура', noai: true } : { kind: 'purchase', what: 'Влезна фактура', noai: true };
  }
  return null;
}

/** UBL e-invoice XML: the supplier's ЕДБ (`AccountingSupplierParty`) decides sale vs purchase. */
export function classifyUbl(xml: string, o: { ownEdb?: string | null } = {}): FreeClassification | null {
  if (!/<(\w+:)?Invoice[\s>]/.test(xml) && !/<(\w+:)?CreditNote[\s>]/.test(xml)) return null;
  const sup = /AccountingSupplierParty[\s\S]*?<\/(\w+:)?AccountingSupplierParty>/.exec(xml)?.[0] ?? '';
  const own = (o.ownEdb ?? '').replace(/\D/g, '');
  const ids = [...sup.matchAll(/(\d{13})/g)].map((m) => m[1]!);
  if (!own || !ids.length) return null;
  return ids.includes(own) ? { kind: 'sale', what: 'Излезна е-фактура (UBL)', noai: true } : { kind: 'purchase', what: 'Влезна е-фактура (UBL)', noai: true };
}
