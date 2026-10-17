/**
 * Konto card table: the screen table fits a laptop screen (merged налог / р.бр., dates, one saldo column with Д / П, empty
 * columns hidden); the PDF (`pdf`) and Excel (`kkRows`) keep the 14 legacy columns.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { accountCard, type LedgerLine } from '@wise/core';
import { KkTable, kkRows } from './table';

type Ext = { rb: number | ''; nd: string; sod: string; calc: string; due: string; partner: string };
const line = (id: number, date: string, number: string, debit: number, credit: number, note: string | null = null) =>
  ({ id, account: '2200', date, number, debit, credit, kind: 'manual', description: 'ОПИС ' + id, note, partnerId: null }) as unknown as LedgerLine;

function data(ext: (id: number) => Partial<Ext>, notes = false) {
  const L = [line(1, '2026-01-10', '2-1', 0, 1000, notes ? 'плаќање по договор' : null), line(2, '2026-01-20', '12-3', 400, 0), line(3, '2026-02-01', '2-2', 0, 50)];
  const X = accountCard(L, { account: '2200', sub: false, partnerId: null, noPartner: false, from: '2026-01-01', to: '2026-12-31' });
  return {
    k: '2200', sub: false, from: '2026-01-01', to: '2026-12-31', pf: null, noPartner: false, X, name: 'Добавувачи', subT: '', chart: [], P: [],
    ext: (l: LedgerLine) => ({ rb: '', nd: '', sod: 'СОДРЖИНА', calc: '', due: '', partner: '', ...ext((l as LedgerLine & { id: number }).id) }),
  } as unknown as Parameters<typeof KkTable>[0]['d'];
}
const heads = (h: string) => [...h.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ''));

describe('KkTable', () => {
  it('screen: one saldo column with Д / П, налог + р.бр. in one cell, the nalog date only when it differs', () => {
    const d = data((id) => ({ rb: id, nd: id === 1 ? '2026-01-31' : id === 2 ? '2026-01-20' : '' }));
    const h = renderToStaticMarkup(<KkTable d={d} />);
    expect(h).toContain('class="dense kkt fit"');
    expect(heads(h)).toEqual(['Налог / р.бр.', 'Датум книж. (налог)', 'Содржина / фак. бр. · докум. / калк.', 'Должи', 'Побарува', 'Салдо Д / П']);
    expect(h).toContain('1.000,00<span class="dp">П</span>'); // −1000 after the first line
    expect(h).toContain('600,00<span class="dp">П</span>');
    expect(h).toContain('нал. 31.01.2026'); // differs from the booking date
    expect(h).not.toContain('нал. 20.01.2026'); // same date → shown once
    expect(h).toMatch(/2-1<\/b><\/a><span class="mini"> \/ 1<\/span>/);
  });

  it('screen: Забелешка, Комитент and Датум на валута appear only when some row has them; калк. goes under the content', () => {
    const d = data((id) => (id === 3 ? { partner: '0012 ДОБАВУВАЧ ДООЕЛ', due: '2026-03-01', calc: '7' } : {}), true);
    const h = renderToStaticMarkup(<KkTable d={d} />);
    expect(heads(h).slice(-3)).toEqual(['Забелешка', 'Комитент', 'Датум на валута']);
    expect(h).toContain('калк. 7');
    expect(h).toContain('плаќање по договор');
  });

  it('PDF and Excel keep all the legacy columns', () => {
    const d = data(() => ({}));
    const h = renderToStaticMarkup(<KkTable d={d} pdf />);
    expect(h).not.toContain('fit');
    expect(heads(h)).toHaveLength(13); // + Конто with sub-kontos
    expect(heads(h)).toContain('Салдо побар.');
    expect(kkRows(d)[0]).toHaveLength(14);
  });
});
