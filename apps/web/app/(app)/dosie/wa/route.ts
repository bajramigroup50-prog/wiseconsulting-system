/**
 * Legacy `dosWa` („💬 WhatsApp / Viber“): legacy handed the files to the phone's share sheet. A server page cannot
 * attach files to WhatsApp, so this opens WhatsApp with the message (firm, documents, dates) ready and the ZIP of the
 * same documents downloads alongside — attach it with 📎. Different from legacy, noted in docs/parity/firms-office.md.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { dossierDocs } from '@wise/db';
import { getUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';

export async function GET(req: Request) {
  const u = await getUser();
  const firm = u ? await currentFirm(u) : null;
  if (!u || !firm) return new Response('Forbidden', { status: 403 });
  const ids = new URL(req.url).searchParams.getAll('id').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50);
  const D = ids.length ? await db().select().from(dossierDocs).where(and(eq(dossierDocs.firmId, firm.id), inArray(dossierDocs.id, ids))) : [];
  const dmy = (d: string | null) => (d ? d.split('-').reverse().join('.') : '');
  const text = [`${firm.name} – документи:`, ...D.map((d) => `• ${d.title || d.category}${d.number ? ' бр. ' + d.number : ''}${d.date ? ' од ' + dmy(d.date) : ''}`)].join('\n');
  const zip = '/dosie/zip?' + ids.map((i) => 'id=' + i).join('&');
  const html = `<!doctype html><meta charset="utf-8"><title>WhatsApp</title><body style="font-family:sans-serif;padding:24px">
<p>Пораката е подготвена во WhatsApp. Документите се преземаат како ZIP – прикачете ги со 📎.</p>
<p><a href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">💬 Отвори WhatsApp</a> · <a href="viber://forward?text=${encodeURIComponent(text)}">Viber</a> · <a href="${zip}">⬇ Преземи ZIP</a> · <a href="/dosie">← Назад</a></p>
<script>if(${D.length}){location.href=${JSON.stringify(zip)};window.open(${JSON.stringify('https://wa.me/?text=' + encodeURIComponent(text))},'_blank')}</script></body>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
