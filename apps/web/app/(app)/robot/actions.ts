'use server';
/**
 * 🤖 WISE Робот — ask, poll, confirm / cancel drafts, new conversation.
 *
 * The firm and year are ALWAYS the authenticated ones (`currentFirm` with the tab guard `x-wise-firm`, `currentYear`);
 * the question goes to the free keyword router first (no AI cost) and otherwise to the worker job `robot.ask`.
 * A draft (journal / task / reminder) is executed only here, on the human's „✓ Потврди“, by the module's EXISTING
 * server action (its validation, permissions and audit_log); the opomena draft only opens the Опомени screen.
 */
import { and, eq } from 'drizzle-orm';
import { checkJournalProposal, ROBOT_AI_MSG } from '@wise/core/robot';
import { aiBlockedMsg } from '@wise/core/ai/errors';
import {
  aiBudgetStatus, effectiveChart, getAiSettings, robotAskRows, robotFinish, robotFreeAnswer, robotMessages, robotProposals, robotThread,
  type RobotMessage, type RobotProposal, type RobotSource,
} from '@wise/db';
import { Forbidden, requireUser, type SessionUser } from '@/lib/auth';
import { currentFirm, currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { isOfficeOwner } from '@/lib/office-owner';
import { today } from '@/lib/office';
import { saveJournal } from '../nalozi/actions';
import { saveTask } from '../kanc/actions';
import { saveDeadline } from '../dosie/actions';

export interface RobotMsgView {
  id: string; role: 'user' | 'assistant'; text: string; status: RobotMessage['status']; free: boolean; deep: boolean;
  sources: RobotSource[]; tools: string[]; unverified: string[]; at: string;
  /** Only for the office owner. */
  costUsd: number | null;
}
export interface RobotProposalView {
  id: string; messageId: string | null; kind: RobotProposal['kind']; title: string; status: RobotProposal['status']; result: string | null;
  payload: Record<string, unknown>;
}
export interface RobotThreadView { firm: { id: string; name: string } | null; year: number; owner: boolean; messages: RobotMsgView[]; proposals: RobotProposalView[]; error?: string }

const office = (u: SessionUser) => u.role !== 'klient' && u.role !== 'teren';
const ownerOf = async (u: SessionUser) => u.role === 'admin' && await isOfficeOwner(u).catch(() => false);
const errMsg = (e: unknown): string => (e instanceof Forbidden ? e.message : e instanceof Error && e.message === 'Изберете фирма.' ? e.message : 'Грешка – обидете се повторно.');

async function ctx() {
  const u = await requireUser();
  if (!office(u)) throw new Forbidden('robot');
  const firm = await currentFirm(u);
  const year = await currentYear();
  return { u, firm, year };
}

function view(t: Awaited<ReturnType<typeof robotThread>>, owner: boolean): Pick<RobotThreadView, 'messages' | 'proposals'> {
  return {
    messages: t.messages.map((m) => ({
      id: m.id, role: m.role, text: m.text, status: m.status, free: m.free, deep: m.deep, sources: m.sources, tools: m.tools.map((x) => x.name),
      unverified: m.unverified, at: m.createdAt.toISOString(), costUsd: owner && m.role === 'assistant' ? Number(m.costUsd) : null,
    })),
    proposals: t.proposals.map((p) => ({ id: p.id, messageId: p.messageId, kind: p.kind, title: p.title, status: p.status, result: p.result, payload: p.payload })),
  };
}

/** The conversation of the current user in the current firm. */
export async function robotPoll(): Promise<RobotThreadView> {
  try {
    const { u, firm, year } = await ctx();
    const owner = await ownerOf(u);
    if (!firm) return { firm: null, year, owner, messages: [], proposals: [] };
    return { firm: { id: firm.id, name: firm.name }, year, owner, ...view(await robotThread(db(), u.id, firm.id), owner) };
  } catch (e) {
    return { firm: null, year: 0, owner: false, messages: [], proposals: [], error: errMsg(e) };
  }
}

/** Why the agent cannot run right now (AI switch, remembered credit / key failure, budget pause), or null. */
async function aiBlocked(firmId: string): Promise<string | null> {
  const S = await getAiSettings(db());
  if (!S.enabled) return ROBOT_AI_MSG.off;
  if (S.lastFail) return aiBlockedMsg(S.lastFail.code, S.lastFail.at);
  const B = await aiBudgetStatus(db(), firmId);
  if (B.paused) return B.msg;
  return null;
}

/** Ask a question. Free router first (unless „Длабока анализа“), then the worker agent. */
export async function robotAsk(text0: string, deep = false): Promise<{ error?: string }> {
  try {
    const { u, firm, year } = await ctx();
    if (!firm) return { error: 'Изберете фирма.' };
    const text = String(text0 ?? '').trim().slice(0, 2000);
    if (!text) return { error: 'Внесете прашање.' };
    const { answerId } = await db().transaction((tx) => robotAskRows(tx, { userId: u.id, firmId: firm.id, year, text, deep: !!deep }));
    const blocked = await aiBlocked(firm.id);
    if (!deep) {
      const c = { db: db(), firm, year, userId: u.id, today: today(), owner: await ownerOf(u) };
      const free = await robotFreeAnswer(c, text).catch(() => null);
      // a clear deterministic answer → no AI; an ambiguous lookup goes to the agent when AI is available
      if (free && (free.out.ok || blocked)) {
        await robotFinish(db(), answerId, { text: free.out.summary, free: true, tools: [{ name: free.tool, ok: free.out.ok }], sources: free.out.sources });
        return {};
      }
    }
    if (blocked) {
      await robotFinish(db(), answerId, { text: blocked, status: 'error', error: 'blocked' });
      return {};
    }
    await enqueue('robot.ask', { id: answerId });
    return {};
  } catch (e) { return { error: errMsg(e) }; }
}

/** „🗑 Нов разговор“: hide the turns (kept for the record). */
export async function robotClear(): Promise<{ error?: string }> {
  try {
    const { u, firm } = await ctx();
    if (!firm) return {};
    await db().update(robotMessages).set({ archived: true }).where(and(eq(robotMessages.userId, u.id), eq(robotMessages.firmId, firm.id)));
    return {};
  } catch (e) { return { error: errMsg(e) }; }
}

async function openProposal(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const { u, firm, year } = await ctx();
  if (!firm) return null;
  // only the user's own draft, in the firm the page is rendered for (tab guard in currentFirm)
  const [p] = await db().select().from(robotProposals).where(and(eq(robotProposals.id, id), eq(robotProposals.firmId, firm.id), eq(robotProposals.userId, u.id))).limit(1);
  return p ? { u, firm, year, p } : null;
}

const decide = (id: string, status: 'confirmed' | 'cancelled' | 'failed', result: string | null) =>
  db().update(robotProposals).set({ status, result, decidedAt: new Date() }).where(eq(robotProposals.id, id));

const isRedirect = (e: unknown) => typeof (e as { digest?: unknown })?.digest === 'string' && (e as { digest: string }).digest.startsWith('NEXT_REDIRECT');

/** „✕ Откажи“ */
export async function robotCancel(id: string): Promise<{ error?: string }> {
  try {
    const o = await openProposal(id);
    if (!o || o.p.status !== 'open') return { error: 'Предлогот не е пронајден.' };
    await decide(id, 'cancelled', null);
    return {};
  } catch (e) { return { error: errMsg(e) }; }
}

/**
 * „✓ Потврди“ — the human executes the draft through the existing server action. Journal / task: the action redirects
 * to the saved record on success (the redirect is passed on). Opomena: opens Опомени with those invoices (`go`).
 */
export async function robotConfirm(id: string): Promise<{ error?: string; ok?: string; go?: string }> {
  const o = await openProposal(id).catch(() => null);
  if (!o || o.p.status !== 'open') return { error: 'Предлогот не е пронајден или е веќе решен.' };
  const { firm, year, p } = o;
  const P = p.payload as Record<string, unknown>;
  if (p.year !== year) return { error: `Предлогот е за ${p.year}, а работите во ${year}.` };
  try {
    if (p.kind === 'journal') {
      // checked again against the CURRENT chart (it may have changed since the draft)
      const chart = new Set((await effectiveChart(db(), firm.id)).map((a) => a.code));
      const chk = checkJournalProposal({ date: P.date, lines: P.lines }, chart, year);
      if (!chk.ok) { await decide(id, 'failed', chk.errors.join(' ')); return { error: chk.errors.join(' ') }; }
      const f = new FormData();
      f.set('payload', JSON.stringify({
        date: P.date, description: String(P.description ?? ''),
        rows: chk.lines.map((l) => ({ account: l.konto, partnerId: l.partnerId ?? '', debit: l.debit ? String(l.debit) : '', credit: l.credit ? String(l.credit) : '', note: l.note ?? '' })),
      }));
      const r = await saveJournal({}, f);
      if (r.error) { await decide(id, 'failed', r.error); return { error: r.error }; }
      await decide(id, 'confirmed', 'Налогот е книжен.');
      return { ok: 'Налогот е книжен.' };
    }
    if (p.kind === 'task') {
      const f = new FormData();
      f.set('title', String(P.title ?? '')); f.set('firmId', firm.id); f.set('due', String(P.due ?? '')); f.set('description', String(P.description ?? ''));
      const r = await saveTask({}, f);
      if (r.error) { await decide(id, 'failed', r.error); return { error: r.error }; }
      await decide(id, 'confirmed', 'Задачата е креирана.');
      return { ok: 'Задачата е креирана.' };
    }
    if (p.kind === 'reminder') {
      const f = new FormData();
      f.set('title', String(P.title ?? '')); f.set('due', String(P.due ?? '')); f.set('remindDays', String(P.remindDays ?? 7)); f.set('note', String(P.note ?? ''));
      const r = await saveDeadline({}, f);
      if (r.error) { await decide(id, 'failed', r.error); return { error: r.error }; }
      await decide(id, 'confirmed', r.ok ?? 'Рокот е зачуван.');
      return { ok: r.ok ?? 'Рокот е зачуван.', go: '/dosie' };
    }
    if (p.kind === 'dunning') {
      const G = (Array.isArray(P.partners) ? P.partners : []) as { invoices?: { id: string }[] }[];
      const ids = G.flatMap((g) => (g.invoices ?? []).map((x) => x.id)).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
      await decide(id, 'confirmed', 'Отворени Опомени – праќањето/печатењето го правите таму.');
      return { go: '/opomeni' + (ids.length ? '?ids=' + ids.join(',') : '') };
    }
    return { error: 'Непознат предлог.' };
  } catch (e) {
    if (isRedirect(e)) {
      // the existing action saved the record and redirects to it
      await decide(id, 'confirmed', p.kind === 'journal' ? 'Налогот е книжен.' : 'Задачата е креирана.');
      throw e;
    }
    return { error: errMsg(e) };
  }
}
