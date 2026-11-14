/**
 * 🌐 „Барање за понуда“ of the public website (wiseconsulting.com.mk, `website/main.js`) → a new CRM lead (`source = 'web'`).
 * Public (no session, `publicPath`); Caddy proxies the website's `/api/lead` here. Guards: a honeypot field (`hp`),
 * a per-IP limit (5 per hour, in memory), a daily cap of 100 web leads, length caps, JSON or form body ≤ 20 KB.
 * Never returns data: only `{ ok }`.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { crmFromWebForm } from '@wise/core/firms/crm';
import { crmLeads, crmNotes } from '@wise/db';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const HITS = new Map<string, number[]>();
const WIN = 36e5, MAX = 5;
function limited(ip: string, now = Date.now()): boolean {
  const A = (HITS.get(ip) ?? []).filter((t) => now - t < WIN);
  if (A.length >= MAX) { HITS.set(ip, A); return true; }
  A.push(now); HITS.set(ip, A);
  if (HITS.size > 5000) for (const [k, v] of HITS) if (!v.some((t) => now - t < WIN)) HITS.delete(k);
  return false;
}

const no = (status: number, error: string) => Response.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  const raw = await req.text().catch(() => '');
  if (!raw || raw.length > 20_000) return no(400, 'bad');
  let b: Record<string, unknown> = {};
  try { b = raw.trim().startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)); } catch { return no(400, 'bad'); }
  if (typeof b !== 'object' || !b) return no(400, 'bad');
  // honeypot: bots fill every field — pretend success
  if (String(b.hp ?? '').trim()) return Response.json({ ok: true });
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'local';
  if (limited(ip)) return no(429, 'Премногу барања – обидете се подоцна или јавете се на телефон.');
  const L = crmFromWebForm({ ...b, name: b.name ?? b.person, message: b.message ?? b.msg });
  if (!L) return no(400, 'Внесете фирма / име и телефон или е-пошта.');
  const since = new Date(Date.now() - 864e5);
  const [c] = await db().select({ n: sql<number>`count(*)::int` }).from(crmLeads).where(and(eq(crmLeads.source, 'web'), gte(crmLeads.createdAt, since)));
  if ((c?.n ?? 0) >= 100) return no(429, 'Обидете се подоцна.');
  const s = (k: string, max = 60) => { const v = String(b[k] ?? '').trim().slice(0, max); return v || undefined; };
  const data: Record<string, unknown> = { message: L.message ?? undefined, vat: s('vat', 10), docs: s('docs', 10), lang: s('lang', 5), ip };
  const [r] = await db().insert(crmLeads).values({
    company: L.company, contact: L.contact, phone: L.phone, email: L.email, activity: L.activity, employees: L.employees,
    source: 'web', stage: 'nov', data, nextStep: 'Јави се – барање од веб-страницата', nextDate: new Date().toISOString().slice(0, 10),
  }).returning({ id: crmLeads.id });
  await db().insert(crmNotes).values({ leadId: r!.id, kind: 'mail', text: '🌐 Барање за понуда од веб-формата' + (L.message ? `:\n${L.message}` : '') });
  return Response.json({ ok: true });
}
