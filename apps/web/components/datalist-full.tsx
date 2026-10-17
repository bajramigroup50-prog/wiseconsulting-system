'use client';
/**
 * Konto (and other) fields with a suggestion list (`<input list=…>`): the browser shows only the options that match the
 * text already in the field, so a field holding „4000“ offered only 4000 and another konto could not be picked.
 * On focus the value moves to the placeholder and the field is emptied → the whole list opens; typing filters it;
 * leaving the field (or sending its form) without choosing puts the old value back. Works for React-controlled fields too (native setter +
 * `input` event).
 */
import { useEffect } from 'react';

const setVal = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const listInput = (t: EventTarget | null): HTMLInputElement | null =>
  t instanceof HTMLInputElement && t.hasAttribute('list') && !t.disabled && !t.readOnly && t.type !== 'hidden' ? t : null;

export function DatalistFull() {
  useEffect(() => {
    const focus = (e: FocusEvent) => {
      const el = listInput(e.target);
      if (!el || !el.value || el.dataset.dlPrev !== undefined) return;
      el.dataset.dlPrev = el.value;
      el.dataset.dlPh = el.placeholder;
      el.placeholder = el.value;
      setVal(el, '');
    };
    const blur = (e: FocusEvent) => {
      const el = listInput(e.target) ?? (e.target instanceof HTMLInputElement ? e.target : null);
      if (!el || el.dataset.dlPrev === undefined) return;
      const prev = el.dataset.dlPrev;
      el.placeholder = el.dataset.dlPh ?? '';
      delete el.dataset.dlPrev; delete el.dataset.dlPh;
      if (!el.value) setVal(el, prev);
    };
    // a form sent while the field is still focused and empty sends the old value
    const submit = (e: Event) => {
      if (!(e.target instanceof HTMLFormElement)) return;
      for (const el of e.target.querySelectorAll<HTMLInputElement>('input[data-dl-prev]')) if (!el.value) setVal(el, el.dataset.dlPrev!);
    };
    // Enter / F-keys (save shortcuts such as F4) while the field is empty: the old value first
    const key = (e: KeyboardEvent) => {
      const el = listInput(e.target);
      if (el && el.dataset.dlPrev !== undefined && !el.value && (e.key === 'Enter' || /^F\d+$/.test(e.key))) setVal(el, el.dataset.dlPrev);
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    document.addEventListener('submit', submit, true);
    return () => { document.removeEventListener('focusin', focus); document.removeEventListener('focusout', blur); document.removeEventListener('submit', submit, true); document.removeEventListener('keydown', key, true); };
  }, []);
  return null;
}
