/** Global CSS rules that must not break table layout. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../app/legacy.css', import.meta.url), 'utf8');

describe('legacy.css', () => {
  it('`.mini` (inline-flex) keeps <td class="mini"> / <th class="mini"> a table cell, declared after `.mini`', () => {
    const mini = css.indexOf('.mini{display:inline-flex');
    const cell = css.search(/td\.mini,th\.mini\{display:table-cell\}/);
    expect(mini).toBeGreaterThanOrEqual(0);
    expect(cell).toBeGreaterThan(mini);
  });
});
