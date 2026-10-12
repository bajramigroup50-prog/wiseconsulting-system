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
import { ZM_PROMPT } from '@wise/core/yearend/zm-import';
import { KONTROLA_PROMPT } from '@wise/core/compliance';
import { items, type AiDocKind, type AiDocument, type Firm, type Tx } from '@wise/db';
import type { AiTier } from './client';
import { BANK_CLASSIFY_PROMPT, BANK_PROMPT, BLG_PROMPT, BOM_PROMPT, CLASSIFY_PROMPT, EMP_PROMPT, FISK_PROMPT, FK_SIMPLE, IMP_PROMPT, OB_PROMPT, PUR_PROMPT, REC_PROMPT, SCR_PROMPT } from './prompts';
import { AiReadError, AiTruncatedError, fileContent, loadFile, readContent } from './read-document';
import { CHUNK_MAX_TOKENS, chunkNote, mergeBank, mergeOb, pdfRanges, planPdfRead, type ChunkKind } from './chunked';
import { readObject } from './storage';

import { todaySkopje } from '@wise/core/office/dates';
/** Kinds handled here (the others are purchase / sale drafts). */
export const RESULT_KINDS: ReadonlySet<AiDocKind> = new Set<AiDocKind>(['blg', 'emp', 'bank', 'fisk', 'classify', 'bom', 'cmp', 'imp', 'scr', 'ob', 'rec', 'bankcls',
  'vreg',
  'rcdoc', 'rclic',
  'tk',
  'zm',
  'kontrola',
]);

type Content = { blocks: Anthropic.ContentBlockParam[]; extra: string };
const isImage = (c: Content) => c.blocks.some((b) => b.type === 'image');

/** Progress of a long (chunked) read, shown as „дел 2/5…“. */
export type ReadProgress = (p: string) => Promise<unknown>;

/** Read one document of a result kind; returns the JSON to store in `ai_documents.result`. */
export async function readResultKind(db: Tx, doc: AiDocument, f: Firm, today = todaySkopje(), progress?: ReadProgress): Promise<{ result: unknown; model: string }> {
  // model tiers (cost): Haiku for classification / short ID documents, Sonnet for statements / invoices / reports;
  // the `complex` tier below becomes Sonnet unless the read is an explicit „🔍 Детално читање“ (`options.deep`)
  const base = { db, firmId: f.id, purpose: doc.kind, refId: doc.id, userId: doc.createdBy, deep: !!(doc.options as { deep?: boolean } | null)?.deep };
  let content: Content = { blocks: [], extra: '' };
  let pdf: Uint8Array | null = null;
  if (doc.kind !== 'bom' && doc.kind !== 'bankcls') {
    if (!doc.fileId) throw new AiReadError('Датотеката не е пронајдена.');
    const file = await loadFile(db, f.id, doc.fileId);
    const bytes = await readObject(file.bucketKey);
    content = fileContent(file, bytes);
    if (content.blocks.some((b) => b.type === 'document')) pdf = bytes;
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
  /**
   * Trial balance / statement: the size is estimated first; a large PDF is read in page ranges (never one huge call
   * whose answer cannot fit), a single read cut at max_tokens switches to ranges instead of being repeated.
   * `tier` goes through the one tier rule of `readContent` (`effectiveTier`: Opus only on „🔍 Детално читање“).
   */
  const readLarge = async (kind: ChunkKind, prompt: string, tier: AiTier, maxTokens: number): Promise<{ result: unknown; model: string }> => {
    const plan = pdf ? await planPdfRead(kind, pdf, Math.min(maxTokens, CHUNK_MAX_TOKENS)) : null;
    if (!plan || plan.ranges.length <= 1) {
      try {
        const r = await readContent<unknown>({ ...base, prompt, tier, maxTokens }, content);
        return { result: r.data, model: r.model };
      } catch (e) {
        // cut answer: never the same request again — a PDF of several pages goes page by page, anything else fails now
        if (!(e instanceof AiTruncatedError) || !pdf || !plan || plan.pages < 2) throw e;
        return chunks(kind, prompt, tier, { ...plan, ranges: Array.from({ length: plan.pages }, (_, i) => ({ from: i + 1, to: i + 1 })) });
      }
    }
    return chunks(kind, prompt, tier, plan);
  };
  const chunks = async (kind: ChunkKind, prompt: string, tier: AiTier, plan: NonNullable<Awaited<ReturnType<typeof planPdfRead>>>): Promise<{ result: unknown; model: string }> => {
    const parts = await pdfRanges(pdf!, plan.ranges);
    const out: unknown[] = [];
    let model = '';
    for (const [i, bytes] of parts.entries()) {
      const n = parts.length, r = plan.ranges[i]!;
      await progress?.(`дел ${i + 1}/${n}`);
      const c: Content = { blocks: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') } }], extra: chunkNote(kind, i, n, r, plan.pages) };
      try {
        const x = await readContent<unknown>({ ...base, purpose: `${doc.kind}:chunk`, prompt, tier, maxTokens: CHUNK_MAX_TOKENS }, c);
        out.push(x.data); model = x.model;
      } catch (e) {
        if (e instanceof AiTruncatedError) throw new AiTruncatedError(`Делот ${i + 1}/${n} (страни ${r.from}–${r.to}) е преголем за едно читање – поделете го документот на помали делови.`);
        throw e;
      }
    }
    if (kind === 'ob') { const m = mergeOb(out); return { result: { ...m, warnings: m.check.warnings }, model }; }
    return { result: mergeBank(out), model };
  };

  switch (doc.kind) {
    case 'blg': {
      const r = await read(BLG_PROMPT, isImage(content) ? 'default' : 'quick');
      return { result: r.data, model: r.model };
    }
    case 'emp': {
      const r = await read(EMP_PROMPT, 'default');
      return { result: r.data, model: r.model };
    }
    case 'bank':
      return readLarge('bank', BANK_PROMPT, 'default', 16000);
    case 'ob':
      // legacy `obAi` 10646 read the text in ~11k parts: a large trial balance is read in page ranges (Sonnet; the
      // `complex` tier is Opus only on „🔍 Детално читање“)
      return readLarge('ob', OB_PROMPT, 'complex', 16000);
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
      const r = await read(CLASSIFY_PROMPT, 'quick');
      return { result: r.data, model: r.model };
    }
    case 'rcdoc':
    case 'rclic': {
      // legacy `rcScanDoc` (rent-a-car customer: passport / ID card / driving licence → contract form)
      const r = await read(doc.kind === 'rclic' ? RC_DOC_PROMPT_LICENCE : RC_DOC_PROMPT, 'quick');
      return { result: r.data, model: r.model };
    }
    case 'kontrola': {
      // compliance: the inspection record / decision → structured findings (the office reviews them before use)
      const r = await readContent<unknown>({ ...base, prompt: KONTROLA_PROMPT, tier: 'complex', maxTokens: 12000 }, content);
      return { result: r.data, model: r.model };
    }
    case 'zm': {
      // legacy `zmImport` 10960: the filed annual account (PDF / image) → AOP rows of БС / БУ
      const r = await readContent<unknown>({ ...base, prompt: ZM_PROMPT, tier: 'default', maxTokens: 16000 }, content);
      return { result: r.data, model: r.model };
    }
    case 'tk': {
      // legacy v404 `tkRead` 13442: the ЦРМ extract (тековна состојба) read with the firm-decision prompt
      const r = await read(FS_PROMPT, 'default');
      return { result: r.data, model: r.model };
    }
    case 'vreg': {
      // legacy DIG.vreg (сообраќајна дозвола → customer vehicle form)
      const r = await read(VREG_PROMPT, 'quick');
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
