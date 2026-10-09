import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PDFDOC_CSS } from '@wise/core/print-css';

describe('PDFDOC_CSS (server PDFs) stays a copy of the web print CSS', () => {
  it('every rule is present in apps/web/app/legacy-injected.css', () => {
    const web = readFileSync(fileURLToPath(new URL('../app/legacy-injected.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
    const lines = PDFDOC_CSS.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(lines.length).toBeGreaterThan(5);
    for (const l of lines) expect(web).toContain(l);
  });
});
