import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SQ, tr } from './npo-i18n';

const FILES = ['obroci/page.tsx', 'obroci/kitchen.tsx', 'obroci/day-list.tsx', 'obroci/consent-pill.tsx', 'obroci/actions.ts', 'clenovi/page.tsx', 'clenovi/actions.ts'];
const src = (f: string) => readFileSync(fileURLToPath(new URL(`../app/(app)/${f}`, import.meta.url)), 'utf8');

describe('НПО screens in Albanian', () => {
  it('every t(…) text of the screens has an Albanian translation', () => {
    const miss: string[] = [];
    for (const f of FILES) {
      for (const m of src(f).matchAll(/\bt\('((?:[^'\\]|\\.)*)'\)/g)) {
        const k = m[1]!.replace(/\\'/g, "'");
        if (!(k in SQ)) miss.push(`${f}: ${k}`);
      }
    }
    expect(miss).toEqual([]);
  });

  it('translates in Albanian, keeps Macedonian (and unknown texts) as they are', () => {
    expect(tr('sq')('📋 Дневна листа')).toBe('📋 Lista ditore');
    expect(tr('sq')('Ручек')).toBe('Dreka');
    expect(tr('mk')('Ручек')).toBe('Ручек');
    expect(tr('sq')('непознат текст')).toBe('непознат текст');
  });
});
