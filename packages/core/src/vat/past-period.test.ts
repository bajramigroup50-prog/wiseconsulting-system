import { describe, expect, it } from 'vitest';
import type { Principal } from '../rbac';
import { classifyAction, KNOWN_ACTIONS } from '../office/productivity';
import {
  canDecidePast, draftVatDate, pastDecisionOptions, pastHoldPrevious, pastPeriodOf, receiptDateOk, vatPeriodName, type PastPeriodCtx,
} from './past-period';

const Q: PastPeriodCtx = {
  kind: 'quarter', today: '2026-10-17', holdPrevious: true, lockDate: '2025-12-31',
  closed: [{ period: '2026-Т2', dateFrom: '2026-04-01', dateTo: '2026-06-30', submittedAt: '2026-07-20T10:00:00.000Z' }],
};

describe('минат ДДВ период', () => {
  it('names the period', () => {
    expect(vatPeriodName('2026-Т2')).toBe('ДДВ Q2/2026 (април–јуни)');
    expect(vatPeriodName('2026-06')).toBe('ДДВ 06/2026 (јуни)');
  });

  it('closed, previous and locked periods are past; the current one is not', () => {
    expect(pastPeriodOf('2026-06-17', Q)).toMatchObject({ period: '2026-Т2', reason: 'closed', closed: true, text: 'ДДВ Q2/2026 (април–јуни), затворен (поднесен 20.07.2026)' });
    expect(pastPeriodOf('2026-09-30', Q)).toMatchObject({ period: '2026-Т3', reason: 'previous', closed: false, text: 'ДДВ Q3/2026 (јули–септември), претходен период' });
    expect(pastPeriodOf('2025-11-02', Q)).toMatchObject({ reason: 'locked' });
    expect(pastPeriodOf('2026-10-01', Q)).toBeNull();
    expect(pastPeriodOf('', Q)).toBeNull();
    // (b) off: only closed (and locked) periods
    const off = { ...Q, holdPrevious: false };
    expect(pastPeriodOf('2026-09-30', off)).toBeNull();
    expect(pastPeriodOf('2026-06-17', off)?.reason).toBe('closed');
    // monthly filer: September is already a previous period in October
    expect(pastPeriodOf('2026-09-30', { ...Q, kind: 'month', closed: [] })).toMatchObject({ period: '2026-09', text: 'ДДВ 09/2026 (септември), претходен период' });
  });

  it('the setting (b) is ON by default', () => {
    expect(pastHoldPrevious({})).toBe(true);
    expect(pastHoldPrevious(null)).toBe(true);
    expect(pastHoldPrevious({ pastVatHold: false })).toBe(false);
  });

  it('the VAT date of a draft: an incoming invoice moved by the read keeps its invoice date', () => {
    expect(draftVatDate('purchase', { date: '2026-10-17', docDate: '2026-06-17', shifted: true })).toBe('2026-06-17');
    expect(draftVatDate('purchase', { date: '2026-07-02', docDate: '2026-06-28' })).toBe('2026-07-02');
    expect(draftVatDate('sale', { date: '2026-06-17' })).toBe('2026-06-17');
  });

  it('the receipt-date option exists only for incoming invoices; a closed period must be reopened first', () => {
    const closed = pastPeriodOf('2026-06-17', Q)!, prev = pastPeriodOf('2026-08-01', Q)!;
    expect(pastDecisionOptions('purchase', closed)).toMatchObject({ own: false, receipt: true });
    expect(pastDecisionOptions('sale', closed)).toMatchObject({ own: false, receipt: false });
    expect(pastDecisionOptions('sale', prev)).toEqual({ own: true, receipt: false });
    expect(pastDecisionOptions('purchase', prev)).toEqual({ own: true, receipt: true });
    expect(receiptDateOk('2026-10-15', Q, '2026-06-17')).toBeNull();
    expect(receiptDateOk('2026-09-30', Q, '2026-06-17')).toMatch(/тековниот ДДВ период/);
    expect(receiptDateOk('2026-10-20', Q)).toMatch(/иднина/);
    expect(receiptDateOk('2026-10-02', Q, '2026-10-05')).toMatch(/пред датумот/);
  });

  it('permissions: the owner, `fix` or `settings` decide; book-only accountants and operators do not', () => {
    const F = 'f1';
    const P = (role: Principal['role'], firms: string[] = [F], demo = false): Principal => ({ id: 'u', role, firms, ...(demo ? { demo } : {}) });
    expect(canDecidePast(P('admin', ['*']), F)).toBe(true);
    expect(canDecidePast(P('senior'), F)).toBe(true);
    expect(canDecidePast(P('acc'), F)).toBe(false);
    expect(canDecidePast(P('oper'), F)).toBe(false);
    expect(canDecidePast(P('view'), F)).toBe(false);
    expect(canDecidePast(P('senior', ['other']), F)).toBe(false);
    expect(canDecidePast(null, F)).toBe(false);
  });

  it('the decisions are classified as work', () => {
    expect(classifyAction('pastPost', 'invoice')).toMatchObject({ cat: 'ddv', verb: 'u', known: true });
    expect(classifyAction('pastRecv', 'purchase')).toMatchObject({ cat: 'ddv', verb: 'u', known: true });
    expect(classifyAction('pastReject', 'ai_document')).toMatchObject({ cat: 'ai', verb: 'd', known: true });
    expect(classifyAction('pastHold', 'ai_document')).toBeNull();
    expect(classifyAction('pastHoldSet', 'firm')).toBeNull();
    for (const a of ['pastPost', 'pastRecv', 'pastReject', 'pastHold', 'pastHoldSet']) expect(KNOWN_ACTIONS.has(a)).toBe(true);
  });
});
