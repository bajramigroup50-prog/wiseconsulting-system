/**
 * „⬇ Преземи инсталација за овој уред“ (owner only): the generic WISE-Setup.exe (DEVICE_INSTALLER, built once on
 * Windows from desktop/) streamed with this device's trailer appended (.p12 + password, `deviceTrailer`). One file:
 * double-click → the app installs, the certificate is imported silently, the login screen opens.
 * Available while the device has not connected yet (its sealed bundle is kept until then). Audited.
 */
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { and, eq, sql } from 'drizzle-orm';
import { audit, devices, firms } from '@wise/db';
import { db } from '@/lib/db';
import { TRAILER_MAGIC, deviceTrailer, installerPath, loadCa, openBundle, slug } from '@/lib/device-certs';
import { CA_MISSING_MSG, OFFICE_PREFIX, devicesGateApi } from '@/lib/devices';
import { isUuid } from '@/lib/office';

const txt = (s: string, status: number) => new Response(s, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await devicesGateApi();
  if (!u) return txt('Само за сопственикот на канцеларијата.', 403);
  const { id } = await params;
  if (!isUuid(id)) return txt('Непознат уред.', 404);
  const [d] = await db().select({ id: devices.id, name: devices.name, no: devices.no, firmId: devices.firmId, bundle: devices.bundle, firmName: firms.name })
    .from(devices).leftJoin(firms, eq(firms.id, devices.firmId)).where(and(eq(devices.id, id), eq(devices.status, 'active'))).limit(1);
  if (!d) return txt('Уредот не постои или е одземен.', 404);
  if (!d.bundle) return txt('Инсталацијата за овој уред веќе не е достапна (уредот е поврзан). За нов компјутер креирајте нов уред.', 410);
  const ca = await loadCa();
  if (!ca) return txt(CA_MISSING_MSG, 503);
  let b: { p12: Buffer; password: string };
  try { b = openBundle(ca, d.bundle); } catch { return txt('Инсталацијата не може да се отвори (CA е променет). Креирајте нов уред.', 410); }

  const base = installerPath();
  let size = 0;
  try {
    const fh = await open(base, 'r');
    try {
      size = (await fh.stat()).size;
      const end = Buffer.alloc(8);
      if (size >= 8) await fh.read(end, 0, 8, size - 8);
      if (end.toString('latin1') === TRAILER_MAGIC) return txt('Основната инсталација веќе содржи сертификат — поставете ја оригиналната WISE-Setup.exe.', 500);
    } finally { await fh.close(); }
  } catch { return txt(`Инсталацијата на програмата не е поставена на серверот (${base}). Видете docs/INSTALIM-UREDI.md.`, 503); }

  const tail = deviceTrailer(b.p12, { name: d.name, password: b.password });
  await db().transaction(async (tx) => {
    await tx.update(devices).set({ downloads: sql`${devices.downloads} + 1` }).where(eq(devices.id, d.id));
    await audit(tx, { userId: u.id, firmId: d.firmId, action: 'deviceInstaller', entityType: 'device', entityId: d.id, data: { name: d.name } });
  });

  const fileBase = `WISE-Setup-${slug(d.firmId ? d.firmName ?? 'firma' : OFFICE_PREFIX)}-ured-${d.no}`;
  const body = Readable.toWeb(Readable.from((async function* () {
    for await (const ch of createReadStream(base)) yield ch as Buffer;
    yield tail;
  })())) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      'content-type': 'application/vnd.microsoft.portable-executable',
      'content-length': String(size + tail.length),
      'content-disposition': `attachment; filename="${fileBase}.exe"; filename*=UTF-8''${encodeURIComponent(fileBase)}.exe`,
      'cache-control': 'no-store',
    },
  });
}
