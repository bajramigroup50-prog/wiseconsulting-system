/**
 * P43 — the ⚖️ preliminary tax review (`lawReview`, legacy `lrCheck`) of every firm, nightly, with its results in the
 * autopilot findings (`autopilot_findings`, key `lr:<rule>`, category „Даночен преглед“, link `lawrep`): new ones
 * are added, the ones no longer reported are resolved. The 6-hourly autopilot run leaves the `lr:` findings alone.
 * Read-only on the books.
 */
import { and, eq, isNull, like, notInArray } from 'drizzle-orm';
import { todaySkopje } from '@wise/core/office';
import type { Tx } from '../audit';
import { lawReview, lawReviewFirms } from '../lawrep';
import { autopilotFindings } from '../schema/index';
import { autoFirms, autoOn, noteAutoRun } from './common';

/** Key prefix of the tax-review findings (kept out of the autopilot's own resolve step). */
export const LR_FINDING_PREFIX = 'lr:';
export const LR_FINDING_CAT = 'Даночен преглед';

export interface AutoLawrepResult { firms: number; findings: number; bad: number; errors: string[]; skipped: boolean }

export async function runAutoLawrep(db: Tx, o: { today?: string; force?: boolean } = {}): Promise<AutoLawrepResult> {
  const out: AutoLawrepResult = { firms: 0, findings: 0, bad: 0, errors: [], skipped: false };
  if (!o.force && !(await autoOn(db, 'lawrep'))) return { ...out, skipped: true };
  const today = o.today ?? todaySkopje();
  const year = Number(today.slice(0, 4));
  const F = await lawReviewFirms(db, (await autoFirms(db, { office: false })).map((f) => f.id));
  const now = new Date();
  for (const f of F) {
    try {
      const X = await lawReview(db, f, year, today);
      const rows = X.R.filter((x) => x.s === 'bad' || x.s === 'warn');
      await db.transaction(async (tx) => {
        for (const x of rows) {
          const key = `${LR_FINDING_PREFIX}${x.r.id}`;
          const txt = `${x.r.t} (${x.r.art}): ${x.txt}`.slice(0, 2000);
          await tx.insert(autopilotFindings).values({ firmId: f.id, key, lvl: x.s, cat: LR_FINDING_CAT, txt, go: 'lawrep' })
            .onConflictDoUpdate({ target: [autopilotFindings.firmId, autopilotFindings.key], set: { lvl: x.s, txt, go: 'lawrep', lastSeen: now, resolvedAt: null } });
        }
        const keys = rows.map((x) => `${LR_FINDING_PREFIX}${x.r.id}`);
        await tx.update(autopilotFindings).set({ resolvedAt: now }).where(and(
          eq(autopilotFindings.firmId, f.id), isNull(autopilotFindings.resolvedAt), like(autopilotFindings.key, `${LR_FINDING_PREFIX}%`),
          keys.length ? notInArray(autopilotFindings.key, keys) : undefined,
        ));
      });
      out.firms++;
      out.findings += rows.length;
      out.bad += X.bad;
    } catch (e) { out.errors.push(`${f.name}: ${(e as Error).message}`); }
  }
  await noteAutoRun(db, 'lawrep', `${out.firms} фирми · наоди ${out.findings} (прекршувања ${out.bad})${out.errors.length ? ` · грешки ${out.errors.length}` : ''}`, { firms: out.firms, findings: out.findings });
  return out;
}
