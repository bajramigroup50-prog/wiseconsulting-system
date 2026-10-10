'use server';
/**
 * Legacy `pnLiveStart` (9439): the driver's phone sends its position for the orders it drives that are on the road.
 * Allowed for the order's assignee (field user) or a user with `write` on the order's firm; the travel-order module
 * must be on (checked in `recordPosition`).
 */
import { can } from '@wise/core';
import { IndustryError, recordPosition } from '@wise/db';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';

export async function pushPositionAction(orderIds: string[], pos: { lat: number; lon: number; acc?: number | null; spd?: number | null; at: string }): Promise<{ ok?: number; error?: string }> {
  const u = await requireUser();
  const ids = (Array.isArray(orderIds) ? orderIds : []).filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 20);
  try {
    const k = await db().transaction((tx) => recordPosition(tx, u, ids, { lat: Number(pos?.lat), lon: Number(pos?.lon), acc: pos?.acc ?? null, spd: pos?.spd ?? null, at: String(pos?.at ?? '') }, (firmId) => can(u.principal, 'write', firmId)));
    return { ok: k };
  } catch (e) {
    return { error: e instanceof IndustryError ? e.message : 'Грешка.' };
  }
}
