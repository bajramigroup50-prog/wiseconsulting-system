import 'server-only';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { appSettings } from '@wise/db';
import { applyInvoiceTranslations, localizeInvoiceHtml, type InvoiceLang } from '@wise/core/sales/invoice-i18n';
import { db } from './db';
import { deeplConfigured, deeplErr, deeplText, DEEPL_NO_KEY } from './deepl';

/**
 * 🌐 The invoice print in EN / DE: the fixed labels from `@wise/core/sales/invoice-i18n`, the rest (item names, amount
 * in words, notes) through DeepL. DeepL's answer is kept per invoice and language (`app_settings` key
 * `deeplInv:<id>:<lang>`) so printing it again costs no characters; a changed invoice is translated again.
 */
export async function translateInvoiceHtml(invoiceId: string, html: string, lang: InvoiceLang, keep: (string | null | undefined)[]): Promise<{ html: string; error?: string }> {
  const r = localizeInvoiceHtml(html, lang, keep);
  if (!r.rest.length) return { html: r.html };
  const key = `deeplInv:${invoiceId}:${lang}`;
  const hash = createHash('sha256').update(r.rest.join('\u0000')).digest('hex').slice(0, 32);
  const [c] = await db().select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const cached = c?.v as { hash?: string; tr?: Record<string, string> } | undefined;
  if (cached?.hash === hash && cached.tr) return { html: applyInvoiceTranslations(r.html, new Map(Object.entries(cached.tr))) };
  if (!deeplConfigured()) return { html: r.html, error: `Ставките останаа на македонски: ${DEEPL_NO_KEY}` };
  try {
    const t = await deeplText(r.rest, lang, 'MK');
    const tr = Object.fromEntries(r.rest.map((x, i) => [x, t.texts[i] ?? x]));
    await db().insert(appSettings).values({ key, value: { hash, tr } })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: { hash, tr } } });
    return { html: applyInvoiceTranslations(r.html, new Map(Object.entries(tr))) };
  } catch (e) {
    return { html: r.html, error: `Ставките останаа на македонски: ${deeplErr(e)}` };
  }
}
