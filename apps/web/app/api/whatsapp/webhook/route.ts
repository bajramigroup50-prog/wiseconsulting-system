/**
 * 💬 WhatsApp Cloud API webhook (Meta → WISE). Public (no session, `publicPath`, no device certificate); Caddy lets
 * only this path through from the public website host (`/api/whatsapp` → here).
 *  GET  – Meta's handshake: echoes `hub.challenge` only for our verify token (settings page).
 *  POST – messages and status updates, signed by Meta with the app secret (`X-Hub-Signature-256`). Unsigned or
 *         wrongly signed bodies are refused (401) before anything is read. Switched off → 200 and nothing stored.
 * Text is logged per firm at once; images / PDFs are downloaded by the worker (`wa.media`) into „📥 Пристигнати
 * документи“. Always answers fast (Meta retries slow / failed deliveries). Never returns data.
 */
import { WA_JOB_MEDIA, waActive, waMatch, waParseWebhook } from '@wise/core/whatsapp/wa';
import { waApplyStatus, waHandshake, waKnown, waLearned, waRecordIn, waSecrets, waSignatureOk, type Tx } from '@wise/db';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

const HITS: number[] = [];
/** A flood guard (Meta sends batches; 600 a minute is far above the office's traffic). */
function flooded(now = Date.now()): boolean {
  while (HITS.length && now - HITS[0]! > 60_000) HITS.shift();
  if (HITS.length >= 600) return true;
  HITS.push(now);
  return false;
}

export async function GET(req: Request) {
  const s = await waSecrets(db() as unknown as Tx);
  const c = waHandshake(new URL(req.url).searchParams, s.verifyToken);
  return c ? new Response(c, { status: 200, headers: { 'content-type': 'text/plain' } }) : new Response('forbidden', { status: 403 });
}

export async function POST(req: Request) {
  if (flooded()) return new Response('busy', { status: 429 });
  const raw = await req.text().catch(() => '');
  if (!raw || raw.length > 1_000_000) return new Response('bad', { status: 400 });
  const s = await waSecrets(db() as unknown as Tx);
  if (!waSignatureOk(raw, req.headers.get('x-hub-signature-256'), s.secret)) return new Response('unauthorized', { status: 401 });
  if (!waActive(s)) return new Response('ok');
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response('bad', { status: 400 }); }
  const w = waParseWebhook(body);
  // another number of the same Meta app is not ours
  if (w.phoneNumberId && s.phoneNumberId && w.phoneNumberId !== s.phoneNumberId) return new Response('ok');
  const media: string[] = [];
  if (w.messages.length) {
    const [known, learned] = await Promise.all([waKnown(db() as unknown as Tx), waLearned(db() as unknown as Tx)]);
    for (const m of w.messages) {
      const id = await waRecordIn(db() as unknown as Tx, m, waMatch(m.from, known, learned));
      if (id && m.media) media.push(id);
    }
  }
  for (const st of w.statuses) await waApplyStatus(db() as unknown as Tx, st);
  for (const id of media) await enqueue(WA_JOB_MEDIA, { id }).catch(() => null);
  return new Response('ok');
}
