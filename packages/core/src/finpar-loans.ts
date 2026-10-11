/**
 * Finance parity — loans (`pozajmici`): statement lines that are loans although they were not booked on a loan konto
 * (legacy `lnBankKind` 16681, merged in `lnBankRows` 16690).
 */
import { loanKontoDir, type LoanDir, type LoanMove } from './finance';

const LN_RE = /заем|позајм/i;

export interface LoanBankLine { id: string; date: string; amount: number; osnov?: string | null; desc: string; name?: string | null; konto?: string | null; partnerId?: string | null }

/** Legacy `lnBankKind`: payment code 468 / 469 / 568 or „заем / позајм“ in the text → loan out / back. */
export function loanBankKind(b: LoanBankLine, kontoName: (k: string) => string = () => ''): { dir: LoanDir; kind: 'out' | 'back'; amt: number } | null {
  const amt = +b.amount || 0;
  if (!amt) return null;
  const os = String(b.osnov || '').trim();
  const txt = (b.desc || '') + ' ' + (b.name || '');
  let dir = b.konto ? loanKontoDir(b.konto, kontoName(b.konto)) : null;
  if (!dir && !['468', '469', '568'].includes(os) && !LN_RE.test(txt)) return null;
  if (!dir) dir = os === '568' || /врак|поврат/i.test(txt) ? (amt > 0 ? 'given' : 'received') : (amt < 0 ? 'given' : 'received');
  const kind = dir === 'given' ? (amt < 0 ? 'out' : 'back') : (amt > 0 ? 'out' : 'back');
  return { dir, kind, amt: Math.abs(amt) };
}

/** Loan moves from statement lines that are NOT on a loan konto (those come from the ledger already). */
export function loanMovesFromBank(lines: readonly LoanBankLine[], kontoName: (k: string) => string = () => ''): LoanMove[] {
  const out: LoanMove[] = [];
  for (const b of lines) {
    if (b.konto && loanKontoDir(b.konto, kontoName(b.konto))) continue;
    const x = loanBankKind({ ...b, konto: null }, kontoName);
    if (!x) continue;
    out.push({ id: 'B:' + b.id, date: b.date, partnerId: b.partnerId || '', dir: x.dir, kind: x.kind, amt: x.amt, konto: b.konto || '', desc: [b.name, b.desc].filter(Boolean).join(' – '), src: 'Извод' });
  }
  return out;
}
