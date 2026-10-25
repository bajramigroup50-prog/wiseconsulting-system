// @vitest-environment happy-dom
/**
 * A print link with a period takes the dates typed in the filter form at the click (30.06 typed without „Прикажи“
 * prints 30.06, not 31.12); links without a period, and periods already right, are left to the browser.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrintDates } from './print-dates';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); });

const page = (links: string[]) => {
  document.body.innerHTML = `<form><input type="date" name="from" value="2026-01-01"><input type="date" name="to" value="2026-12-31"></form>`
    + links.map((h, i) => `<a id="l${i}" href="${h}">x</a>`).join('');
  const box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => root!.render(createElement(PrintDates)));
};
const click = (id: string) => {
  const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  document.getElementById(id)!.dispatchEvent(e);
  return e.defaultPrevented;
};

describe('PrintDates', () => {
  it('a period print takes the typed dates', () => {
    page(['/print/bilanc?from=2026-01-01&to=2026-12-31&or=p', '/print/doc/1', '/print/bilanc/zl?from=2026-01-01&to=2026-12-31']);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    (document.querySelector('input[name=to]') as HTMLInputElement).value = '2026-06-30';
    expect(click('l0')).toBe(true);
    expect(open).toHaveBeenLastCalledWith('/print/bilanc?from=2026-01-01&to=2026-06-30&or=p', '_blank', 'noopener');
    expect(click('l1')).toBe(false); // a document: no period, untouched
    expect(click('l2')).toBe(true);
    expect(open).toHaveBeenLastCalledWith('/print/bilanc/zl?from=2026-01-01&to=2026-06-30', '_blank', 'noopener');
  });

  it('dates already shown: the link works as it is', () => {
    page(['/print/bilanc?from=2026-01-01&to=2026-12-31']);
    expect(click('l0')).toBe(false);
  });
});
