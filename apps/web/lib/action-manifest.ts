/**
 * Server action id → defining source file, from Next's `server-reference-manifest.json` (written by `next build` /
 * `next dev` into `.next/server/`). Used by `proxy.ts` to refuse a 🎭 demo user's call of an action that belongs to a
 * blocked view (`demoActionAllowed`). Re-read at most every 30 s (dev rebuilds it); unreadable → empty (fail closed).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type Manifest = { node?: Record<string, { filename?: string }>; edge?: Record<string, { filename?: string }> };

let cache: { at: number; map: Map<string, string> } | null = null;

export function actionFiles(m: Manifest): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of [m.node, m.edge]) for (const [id, v] of Object.entries(part ?? {})) if (v?.filename) map.set(id, v.filename);
  return map;
}

export async function actionFile(id: string): Promise<string | null> {
  if (!cache || Date.now() - cache.at > 30_000) {
    let map = new Map<string, string>();
    // `next dev` writes its manifest under .next/dev (a stale .next/server from an older build would refuse every action)
    const sub = process.env.NODE_ENV === 'development' ? ['dev', 'server'] : ['server'];
    for (const dir of [join(process.cwd(), '.next', ...sub), join(process.cwd(), 'apps', 'web', '.next', ...sub)]) {
      try { map = actionFiles(JSON.parse(await readFile(join(dir, 'server-reference-manifest.json'), 'utf8')) as Manifest); break; } catch { /* next */ }
    }
    cache = { at: Date.now(), map };
  }
  return cache.map.get(id) ?? null;
}
