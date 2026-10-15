/**
 * 🤖 WISE Робот — chat rows, firm access and the free (no-AI) answer path shared by the web and the worker.
 */
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import { firmAllowed, type Role } from '@wise/core';
import { robotIsAlbanian, robotSqHeading, routeQuestion } from '@wise/core/robot';
import type { Tx } from '../audit';
import { appSettings, firms, robotMessages, robotProposals, userFirms, users, type Firm, type RobotMessage, type RobotProposal } from '../schema/index';
import { runRobotTool, type RobotCtx, type ToolOut } from './tools';

/**
 * May this user use the robot for this firm? Same rule as the web's `currentFirm` (`firmAllowed`: admin / all firms /
 * assigned in `user_firms` / owner), active firm, office roles only (not the client portal or field workers).
 */
export async function robotFirmAccess(tx: Tx, userId: string, firmId: string): Promise<Firm | null> {
  const [u] = await tx.select({ id: users.id, role: users.role, allFirms: users.allFirms, active: users.active }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u || !u.active || u.role === 'klient' || u.role === 'teren') return null;
  const [f] = await tx.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!f || !f.active) return null;
  const assigned = u.allFirms ? ['*'] : (await tx.select({ f: userFirms.firmId }).from(userFirms).where(eq(userFirms.userId, userId))).map((r) => r.f);
  return firmAllowed({ id: u.id, role: u.role as Role, firms: assigned }, f.id, f.ownerId) ? f : null;
}

/**
 * Is this user the office owner? Same rule as the web's `lib/office-owner.ts` (`officeOwner`): the admin set as owner
 * (`app_settings.officeOwner`), else the „Мој извештај“ claim (`mojIzvOwner`), else the first active admin.
 * Owner-only robot data (fees, the accounting-service contract deadline) depends on it.
 */
export async function robotIsOwner(tx: Tx, userId: string): Promise<boolean> {
  const admin = async (id: unknown) => {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, id), eq(users.active, true), eq(users.role, 'admin'))).limit(1);
    return u?.id ?? null;
  };
  const S = await tx.select({ k: appSettings.key, v: appSettings.value }).from(appSettings).where(inArray(appSettings.key, ['officeOwner', 'mojIzvOwner']));
  const val = (k: string) => (S.find((r) => r.k === k)?.v as { id?: unknown } | undefined)?.id;
  const owner = (await admin(val('officeOwner'))) ?? (await admin(val('mojIzvOwner')))
    ?? (await tx.select({ id: users.id }).from(users).where(and(eq(users.active, true), eq(users.role, 'admin'))).orderBy(asc(users.createdAt), asc(users.id)).limit(1))[0]?.id ?? null;
  return owner === userId;
}

/** Visible conversation of a user in a firm (oldest first). */
export async function robotThread(tx: Tx, userId: string, firmId: string, limit = 60): Promise<{ messages: RobotMessage[]; proposals: RobotProposal[] }> {
  const M = (await tx.select().from(robotMessages)
    .where(and(eq(robotMessages.userId, userId), eq(robotMessages.firmId, firmId), eq(robotMessages.archived, false)))
    .orderBy(desc(robotMessages.createdAt), asc(robotMessages.role)).limit(limit)).reverse();
  const ids = M.filter((m) => m.role === 'assistant').map((m) => m.id);
  const P = ids.length ? await tx.select().from(robotProposals).where(and(eq(robotProposals.firmId, firmId), inArray(robotProposals.messageId, ids))).orderBy(asc(robotProposals.createdAt)) : [];
  return { messages: M, proposals: P };
}

/** Earlier turns (text only) for the model: the last `n` done turns created before `before`. */
export async function robotHistory(tx: Tx, userId: string, firmId: string, before: Date, n = 8): Promise<{ role: 'user' | 'assistant'; text: string }[]> {
  const M = await tx.select({ role: robotMessages.role, text: robotMessages.text, status: robotMessages.status }).from(robotMessages)
    .where(and(eq(robotMessages.userId, userId), eq(robotMessages.firmId, firmId), eq(robotMessages.archived, false), lt(robotMessages.createdAt, before)))
    .orderBy(desc(robotMessages.createdAt), asc(robotMessages.role)).limit(n + 2);
  return M.reverse().filter((m) => m.status === 'done' && m.text).map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }));
}

/** The question plus a queued answer row; returns both ids. */
export async function robotAskRows(tx: Tx, a: { userId: string; firmId: string; year: number; text: string; deep: boolean }): Promise<{ questionId: string; answerId: string }> {
  const [q] = await tx.insert(robotMessages).values({ userId: a.userId, firmId: a.firmId, year: a.year, role: 'user', text: a.text, status: 'done', deep: a.deep }).returning({ id: robotMessages.id });
  const [r] = await tx.insert(robotMessages).values({ userId: a.userId, firmId: a.firmId, year: a.year, role: 'assistant', text: '', status: 'queued', deep: a.deep, replyTo: q!.id }).returning({ id: robotMessages.id });
  return { questionId: q!.id, answerId: r!.id };
}

/** Attach the drafts created while answering to the answer row. */
export async function robotLinkProposals(tx: Tx, firmId: string, ids: readonly string[], messageId: string): Promise<void> {
  if (ids.length) await tx.update(robotProposals).set({ messageId }).where(and(eq(robotProposals.firmId, firmId), inArray(robotProposals.id, [...ids])));
}

export interface FreeAnswer { tool: string; out: ToolOut }

/**
 * Free-first: answer with one deterministic tool when the keyword router recognises the question (no model call,
 * no AI cost). Null when the question needs the agent.
 */
export async function robotFreeAnswer(c: RobotCtx, question: string): Promise<FreeAnswer | null> {
  const hit = routeQuestion(question, c.year);
  if (!hit) return null;
  const out = await runRobotTool(c, hit.tool, hit.input);
  // an ambiguous / failed lookup is better handled by the agent when AI is available; the caller decides
  // an Albanian question: a short Albanian heading over the (Macedonian) tool output
  return { tool: hit.tool, out: robotIsAlbanian(question) ? { ...out, summary: `${robotSqHeading(hit.tool)}\n${out.summary}` } : out };
}

/** Store a finished answer. */
export async function robotFinish(tx: Tx, id: string, a: { text: string; status?: 'done' | 'error'; free?: boolean; tools?: RobotMessage['tools']; sources?: RobotMessage['sources']; unverified?: string[]; model?: string | null; costUsd?: number; error?: string | null }): Promise<void> {
  await tx.update(robotMessages).set({
    text: a.text, status: a.status ?? 'done', free: a.free ?? false, tools: a.tools ?? [], sources: a.sources ?? [], unverified: a.unverified ?? [],
    model: a.model ?? null, costUsd: (a.costUsd ?? 0).toFixed(6), error: a.error ?? null,
  }).where(eq(robotMessages.id, id));
}

export { runRobotTool };
