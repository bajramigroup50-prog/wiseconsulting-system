/**
 * Accounting workflows driven through the real screens (the parts that are mostly UI): partner and item forms →
 * invoice editor (18 % + 5 %) → print view → credit note → VAT books; bank statement upload for a firm without a
 * bank account → automatic booking review; opening balance from Excel in the editor → trial balance.
 * The service-level checks of the same flows (amounts per konto) are in packages/db/src/flows and apps/web/test/flows.
 */
import { expect, test, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { ERROR_TEXT, login, newFirm, openFirm, watch } from './helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(10 * 60_000);

const stamp = String(Date.now()).slice(-6);
const FIRM = `Е2Е ТЕК ТОК ${stamp} ДООЕЛ`;
const CUST = `КУПУВАЧ ${stamp} ДООЕЛ`;
const ITEM = `Консултантска услуга ${stamp}`;
const year = new Date().getFullYear();
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Skopje' });
let invoiceId = '';

const editor = (page: Page) => page.locator('form:has(input[name=payload])');
const num = (s: string) => Number(s.replace(/\./g, '').replace(/\s/g, '').replace(',', '.'));

async function ok(page: Page, w: ReturnType<typeof watch>) {
  await expect(page.getByText(ERROR_TEXT)).toHaveCount(0);
  expect(w.take()).toEqual([]);
}

test('sales invoice through the editor, print, credit note, VAT book', async ({ page }) => {
  const w = watch(page);
  await login(page);
  await newFirm(page, FIRM, '4030' + String(Date.now()).slice(-9));

  // partner and item through their forms
  await page.goto('/partneri?nov');
  const pf = page.locator('form.card:has(input[name=name])');
  await pf.locator('input[name=name]').fill(CUST);
  await pf.locator('input[name=edb]').fill('4030026' + stamp);
  await pf.locator('input[name=city]').fill('Битола');
  await pf.getByRole('button', { name: 'Зачувај' }).click();
  await expect(page.getByText(CUST).first()).toBeVisible();
  await page.goto('/artikli?nov');
  const itf = page.locator('form.card:has(input[name=name])');
  await itf.locator('input[name=name]').fill(ITEM);
  await itf.locator('select[name=type]').selectOption('service');
  await itf.locator('select[name=vatRate]').selectOption('18');
  await itf.getByRole('button', { name: 'Зачувај' }).click();
  await expect(page.getByText(ITEM).first()).toBeVisible();
  await ok(page, w);

  // the invoice editor
  await page.goto('/izlez?nov');
  const ed = editor(page);
  await expect(ed).toBeVisible();
  const ps = ed.getByRole('combobox', { name: 'Комитент', exact: true });
  await ps.selectOption(await ps.locator('option', { hasText: CUST }).first().getAttribute('value'));
  const rows = ed.locator('table tbody tr');
  if (!(await rows.count())) await ed.getByRole('button', { name: /^\+ Ред/ }).click();
  const r0 = rows.nth(0);
  await r0.locator('td').nth(0).locator('input').fill(ITEM);
  await r0.locator('td').nth(2).locator('input').fill('2');
  await r0.locator('td').nth(3).locator('input').fill('1000');
  await ed.getByRole('button', { name: '+ Услуга (слободен опис)' }).click();
  const r1 = rows.nth(1);
  await r1.locator('td').nth(0).locator('input').fill('Учебници');
  await r1.locator('td').nth(2).locator('input').fill('4');
  await r1.locator('td').nth(3).locator('input').fill('125');
  await r1.locator('td').nth(5).locator('select').selectOption('5');
  await expect(ed.getByText('ДДВ 18%').locator('..')).toContainText('360,00');
  await expect(ed.getByText('ДДВ 5%').locator('..')).toContainText('25,00');
  await expect(ed.getByText('За плаќање', { exact: true }).locator('..')).toContainText('2.885,00');
  await ed.getByRole('button', { name: 'Зачувај и прокнижи' }).click();
  await page.waitForURL(/\/izlez\?saved=/);
  invoiceId = new URL(page.url()).searchParams.get('saved')!;
  await expect(page.getByRole('row', { name: new RegExp(CUST) }).first()).toContainText('2.885,00');
  await ok(page, w);

  // print view of the invoice
  await page.goto(`/print/doc/${invoiceId}`);
  await expect(page.locator('body')).toContainText(CUST);
  await expect(page.locator('body')).toContainText('2.885,00');
  await expect(page.locator('body')).toContainText('Учебници');
  expect(w.take()).toEqual([]);

  // credit note from the invoice (price reduction 200 on the 18 % line, the 5 % line removed)
  await page.goto(`/odobrenija?cr=${invoiceId}`);
  const ce = editor(page);
  await expect(ce).toBeVisible();
  const cr = ce.locator('table tbody tr');
  while ((await cr.count()) > 1) await cr.nth(1).getByRole('button', { name: 'Отстрани ред' }).click();
  await cr.nth(0).locator('td').nth(2).locator('input').fill('1');
  await cr.nth(0).locator('td').nth(3).locator('input').fill('200');
  await expect(ce.getByText('За плаќање', { exact: true }).locator('..')).toContainText('236,00');
  await ce.getByRole('button', { name: 'Зачувај и прокнижи' }).click();
  await page.waitForURL(/\/odobrenija\?saved=/);
  await ok(page, w);

  // VAT book of outgoing invoices: 18 %: 2 000 − 200, 5 %: 500
  await page.goto(`/ddvKnigi?t=out`);
  const body = page.locator('#main');
  await expect(body).toContainText(CUST);
  await expect(body).toContainText('1.800,00');
  await expect(body).toContainText('324,00');
  await expect(body).toContainText('500,00');
  await ok(page, w);
});

test('sales invoice with a 🏭 production line: create the product inline, materials from stock, live margin, save', async ({ page }) => {
  const w = watch(page);
  page.on('dialog', (d) => void d.accept());
  await login(page);
  // own firm and buyer, so the test also runs alone (`-g 🏭`)
  const PF = `Е2Е ПРОИЗВОДСТВО ${stamp} ДООЕЛ`, PCUST = `НАРАЧАТЕЛ ${stamp} ДООЕЛ`;
  await newFirm(page, PF, '4031' + String(Date.now()).slice(-9));
  await page.goto('/partneri?nov');
  const pf = page.locator('form.card:has(input[name=name])');
  await pf.locator('input[name=name]').fill(PCUST);
  await pf.locator('input[name=edb]').fill('4030027' + stamp);
  await pf.getByRole('button', { name: 'Зачувај' }).click();
  await expect(page.getByText(PCUST).first()).toBeVisible();
  // the home page (opened by `newFirm`) may hit the dev PGlite's „unnamed prepared statement“ flake (see README);
  // the errors that count are the ones of the invoice flow below
  w.take();
  const MAT = `Даска ${stamp}`, PROD = `Маса по мерка ${stamp}`;
  await page.goto('/artikli?nov');
  const itf = page.locator('form.card:has(input[name=name])');
  await itf.locator('input[name=name]').fill(MAT);
  await itf.locator('select[name=type]').selectOption('material');
  await itf.getByRole('button', { name: 'Зачувај' }).click();
  await expect(page.getByText(MAT).first()).toBeVisible();

  await page.goto('/izlez?nov');
  const ed = editor(page);
  await expect(ed).toBeVisible();
  // the header no longer has the invoice-level „Производство Да/Не“ switch, only the per-line hint
  await expect(ed.locator('fieldset:has(legend:text-is("Производство")) input[type=radio]')).toHaveCount(0);
  const ps = ed.getByRole('combobox', { name: 'Комитент', exact: true });
  await ps.selectOption(await ps.locator('option', { hasText: PCUST }).first().getAttribute('value'));
  const rows = ed.locator('table tbody tr');
  if (!(await rows.count())) await ed.getByRole('button', { name: /^\+ Ред/ }).click();
  const r0 = rows.nth(0);
  await r0.locator('td').nth(0).locator('input').fill(PROD);
  await r0.locator('td').nth(2).locator('input').fill('2');
  await r0.locator('td').nth(3).locator('input').fill('1000');
  // a plain service line next to the produced one
  await ed.getByRole('button', { name: '+ Услуга (слободен опис)' }).click();
  const svc = ed.locator('table tbody tr:not(.prodrow)').nth(1);
  await svc.locator('td').nth(0).locator('input').fill('Достава');
  await svc.locator('td').nth(3).locator('input').fill('500');

  await ed.getByRole('button', { name: `Производство: ${PROD}` }).click();
  const panel = ed.getByTestId('prod-line');
  await expect(panel).toContainText('Креирај производ');
  await panel.getByRole('button', { name: '+ Креирај производ' }).click();
  await expect(panel).toContainText(`Репроматеријали за „${PROD}“`);
  const search = panel.getByRole('textbox', { name: 'Додај материјал од залиха' });
  await search.fill(MAT.slice(0, 5));
  await expect(panel.locator('.qa-list')).toContainText(MAT);
  await panel.locator('.qa-it', { hasText: MAT }).first().click();
  await panel.getByRole('spinbutton', { name: 'Количина материјал' }).fill('4');
  await panel.getByRole('spinbutton', { name: 'Дополнителни трошоци' }).fill('2500');
  // live calculation: 0 materials on stock (average 0) + 2 500 extra = 2 500 > sale 2 000 → below cost
  const calc = panel.getByTestId('prod-calc');
  await expect(calc).toContainText('2.500,00');
  await expect(panel.getByRole('alert')).toContainText('под цената на чинење');
  await panel.getByRole('spinbutton', { name: 'Дополнителни трошоци' }).fill('300');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(ed.getByTestId('prod-summary')).toContainText('300,00');
  await expect(ed.getByTestId('prod-summary')).toContainText('1.700,00'); // margin 2 000 − 300

  await ed.getByRole('button', { name: 'Зачувај и прокнижи' }).click();
  await page.waitForURL(/\/izlez\?saved=/);
  const id = new URL(page.url()).searchParams.get('saved')!;
  await expect(page.getByRole('row').filter({ hasText: PCUST }).filter({ hasText: '🏭' })).toHaveCount(1); // the production order pill
  // edit: the line is still marked and its materials are kept
  await page.goto(`/izlez?edit=${id}`);
  const e2 = editor(page);
  await expect(e2.getByRole('button', { name: `Производство: ${PROD}` })).toHaveAttribute('aria-pressed', 'true');
  await e2.getByRole('button', { name: '▾ репроматеријали' }).click();
  await expect(e2.getByTestId('prod-line')).toContainText(MAT);
  await ok(page, w);
});

test('bank statement upload for a firm without a bank account → automatic booking', async ({ page }) => {
  const w = watch(page);
  await login(page);
  await openFirm(page, FIRM);
  await page.goto('/banka');
  await page.waitForLoadState('networkidle'); // hydrated: the file input's onChange is attached
  const fileIn = page.locator('input[type=file][accept*=".940"]');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><GrpHdr><MsgId>1</MsgId><CreDtTm>${today}T10:00:00</CreDtTm></GrpHdr>
<Stmt><Id>S1</Id><ElctrncSeqNb>3</ElctrncSeqNb><Acct><Id><Othr><Id>300000000012355</Id></Othr></Id><Ccy>MKD</Ccy><Ownr><Nm>${FIRM}</Nm></Ownr></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="MKD">0.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>${today}</Dt></Dt></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="MKD">2649.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>${today}</Dt></Dt></Bal>
<Ntry><Amt Ccy="MKD">2649.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>${today}</Dt></BookgDt><ValDt><Dt>${today}</Dt></ValDt>
<NtryDtls><TxDtls><RltdPties><Dbtr><Nm>${CUST}</Nm></Dbtr></RltdPties><RmtInf><Ustrd>Плаќање по фактура 001/${year}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
  await fileIn.setInputFiles({ name: 'izvod.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await expect(page.getByText(/ќе се отвори при зачувување/)).toBeVisible();
  await page.getByRole('button', { name: 'Зачувај и прокнижи' }).click();
  await page.waitForURL(/review=1/);
  const review = page.locator('.card:has(h2:has-text("Автоматско книжење – преглед"))');
  await expect(review).toContainText(`001/${year}`);
  await expect(review).toContainText('2.649,00');
  await review.getByRole('button', { name: 'Прокнижи избраните' }).click();
  await expect(page.getByText(/Прокнижени 1 ставки · изводи книжени: 1/)).toBeVisible();
  // the account was opened from the statement
  await page.goto('/banka?banks=1');
  await expect(page.locator('#main')).toContainText('300000000012355');
  await ok(page, w);
});

test('opening balance: Excel in the editor → saved → trial balance totals equal', async ({ page }) => {
  const w = watch(page);
  await login(page);
  await newFirm(page, `Е2Е ПОЧЕТНА ${stamp} ДООЕЛ`, '4031' + String(Date.now()).slice(-9));
  await page.goto('/pocetna');
  await page.waitForLoadState('networkidle');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Конто', 'Назив на конто', 'Комитент', 'Шифра на комитент / ЕДБ', 'Салдо должи', 'Салдо побарува'],
    ['1000', 'Жиро сметка', '', '', 15000, 0],
    ['1200', 'Купувачи', 'ПРВ КУПУВАЧ ДОО', '4030000000404', 5000, 0],
    ['2200', 'Добавувачи', 'ПРВ ДОБАВУВАЧ ДОО', '', 0, 2000],
    ['9000', 'Основна главнина', '', '', 0, 18000],
  ]), 'ББ');
  const buf = Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  await page.locator('input[type=file][accept^=".xlsx,.xls,.csv"]').setInputFiles({ name: 'pocetna.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buf });
  await expect(page.getByText(/Внесени се 4 ставки/)).toBeVisible();
  await page.getByRole('button', { name: /^Зачувај/ }).first().click();
  await expect(page.getByText(/Почетната состојба за \d{4} е зачувана/)).toBeVisible();
  await page.goto('/bilanc');
  const tot = page.locator('tr:has-text("Вкупно"), tfoot tr').last();
  await expect(tot).toContainText('20.000,00');
  const cells = (await tot.locator('td').allInnerTexts()).map(num).filter((x) => !Number.isNaN(x));
  expect(cells.filter((x) => x === 20000).length).toBeGreaterThanOrEqual(2);
  await ok(page, w);
});
