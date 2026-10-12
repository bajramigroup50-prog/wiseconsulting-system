'use strict';
// Common fiscal receipt model of every driver + input validation + the Macedonian error messages.
//
// Receipt (what the web page sends; built on the server by @wise/core/retail `toFiscalReceipt`):
//   { items: [{ name, qty, price, vat: 'А'|'Б'|'В'|'Г', mk?: boolean }],      price = unit price incl. VAT (> 0)
//     discountPct?: number (0 … 99, a discount over the subtotal),
//     payments: { card?: number, cash?: number },                            the rest is paid in cash
//     ref?: string (storno only: number of the original fiscal receipt) }
//
// VAT groups (Правилник за означување на даночните стапки во фискалните апарати): А = 18 %, Б = 5 %, В = 10 %,
// Г = exempt / 0 % (and the group a non-VAT-payer firm uses). The device itself holds the rates; we send letters only.

const VAT_GROUPS = Object.freeze(['А', 'Б', 'В', 'Г']); // Cyrillic letters (cp1251 0xC0–0xC3)
const LATIN_TO_CYR = { A: 'А', B: 'Б', V: 'В', G: 'Г', C: 'В', D: 'Г' };

/** Error codes of every driver → message for the cashier (Macedonian). */
const MESSAGES = Object.freeze({
  NOT_CONFIGURED: 'Фискалниот апарат не е подесен на овој компјутер (Фискална каса → ⚙️ Фискален апарат).',
  NOT_CONNECTED: 'Фискалниот апарат не одговара. Проверете дали е вклучен и дали кабелот / мрежата е поврзан(а).',
  PORT_BUSY: 'Портата на фискалниот апарат е зафатена од друга програма. Затворете ја другата програма и обидете се повторно.',
  SERIAL_MISSING: 'Поддршката за COM порти не е инсталирана во оваа верзија на апликацијата. Користете мрежна (LAN) врска или програмата на производителот.',
  PAPER_OUT: 'Нема хартија во фискалниот апарат. Ставете нова ролна и обидете се повторно.',
  COVER_OPEN: 'Капакот на фискалниот апарат е отворен.',
  PRINTER_FAULT: 'Дефект на механизмот за печатење на фискалниот апарат.',
  FM_FULL: 'Фискалната меморија е полна. Повикајте го овластениот сервис.',
  FM_ERROR: 'Грешка во фискалната меморија (само за читање / оштетена). Повикајте го овластениот сервис.',
  CLOCK: 'Часовникот на фискалниот апарат не е подесен (по исклучување). Подесете го датумот и времето на апаратот.',
  RECEIPT_OPEN: 'На фискалниот апарат има отворена сметка. Довршете ја или поништете ја на апаратот, па обидете се повторно.',
  NOT_ALLOWED: 'Фискалниот апарат ја одби командата во моменталната состојба (отворена сметка, дневен извештај веќе направен или апаратот не е фискализиран).',
  SYNTAX: 'Фискалниот апарат ја одби командата (неважечки податоци).',
  OVERFLOW: 'Износот е преголем за фискалниот апарат.',
  DEVICE_ERROR: 'Фискалниот апарат пријави грешка.',
  NO_ANSWER_FILE: 'Програмата на производителот не врати одговор (нема излезна датотека). Сметката НЕ е потврдена.',
  INVALID_INPUT: 'Неважечки податоци за фискалната сметка.',
  BUSY: 'Фискалниот апарат е зафатен со друга сметка. Почекајте.',
  FORBIDDEN: 'Пристапот до фискалниот апарат е дозволен само од страниците на WISE.',
});

class FiscalError extends Error {
  constructor(code, detail) {
    super(detail ? `${MESSAGES[code] || MESSAGES.DEVICE_ERROR} (${detail})` : (MESSAGES[code] || MESSAGES.DEVICE_ERROR));
    this.code = code;
  }
}

const fail = (code, detail) => { throw new FiscalError(code, detail); };
const num = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')));
const r2 = (v) => Math.round(v * 100) / 100;

/** Names the devices accept: printable, no separators (TAB/LF/;), trimmed to `max` characters. */
function cleanName(s, max) {
  const t = String(s ?? '').replace(/[\u0000-\u001F\u007F;]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (t || 'Артикл').slice(0, max);
}

function vatOf(v) {
  const s = String(v ?? '').trim().toUpperCase();
  const c = VAT_GROUPS.includes(s) ? s : LATIN_TO_CYR[s];
  return c || fail('INVALID_INPUT', `даночна група „${v}“`);
}

/**
 * Validates and normalises a receipt (throws FiscalError INVALID_INPUT). `max` = the device's name length;
 * at most 99 sale lines per receipt (Datecs-family limit).
 */
function normalizeReceipt(r, { nameMax = 22, storno = false } = {}) {
  if (!r || typeof r !== 'object') fail('INVALID_INPUT');
  const items = Array.isArray(r.items) ? r.items : [];
  if (!items.length) fail('INVALID_INPUT', 'нема ставки');
  if (items.length > 99) fail('INVALID_INPUT', 'повеќе од 99 ставки во една сметка');
  const out = items.map((it, i) => {
    const qty = num(it && it.qty), price = num(it && it.price);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 99999.999) fail('INVALID_INPUT', `ставка ${i + 1}: количина`);
    if (!Number.isFinite(price) || price <= 0 || price > 9999999.99) fail('INVALID_INPUT', `ставка ${i + 1}: цена`);
    return { name: cleanName(it.name, nameMax), qty: Math.round(qty * 1000) / 1000, price: r2(price), vat: vatOf(it.vat), mk: !!it.mk };
  });
  const discountPct = r.discountPct == null || r.discountPct === '' ? 0 : r2(num(r.discountPct));
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 99) fail('INVALID_INPUT', 'попуст');
  const gross = r2(out.reduce((s, x) => s + r2(x.qty * x.price), 0));
  const total = r2(gross * (1 - discountPct / 100));
  const p = r.payments || {};
  const card = p.card == null || p.card === '' ? 0 : r2(num(p.card));
  if (!Number.isFinite(card) || card < 0 || card > total + 0.005) fail('INVALID_INPUT', 'плаќање со картичка');
  const ref = r.ref == null ? '' : String(r.ref).replace(/[^\w\-/. ]/g, '').slice(0, 20);
  if (storno && !ref) fail('INVALID_INPUT', 'сторно без број на оригиналната сметка');
  return { items: out, discountPct, total, payments: { card }, ref };
}

/** Status of a driver result for the page (never contains stack traces / paths). */
function errorResult(e) {
  const code = e && e.code && MESSAGES[e.code] ? e.code : 'DEVICE_ERROR';
  return { ok: false, code, error: e && e.message ? String(e.message).slice(0, 300) : MESSAGES[code] };
}

module.exports = { VAT_GROUPS, MESSAGES, FiscalError, fail, normalizeReceipt, cleanName, errorResult, r2 };
