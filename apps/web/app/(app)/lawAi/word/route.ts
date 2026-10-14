/**
 * ⚖ Правен асистент — Word (.docx) export of a saved case as an internal memo (`?id=<law_case>`). Same guard as the
 * memo view: office staff with access to the case's firm; the client never.
 */
import { getUser } from '@/lib/auth';
import { htmlDocx } from '@/lib/docx';
import { lawCaseMemo } from '@/lib/law-case';

export async function GET(req: Request) {
  const u = await getUser();
  if (!u) return new Response('Unauthorized', { status: 401 });
  const m = await lawCaseMemo(u, new URL(req.url).searchParams.get('id') ?? '', true);
  if (!m) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(htmlDocx(m.html)), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': `attachment; filename="Pravna_beleshka_${m.c.createdAt.toISOString().slice(0, 10)}_${m.c.id.slice(0, 8)}.docx"`,
    },
  });
}
