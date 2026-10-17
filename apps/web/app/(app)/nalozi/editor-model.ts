/** Journal-editor model shared by the server page and the client editor. */
import type { FastLine } from '@/components/fast-entry';

export interface EditorRow {
  account: string; partnerId: string; debit: string; credit: string; note: string; doc: string;
  /** Foreign currency of the line („Во девизи“) and its location — kept when the nalog is saved again. */
  currency?: string | null; amountCur?: string | null; locationId?: string | null;
}
export interface EditorJournal {
  id: string | null; number: string; date: string; description: string; periodFrom: string; periodTo: string; rows: EditorRow[];
}

export const blankRow = (account = ''): EditorRow => ({ account, partnerId: '', debit: '', credit: '', note: '', doc: '' });

/** Legacy `newJ` 7255: two rows 4400 / 1000. */
export const newJournal = (date: string): EditorJournal =>
  ({ id: null, number: '', date, description: '', periodFrom: '', periodTo: '', rows: [blankRow('4400'), blankRow('1000')] });

/** A row without amount, partner, content or document (the editor's starting 4400 / 1000 rows). */
export const isBlankRow = (r: EditorRow) => !Number(String(r.debit).replace(',', '.')) && !Number(String(r.credit).replace(',', '.')) && !r.partnerId && !r.note && !r.doc;

/** Editor row → „Промена на ставка“ (fast entry). Foreign amounts are on the side of the line. */
export const rowToFast = (r: EditorRow, date: string): Partial<FastLine> => {
  const fx = !!r.currency && r.currency !== 'MKD' && !!Number(r.amountCur);
  return {
    konto: r.account, content: r.note, partnerId: r.partnerId, debit: r.debit, credit: r.credit, doc: r.doc, date,
    ...(fx ? { cur: r.currency!, ...(Number(r.debit) ? { debitCur: String(r.amountCur) } : { creditCur: String(r.amountCur) }) } : {}),
  };
};

/** Fast-entry line → editor row (`keep` = the row being changed, for what the dialog does not show). */
export const fastToRow = (l: FastLine, keep?: EditorRow): EditorRow => {
  const cur = Number(l.debitCur.replace(',', '.')) || Number(l.creditCur.replace(',', '.'));
  return {
    account: l.konto.trim().split(/\s/)[0] ?? '', partnerId: l.partnerId, debit: l.debit, credit: l.credit, note: l.content, doc: l.doc,
    currency: cur && l.cur ? l.cur : null, amountCur: cur && l.cur ? String(Math.abs(cur)) : null, locationId: keep?.locationId ?? null,
  };
};
