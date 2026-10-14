/**
 * Automatic updates of the WISE desktop app (electron-updater, generic provider): latest.yml, the installer and its
 * blockmap from DESKTOP_UPDATE_DIR (on the server /opt/wise/download/update, mounted read-only). Served only to the
 * desktop app (its update header) — the installer is not a public download; anything else gets 404.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const DIR = () => process.env.DESKTOP_UPDATE_DIR || '/opt/wise-download/update';
const NAME = /^(latest\.yml|WISE-Setup-\d+\.\d+\.\d+\.exe(\.blockmap)?)$/;
const KEY = 'wise-desktop-update-1';

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  if (req.headers.get('x-wise-desktop') !== KEY || !NAME.test(file)) return new Response('Not found', { status: 404 });
  const p = path.join(DIR(), file);
  try {
    const st = await stat(p);
    const body = await readFile(p);
    const type = file.endsWith('.yml') ? 'text/yaml; charset=utf-8' : 'application/octet-stream';
    return new Response(new Uint8Array(body), { headers: { 'content-type': type, 'content-length': String(st.size), 'cache-control': 'no-store' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
