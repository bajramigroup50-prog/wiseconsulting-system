import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.next' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

describe('one shared job-sending helper (lib/jobs.ts)', () => {
  it('no other web module creates a pg-boss client or imports pg-boss', () => {
    const hits = sources(root)
      .filter((p) => /from 'pg-boss'|new PgBoss\(/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(root, p).split(sep).join('/'));
    expect(hits).toEqual(['lib/jobs.ts']);
  });
});
