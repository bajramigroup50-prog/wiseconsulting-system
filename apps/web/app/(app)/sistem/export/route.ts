/** Legacy `backupJson` — „⬇ Само оваа фирма (JSON)“: every record of the current firm as one JSON file. */
import { audit, exportFirm } from '@wise/db';
import { getUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { viewAllowed } from '@/lib/nav';
import { backupName } from '@/lib/sysdata';
import { isOfficeOwner, OWNER_ONLY_MSG } from '@/lib/office-owner';

export async function GET() {
  const u = await getUser();
  if (!u) return new Response('unauthorized', { status: 401 });
  // 🔒 whole-data / bulk exports: only the office owner
  if (u && !(await isOfficeOwner(u))) return new Response(OWNER_ONLY_MSG, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  if (!viewAllowed(u.role, 'sistem')) return new Response('forbidden', { status: 403 });
  const firm = await currentFirm(u);
  if (!firm) return new Response('Изберете фирма.', { status: 400 });
  const B = await exportFirm(db(), firm.id);
  await audit(db(), { userId: u.id, firmId: firm.id, action: 'backupJson', entityType: 'firm', entityId: firm.id });
  const name = backupName('Rezervna_kopija_', firm.name);
  return new Response(JSON.stringify(B), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'no-store',
    },
  });
}
