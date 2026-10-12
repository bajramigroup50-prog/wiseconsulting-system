'use server';
/** 🔐 Уреди (компјутери): issue a device certificate („+ Нов уред“) and revoke one („🚫 Одземи“). Owner only, audited. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, isNull, max } from 'drizzle-orm';
import { audit, devices, firms } from '@wise/db';
import type { RowResult } from '@/components/row-action';
import { db } from '@/lib/db';
import { issueDeviceCert, loadCa, sealBundle } from '@/lib/device-certs';
import { forgetDevice } from '@/lib/device-lookup';
import { CA_MISSING_MSG, OFFICE_PREFIX, deviceName, devicesGate } from '@/lib/devices';
import { isUuid } from '@/lib/office';
import { OWNER_ONLY_MSG } from '@/lib/office-owner';

/** „+ Нов уред“: firm from the list (or the office), optional suffix; the name and the number are generated. */
export async function createDevice(_prev: RowResult, form: FormData): Promise<RowResult> {
  const { u, ok } = await devicesGate();
  if (!ok) return { error: OWNER_ONLY_MSG };
  const f = String(form.get('firm') ?? '');
  const suffix = String(form.get('suffix') ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
  let firmId: string | null = null, label = OFFICE_PREFIX;
  if (f !== 'office') {
    if (!isUuid(f)) return { error: 'Изберете фирма (или „Канцеларија“).' };
    const [x] = await db().select({ id: firms.id, name: firms.name }).from(firms).where(eq(firms.id, f)).limit(1);
    if (!x) return { error: 'Фирмата не постои.' };
    firmId = x.id; label = x.name;
  }
  const ca = await loadCa();
  if (!ca) return { error: CA_MISSING_MSG };
  const [m] = await db().select({ n: max(devices.no) }).from(devices).where(firmId ? eq(devices.firmId, firmId) : isNull(devices.firmId));
  const no = (m?.n ?? 0) + 1;
  const name = deviceName(label, no, suffix);
  const c = issueDeviceCert(ca, name);
  const id = await db().transaction(async (tx) => {
    const [d] = await tx.insert(devices).values({
      name: c.cn, firmId, no, serial: c.serial, fingerprint: c.fingerprint, notAfter: c.notAfter,
      bundle: sealBundle(ca, c), createdBy: u.id,
    }).returning({ id: devices.id });
    await audit(tx, { userId: u.id, firmId, action: 'deviceNew', entityType: 'device', entityId: d!.id, data: { name: c.cn, serial: c.serial, notAfter: c.notAfter.toISOString() } });
    return d!.id;
  });
  revalidatePath('/uredi');
  redirect(`/uredi?nov=${id}`);
}

/** „🚫 Одземи“: the certificate stops working at once (the proxy refuses it); the stored installer is dropped. */
export async function revokeDevice(id: string, reason?: string): Promise<RowResult> {
  const { u, ok } = await devicesGate();
  if (!ok) return { error: OWNER_ONLY_MSG };
  if (!isUuid(id)) return { error: 'Непознат уред.' };
  const why = (reason ?? '').trim().slice(0, 200) || null;
  const r = await db().transaction(async (tx) => {
    const [d] = await tx.update(devices).set({ status: 'revoked', revokedAt: new Date(), revokedBy: u.id, revokeReason: why, bundle: null })
      .where(and(eq(devices.id, id), eq(devices.status, 'active'))).returning({ name: devices.name, fp: devices.fingerprint, firmId: devices.firmId, serial: devices.serial });
    if (!d) return null;
    await audit(tx, { userId: u.id, firmId: d.firmId, action: 'deviceRevoke', entityType: 'device', entityId: id, data: { name: d.name, serial: d.serial, reason: why } });
    return d;
  });
  if (!r) return { error: 'Уредот е веќе одземен или не постои.' };
  forgetDevice(r.fp);
  revalidatePath('/uredi');
  return { ok: `Пристапот за „${r.name}“ е одземен.` };
}
