/**
 * `bank_lines` rows ↔ `@wise/core` matching rows (`BankRow`, integer cents).
 */
import type { BankRow, DocRefAmt } from '@wise/core';
import type { BankLine, BankRefAlloc, BankSplit, NewBankLine } from '../schema/index';
import { cents, dec, den } from './context';

export function toBankRow(l: BankLine): BankRow {
  const r: BankRow = {
    id: l.id,
    acct: l.bankAccountId,
    date: l.date,
    amount: cents(l.amount),
    desc: l.description,
  };
  if (l.amountCur != null) r.amountCur = cents(l.amountCur);
  if (l.cur) r.cur = l.cur;
  if (l.name) r.name = l.name;
  if (l.purpose) r.purpose = l.purpose;
  if (l.osnov) r.osnov = l.osnov;
  if (l.bref) r.bref = l.bref;
  if (l.konto) r.konto = l.konto;
  if (l.partnerId) r.partner = l.partnerId;
  if (l.refType && l.refId) r.ref = { type: l.refType, id: l.refId, label: l.refLabel ?? '' };
  if (l.refs?.length) r.refs = l.refs.map((x) => ({ ...x, amt: cents(x.amt) }));
  if (l.settle != null) r.settle = cents(l.settle);
  if (l.split?.length) r.split = l.split.map((x) => ({ k: x.k, a: cents(x.a), ...(x.n ? { n: x.n } : {}) }));
  if (l.payRef) r.payRef = l.payRef;
  if (l.pos) r.pos = true;
  if (l.own) r.own = true;
  if (l.conv) r.conv = true;
  if (l.manual) r.manual = true;
  return r;
}

/** Booking fields of a matched / classified row, as a `bank_lines` update. */
export function bookingPatch(r: BankRow): Partial<NewBankLine> {
  return {
    konto: r.konto || null,
    partnerId: r.partner || null,
    refType: r.ref?.type ?? null,
    refId: r.ref?.id ?? null,
    refLabel: r.ref?.label ?? null,
    refs: r.refs?.length ? r.refs.map((x: DocRefAmt): BankRefAlloc => ({ type: x.type, id: x.id, label: x.label, amt: den(x.amt) })) : null,
    settle: r.settle != null ? dec(r.settle) : null,
    split: r.split?.length ? r.split.map((x): BankSplit => ({ k: x.k, a: den(x.a), ...(x.n ? { n: x.n } : {}) })) : null,
    payRef: r.payRef ?? null,
    pos: !!r.pos,
    own: !!r.own,
    conv: !!r.conv,
  };
}

/** Cleared booking (legacy `unlinkBank`): back to "непрокнижено". */
export const UNBOOKED: Partial<NewBankLine> = {
  konto: null, partnerId: null, refType: null, refId: null, refLabel: null, refs: null, settle: null, split: null, payRef: null,
  pos: false, own: false, conv: false, auto: null, newPartner: null,
};
