/**
 * Reads of the `ai_documents` kinds that only store the parsed model JSON (`result`) for the screen that started them:
 *
 *   blg      cash-register receipts, `BLG_PROMPT` (legacy `blgScanFiles`: quick tier, default for images)
 *   emp      employment documents, `EMP_PROMPT` (legacy `readEmployeeDocs`)
 *   bank     PDF / image bank statements, inline prompt of `importBankImg`
 *   fisk     fiscal reports, `FISK_PROMPT` (complex tier) + post-read fixes, `FK_SIMPLE` second read when the total is 0
 *   classify office inbox file, inline prompt of `irClassify`
 *   bom      BOM suggestion for a product, inline prompt of `bomAI` — no file, the prompt lists the firm's materials
 *
 * The mapping to vouchers / statements / employees / fiscal rows / BOM lines is in `@wise/core/ai/*` and runs where
 * the user reviews the result; nothing is saved from here.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import { bomMaterials } from '@wise/core/ai/bom';
import { fiskAfterRead, fiskApplySimple, fiskFinish, fiskReadTotal } from '@wise/core/ai/fisk';
import { RC_DOC_PROMPT, RC_DOC_PROMPT_LICENCE, VREG_PROMPT } from '@wise/core/industry';
import { FS_PROMPT } from '@wise/core/firms/resh';
import { items, type AiDocKind, type AiDocument, type Firm, type Tx } from '@wise/db';
import type { AiTier } from './client';
import { BANK_CLASSIFY_PROMPT, BANK_PROMPT, BLG_PROMPT, BOM_PROMPT, CLASSIFY_PROMPT, EMP_PROMPT, FISK_PROMPT, FK_SIMPLE, IMP_PROMPT, OB_PROMPT, PUR_PROMPT, REC_PROMPT, SCR_PROMPT } from './prompts';
import { AiReadError, fileContent, loadFile, readContent } from './read-document';
import { readObject } from './storage';

/** Kinds handled here (the others are purchase / sale drafts). */
export const RESULT_KINDS: ReadonlySet<AiDocKind> = new Set<AiDocKind>(['blg', 'emp', 'bank', 'fisk', 'classify', 'bom', 'cmp', 'imp', 'scr', 'ob', 'rec', 'bankcls',
  'vreg',
  'rcdoc', 'rclic',
  'tk',
]);

type Content = { blocks: Anthropic.ContentBlockParam[]; extra: string };
const isImage = (c: Content) => c.blocks.some((b) => b.type === 'image');

/** Read one document of a result kind; returns the JSON to store in `ai_documents.result`. */
export async function readResultKind(db: Tx, doc: AiDocument, f: Firm, today = new Date().toISOString().slice(0, 10)): Promise<{ result: unknown; model: string }> {
  const base = { db, firmId: f.id, purpose: doc.kind, refId: doc.id, userId: doc.createdBy };
  let content: Content = { blocks: [], extra: '' };
  if (doc.kind !== 'bom' && doc.kind !== 'bankcls') {
    if (!doc.fileId) throw new AiReadError('Датотеката не е пронајдена.');
    const file = await loadFile(db, f.id, doc.fileId);
    content = fileContent(file, await readObject(file.bucketKey));
    // legacy `fkTiles` 13005 + `FK_TILE_NOTE` 13010: several photos / pages of ONE fiscal report read together
    const extra = ((doc.options ?? {}) as { extraFileIds?: string[] }).extraFileIds ?? [];
    if (doc.kind === 'fisk' && extra.length) {
      for (const id of extra.slice(0, 7)) {
        const x = await loadFile(db, f.id, id);
        const c = fileContent(x, await readObject(x.bucketKey));
        content = { blocks: [...content.blocks, ...c.blocks], extra: content.extra + c.extra };
      }
      content.extra += '\n\nThe images are CONSECUTIVE PARTS (top → bottom, slightly overlapping) of ONE long fiscal receipt/report – read them together as one document and do not count overlapping lines twice.';
    }
  }
  const read = async (prompt: string, tier: AiTier) => readContent<unknown>({ ...base, prompt, tier }, content);

  switch (doc.kind) {
    case 'blg': {
      const r = await read(BLG_PROMPT, isImage(content) ? 'default' : 'quick');
      return { result: r.data, model: r.model };
    }
    case 'emp': {
      const r = await read(EMP_PROMPT, 'default');
      return { result: r.data, model: r.model };
    }
    case 'bank': {
      const r = await read(BANK_PROMPT, 'default');
      return { result: r.data, model: r.model };
    }
    case 'ob': {
      // legacy `obAi` 10646 read the text in ~11k parts; one complex-tier read with a large answer here
      const r = await readContent<unknown>({ ...base, prompt: OB_PROMPT, tier: 'complex', maxTokens: 20000 }, content); // non-streaming limit of the SDK (~21k)
      return { result: r.data, model: r.model };
    }
    case 'bankcls': {
      // legacy `aiClassify` 4856: the lists were built when the read was started (options), prompt verbatim
      const o = (doc.options ?? {}) as { acc?: string; docs?: string; lines?: string };
      if (!o.lines) throw new AiReadError('Нема непрокнижени ставки.');
      const r = await readContent<unknown>({ ...base, prompt: BANK_CLASSIFY_PROMPT(f.name, o.acc ?? '', o.docs ?? '(none)', o.lines), tier: 'default', maxTokens: 16000 }, content);
      return { result: r.data, model: r.model };
    }
    case 'rec': {
      const r = await readContent<unknown>({ ...base, prompt: REC_PROMPT, tier: 'default', maxTokens: 16000 }, content);
      return { result: r.data, model: r.model };
    }
    case 'classify': {
      const r = await read(CLASSIFY_PROMPT, 'default');
      return { result: r.data, model: r.model };
    }
    case 'rcdoc':
    case 'rclic': {
      // legacy `rcScanDoc` (rent-a-car customer: passport / ID card / driving licence → contract form)
      const r = await read(doc.kind === 'rclic' ? RC_DOC_PROMPT_LICENCE : RC_DOC_PROMPT, 'default');
      return { result: r.data, model: r.model };
    }
    case 'tk': {
      // legacy v404 `tkRead` 13442: the ЦРМ extract (тековна состојба) read with the firm-decision prompt
      const r = await read(FS_PROMPT, 'default');
      return { result: r.data, model: r.model };
    }
    case 'vreg': {
      // legacy DIG.vreg (сообраќајна дозвола → customer vehicle form)
      const r = await read(VREG_PROMPT, 'default');
      return { result: r.data, model: r.model };
    }
    case 'fisk': {
      const r = await read(FISK_PROMPT, 'complex');
      const R = fiskAfterRead(r.data);
      let model = r.model;
      if (!(fiskReadTotal(R, today) > 0)) {
        // legacy wrapper 13035: second, simple read of the total only
        try {
          const s = await read(FK_SIMPLE, 'complex');
          fiskApplySimple(R, s.data);
          model = s.model;
        } catch (e) {
          if (!(e instanceof AiReadError)) throw e;
        }
      }
      fiskFinish(R, today);
      return { result: R, model };
    }
    case 'bom': {
      const productId = String((doc.options as { productId?: string }).productId ?? '');
      const I = await db.select({ id: items.id, name: items.name, unit: items.unit, type: items.type, active: items.active })
        .from(items).where(and(eq(items.firmId, f.id), eq(items.active, true)));
      const p = I.find((i) => i.id === productId);
      if (!p) throw new AiReadError('Производот не е пронајден.');
      const M = bomMaterials(I, p.id);
      if (!M.length) throw new AiReadError('Нема суровини во шифрарникот – прво внесете ги материјалите (вид „Суровина / материјал“).');
      const r = await readContent<unknown>({ ...base, prompt: BOM_PROMPT(p, M), tier: 'default', maxTokens: 4000 }, content);
      return { result: r.data, model: r.model };
    }
    case 'cmp': {
      // legacy `aiCmpGo` (14416): the same invoice read with the quick and the detailed model; nothing is saved
      const one = async (tier: AiTier) => { try { const r = await read(PUR_PROMPT, tier); return { data: r.data, model: r.model, cost: r.costUsd, error: null }; } catch (e) { if (!(e instanceof AiReadError)) throw e; return { data: null, model: '', cost: 0, error: e.message }; } };
      const quick = await one('quick');
      const deep = await one('default');
      return { result: { quick, deep }, model: [quick.model, deep.model].filter(Boolean).join(' / ') };
    }
    case 'scr': {
      // legacy `scrScanFile` (16221): supplier return / credit note, SCR_PROMPT with the own firm
      const r = await read(SCR_PROMPT(f), 'default');
      return { result: r.data, model: r.model };
    }
    case 'imp': {
      // legacy `readImportDocs` (4365): one import document (supplier invoice, ЕЦД, forwarding, transport, other cost)
      const r = await read(IMP_PROMPT, 'default');
      return { result: r.data, model: r.model };
    }
    default:
      throw new AiReadError('Непознат вид на читање.');
  }
}
