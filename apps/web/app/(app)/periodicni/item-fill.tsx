'use client';
/**
 * Articles for the recurring-invoice lines: a datalist on the „Ставка“ inputs; picking an article by name fills its unit,
 * price without VAT and VAT rate (and remembers the article id), so the product type comes from the article register.
 */
import { useEffect, useRef } from 'react';

export interface RecArticle { id: string; name: string; price: number | null; vat: number; unit: string | null }

export function RecItemFill({ articles }: { articles: RecArticle[] }) {
  const ref = useRef<HTMLDataListElement>(null);
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const by = new Map(articles.map((a) => [a.name.trim().toLowerCase(), a]));
    const on = (e: Event) => {
      const t = e.target as HTMLInputElement;
      const m = /^it(\d+)_name$/.exec(t?.name ?? '');
      if (!m) return;
      const a = by.get(t.value.trim().toLowerCase());
      const el = (k: string) => form.elements.namedItem(`it${m[1]}_${k}`) as HTMLInputElement | HTMLSelectElement | null;
      const item = el('item');
      if (item) item.value = a?.id ?? '';
      if (!a) return;
      const qty = el('qty'); if (qty && !qty.value) qty.value = '1';
      const unit = el('unit'); if (unit && a.unit) unit.value = a.unit;
      const price = el('price'); if (price && a.price != null) price.value = String(a.price);
      const vat = el('vat'); if (vat) vat.value = String(a.vat);
    };
    form.addEventListener('input', on);
    form.addEventListener('change', on);
    return () => { form.removeEventListener('input', on); form.removeEventListener('change', on); };
  }, [articles]);
  return <datalist id="recArt" ref={ref}>{articles.map((a) => <option key={a.id} value={a.name} />)}</datalist>;
}
