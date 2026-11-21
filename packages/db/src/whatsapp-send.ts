/**
 * 💬 Send from WISE through the WhatsApp Cloud API: the 24-hour rule (free text / PDF inside the window, an approved
 * template outside it), the office's rate limit, the PDF uploaded to Meta and sent as a document, every send (or
 * failed try) logged in `wa_messages` and the audit log. The Graph client and the file reader are injected (tests
 * and local development use a mock; Meta is never called from tests). The caller checked who may send what.
 */
import { waGraph, WaGraphError, type Fetch } from './whatsapp-graph';
import {
  waActive, waDocPayload, waPhone, waPlan, waRateRefusal, waTemplatePayload, waTextPayload,
  type WaLang, type WaPurpose, type WaVar,
} from '@wise/core/whatsapp/wa';
import type { DB } from './index';
import type { Tx } from './audit';
import { waLastIn, waRecentOut, waRecordOut, waSecrets } from './whatsapp';

export interface WaSendInput {
  userId: string | null; firmId: string | null; phone: string; text?: string | null;
  fileIds?: readonly string[]; purpose: WaPurpose; lang?: WaLang;
  vars?: Partial<Record<WaVar, string | number | null | undefined>>;
  /** a reply in the conversation view: free text only, never a template */
  freeOnly?: boolean;
}
export interface WaFile { bytes: Uint8Array; mime: string; name: string }
export interface WaSendDeps { fetch?: Fetch; base?: string; readFile: (fileId: string) => Promise<WaFile>; now?: Date }
export type WaSendResult = { ok: string; sent: number } | { error: string; off?: true };

const errText = (e: unknown) => (e instanceof WaGraphError ? 'Meta: ' + e.message : e instanceof Error ? e.message : String(e));

export async function waSend(db: DB, a: WaSendInput, deps: WaSendDeps): Promise<WaSendResult> {
  const t = db as unknown as Tx;
  const s = await waSecrets(t);
  if (!waActive(s) || !s.accessToken || !s.secret) return { error: 'WhatsApp од WISE е исклучен – користете го линкот (wa.me).', off: true };
  const to = waPhone(a.phone);
  if (!to) return { error: 'Внесете валиден телефонски број (на пр. 070 123 456).' };
  const text = String(a.text ?? '').trim();
  const fileIds = [...new Set(a.fileIds ?? [])].slice(0, 10);
  if (!text && !fileIds.length && !a.vars) return { error: 'Нема што да се испрати.' };
  const now = deps.now ?? new Date();
  const plan = waPlan({ lastIn: await waLastIn(t, to), now, purpose: a.purpose, lang: a.lang, templates: s.templates, vars: { tekst: text, ...a.vars }, hasDoc: fileIds.length > 0, freeOnly: a.freeOnly });
  if ('error' in plan) return { error: plan.error };
  if (plan.kind === 'template' && fileIds.length > 1) return { error: 'Надвор од 24-часовниот прозорец шаблонот носи само еден PDF. Испратете ги документите еден по еден.' };
  const count = plan.kind === 'template' ? 1 : (text ? 1 : 0) + fileIds.length;
  const refused = waRateRefusal(await waRecentOut(t, now), s, now, count);
  if (refused) return { error: refused };

  const g = waGraph({ phoneNumberId: s.phoneNumberId, token: s.accessToken, fetch: deps.fetch, base: deps.base });
  const log = (o: Omit<Parameters<typeof waRecordOut>[1], 'firmId' | 'phone' | 'userId' | 'purpose'>) =>
    db.transaction((tx) => waRecordOut(tx as unknown as Tx, { ...o, firmId: a.firmId, phone: to, userId: a.userId, purpose: a.purpose }));
  let sent = 0;
  if (plan.kind === 'template') {
    let doc: { mediaId: string; filename: string } | undefined, fileName: string | null = null;
    try {
      if (plan.tpl.doc && fileIds[0]) {
        const f = await deps.readFile(fileIds[0]);
        doc = { mediaId: await g.upload(f.bytes, f.mime, f.name), filename: f.name };
        fileName = f.name;
      }
      const waId = await g.send(waTemplatePayload(to, plan.tpl, plan.params, doc));
      await log({ kind: 'template', body: plan.params.join(' · '), waId, status: 'sent', template: `${plan.tpl.name}/${plan.tpl.lang}`, fileId: fileIds[0] ?? null, fileName });
      return { ok: `✓ Испратено преку шаблонот „${plan.tpl.name}“ (клиентот не пишал во последните 24 часа).`, sent: 1 };
    } catch (e) {
      await log({ kind: 'template', body: plan.params.join(' · '), status: 'failed', error: errText(e), template: `${plan.tpl.name}/${plan.tpl.lang}`, fileId: fileIds[0] ?? null, fileName });
      return { error: errText(e) };
    }
  }
  try {
    if (text) {
      const waId = await g.send(waTextPayload(to, text));
      await log({ kind: 'text', body: text, waId, status: 'sent' });
      sent++;
    }
    for (const id of fileIds) {
      const f = await deps.readFile(id);
      const mediaId = await g.upload(f.bytes, f.mime, f.name);
      const waId = await g.send(waDocPayload(to, mediaId, f.name));
      await log({ kind: 'document', waId, status: 'sent', fileId: id, fileName: f.name });
      sent++;
    }
  } catch (e) {
    await log({ kind: sent === 0 && text ? 'text' : 'document', body: sent === 0 ? text || null : null, status: 'failed', error: errText(e) });
    return { error: (sent ? `Испратени ${sent}, потоа: ` : '') + errText(e) };
  }
  return { ok: `✓ Испратено на WhatsApp (${sent} ${sent === 1 ? 'порака' : 'пораки'}).`, sent };
}

/** „Испрати тест порака“ on the settings page: the connection check + one text (needs the 24-hour window or a template). */
export async function waTestSend(db: DB, a: { userId: string; phone: string }, deps: Omit<WaSendDeps, 'readFile'>): Promise<WaSendResult> {
  const s = await waSecrets(db as unknown as Tx);
  if (!s.phoneNumberId || !s.accessToken) return { error: 'Внесете Phone Number ID и токен.' };
  try {
    const i = await waGraph({ phoneNumberId: s.phoneNumberId, token: s.accessToken, fetch: deps.fetch, base: deps.base }).phoneInfo();
    if (!a.phone) return { ok: `✓ Врската работи: ${i.display} (${i.name}${i.quality ? ', квалитет ' + i.quality : ''}).`, sent: 0 };
  } catch (e) { return { error: errText(e) }; }
  if (!s.on) return { error: 'Врската работи, но WhatsApp е исклучен – вклучете го за да испратите тест порака.' };
  return waSend(db, { userId: a.userId, firmId: null, phone: a.phone, text: '✅ Тест порака од WISE – WhatsApp е поврзан.', purpose: 'opsto', vars: { tekst: 'Тест порака од WISE', kancelarija: 'WISE CONSULTING' } }, { ...deps, readFile: async () => { throw new Error('—'); } });
}
