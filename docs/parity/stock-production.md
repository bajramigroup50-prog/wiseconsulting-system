# Parity audit — wholesale stock, production, codebooks

Legacy = final behaviour in `legacy/index.html` (later `VIEWS.x` / `ACT.x` definitions and runtime wrappers win).
Server = `apps/web/app/(app)/<view>` + `_stock/*`, `_retail/*`, `app/print/*`, `packages/core`, `packages/db`.
Every page header also carries the shared „⬇ PDF / ⬇ Excel“ of the screen (`components/hd.tsx` → `ScreenExport`, merged
from main); screens with a legacy-specific export/print disable it (`exp={false}`) and show the legacy layout instead.

Status: **ok** (matches), **fixed** (was missing/different, fixed in this pass), **diff** (deliberate difference, reason
given), **gap** (still missing, reason in the last column).

## Stock lists, cards, trade books

| View | Element | Legacy behaviour | Status | Fix / note |
|---|---|---|---|---|
| g_lager / g_lagerk | Filters Објект, Состојба на ден, Вид, Шифра/назив, нула залиха | `lagerView` 4964 | ok | |
| g_lager | Columns + footer totals + 3 summary tables | `LAGER` 4918, `lagerSum` 4930 | ok | quantities from the fixed `stockAt` (§7.4 item 1) |
| g_lager / g_lagerk | „Увоз од Excel / CSV“ (`lagImpOpen`, in / pop / price, price only for a store, warn without object) | 4935–4958 | fixed | panel on the page, `Importer` (`in`, `pop`, `nivel`) via `importRows`; diff: count/price imports save the document directly instead of opening a draft in m_izlez / nivel |
| g_lager / g_lagerk | „Excel“ (`lagerXlsx` → `lagAoa`: Р.б., Шифра, **Баркод**, Назив, Ед., **Вид**, …) | 4959–4960 | fixed | `lagerExportRows` (core, tested), column widths as legacy |
| g_lager / g_lagerk | „CSV“ (BOM, `;`, decimal comma) | `lagSave` 4960 | fixed | `legacyCsv` |
| g_lager / g_lagerk | „PDF“ (firm head, title, „Состојба на … · објект · вид“, signatures; „Пописна комисија“ for скратена; landscape for g_lager) | `lagerPdf` 7360 | fixed | server PDF of `#rpt` with print-only `PrintHead` / `PrintSig` |
| g_lager (admin) | checkbox column, „Избрани: N“, „🗑 Избриши ја залихата на избраните“ | 16998, `lgDel` 17006 | fixed | `deleteItemsStock` (db, tested): FIX — document-owned moves (purchases, invoices, POS, production) are kept and reported, locked period skipped, both transfer legs deleted, stock journals re-posted |
| g_kartica | Item / object / period, card table, totals | `kartView` 4981 | ok | |
| g_kartica | „PDF“ (МАТЕРИЈАЛНА КАРТИЦА, item · unit · period, landscape) | `kartPdf` 7361 | fixed | server PDF + print head |
| g_kartica | „PDF сите картици“ | `kartAllPdf` 7362 | fixed | `/print/kartice` (one card per page) |
| g_kartica | Excel | — (comparable screens) | fixed | `kartAoa` |
| g_trgv (ЕТ) / m_trg ЕТМ | table, note, „PDF“ (`trgPdf` 7363, landscape for ЕТ) | 5005 | fixed | PDF with head + Excel |
| m_trg (образец ЕТ) | „PDF“ (`etPdf`) | 5071 | fixed | PDF with head + Excel |
| g_trg (МЕТГ) | „PDF“, „PDF за сите артикли“ | `metgPdf` / `metgAllPdf` 5072–5073 | fixed | `/print/metg`; Excel `metgAoa` |
| zaliha | + Приемница / Издатница / Преносница, object filter, list, card | 4890 | ok | manual documents also listed / deletable (earlier FIX) |
| zaliha | CSV, „PDF состојба“ (СОСТОЈБА НА ЗАЛИХА на ден …) | `stockCsv`, `stockPdf` 7304 | fixed | Excel + CSV, server PDF with head and signatures |
| zaliha | „PDF сите картици“, per-row „PDF“ | `cardsPdf` 7305 | fixed | `/print/kartice?v=zaliha[&i=]`; diff: uses the full material-card layout (more columns than the old 6-column card) |

## Transfers, calculations, re-averaging

| View | Element | Legacy behaviour | Status | Fix / note |
|---|---|---|---|---|
| prenosi | header „← Влезни калкулации“, „Малопродажба →“, „+ Нов пренос“ | 5556 | fixed | links to `/kalkG`, `/kalkM` |
| prenosi | no store → empty state with „Отвори шифрарник“ | 5556 | fixed | |
| prenosi | list columns + row „Преносница“, „ПЛТ“, 🗑 | `prTable` 5550, `prPdf`, `prPlt` | fixed | `/print/prenos/<id>` (ПРЕНОСНИЦА, Издал/Примил/Одговорно лице) and `?t=plt` (ПЛТ on `prPseudo`); footer totals added |
| prenosi editor | Број (next number, read-only) | 5556 | fixed | |
| prenosi editor | „Додај ги артиклите од калкулација“ | `prAddCalc` 5577 | fixed | limited to stock at the source (`transferFromCalc`, tested); client uses today's stock per location |
| prenosi editor | margin buttons 10–50 %, own %, rounding (цел денар / 0,50 / 10 / без), „Задржи постоечки цени“ | `prMargin`, `prKeep` | fixed | `transferMarginPrice` (core, tested) |
| prenosi editor | columns ДДВ, Набавна вредност, Разлика % | 5556 | fixed | average cost at the source (`avgBy`) |
| prenosi editor | „Целата залиха од магацинот“ | `prAllStock` | ok | |
| prenosi | stock check, save, D 6630 / C stock / C 6694 / C 6640, retail price update | `prSave` 17396, `prnLines` | ok | margin konto 6694 (Phase 7 decision) |
| prenosi | „Прокнижи ги“ callout for old transfers without posting | `prnPost` 17417 | diff | not needed: every server transfer is posted on save |
| kalkG | list, tiles, filters, Вид / Девизен износ columns, row Отвори / Калк. PDF / ПЛТ / 🗑 | 5523, 17331 | ok | |
| kalkG | „→ Продавница“ prefilled from the calculation | `prFromCalc` | fixed | `/prenosi?calc=<id>` (date rule as legacy) |
| kalkG | selection bar: 📦 Пренос во продавница, 📒 Книга, 📗 ЕТ, 🗑 (admin), ✕ | 17282–17308 | fixed | `KsBar`; multi-calc transfer `/prenosi?calc=a,b` |
| kalkG | „📄 Копирање во излез“ (`ksInv`), „🔗 Спојување“ (`ksMerge`) | 17298, 17299 | gap | need invoice / purchase draft prefill APIs owned by the sales agent |
| kalkG | „PDF листа“ | `kalkListPdf` 7289 | fixed | shared header PDF of the list (firm head + title) |
| kalkG | „Артикли само со шифра“ callout → artNames | 17335 | fixed | |
| kalkG | transfers card with values and Преносница/ПЛТ | 5523 | fixed | |
| kalkG | duplicate calculations callout (`delPurDups`), PDF drop zone (AI read) | 5523 | gap | duplicates/AI reading live in Влез (sales agent) |
| kalkCalc | calculator + margin table | 5611 | ok | header PDF/Excel shared |
| uprosek | „Упросечи ги цените“, callout | 5113 | ok | |
| uprosek | item table Шифра/Назив/Ед./Количина/Просечна цена/Вредност | 5113 | fixed | |

## Production

| View | Element | Legacy behaviour | Status | Fix / note |
|---|---|---|---|---|
| normativ | product, materials, labour, cost, margin, „+ Материјал“, save | 5632 → 13914 | ok | cycle guard (earlier FIX) |
| normativ | 🤖 AI proposal + callout | `bomAI` 13860 | ok | |
| normativ | stock per material in the select (on stock first, „── без залиха ──“) and under the quantity | v437 / v438 | fixed | |
| normativ | „Внесете количина за секој материјал.“ | v436 | fixed | client validation |
| normativ | „нема суровини“ callout | v436 | fixed | |
| normativ | import of the BOM from Excel | — (comparable `pcImport`) | fixed | Шифра/Назив + Количина |
| prod | two tabs Работен налог / Раздолжување за период | v441 | fixed | |
| prod | hint: normativ per unit, На залиха, Доволно за, max quantity | v439 | fixed | `bomHint` (tested) |
| prod | no normativ: „⚡ Раздолжи без норматив“ with % (firm `rnPct`, default 60) | `pnbPlan` / `pnbRun` | fixed | `runCustomProductionOrder` mode `pct` (tested), `% ` saved in firm settings |
| prod | „✏ Измени / додади материјали за овој налог“ with Шифра column, datalist, „зачувај како норматив“, quick entry, Excel import | v442–v444 | fixed | `CustomProdEditor`, mode `custom` (tested); AI read of a PDF/photo order not ported (gap: no worker prompt) |
| prod | list + Сторнирај | 5647 | ok | |
| rasNorm | by count / % of sales, product, list, Сторнирај | 13870 | ok | |
| mrp, prodCost, lotovi | all elements | 10000, 10015, 10027 | ok | header PDF/Excel shared |

## Orders and replenishment

| View | Element | Legacy behaviour | Status | Fix / note |
|---|---|---|---|---|
| porachki | list, filters, editor, Потврда на нарачка, invoice for the rest, cancel | 9870 | ok | |
| nabavki | list, editor, PDF, received / cancel | 9900 | ok | |
| nabavki | „✉ Испрати на добавувачот“ | `poMail` | fixed | `poMailAction` via `mail_log`; diff: order inline in the HTML body instead of a PDF attachment |
| dopolnuvanje | parameters, suggestion table, create supplier orders | 9920 | ok | |

## Codebooks and lists

| View | Element | Legacy behaviour | Status | Fix / note |
|---|---|---|---|---|
| sifrarnik | groups and counts | 6984 | ok | |
| sifrarnik | „Услуги“ opens the service list | 6984 | fixed | link was `/artikli`, now `/uslugiS` |
| cb_* (16 codebooks) | all `CB` fields, list, add/edit/delete with usage check, city seed, paysif table, notes, ценовник PDF | 6947–6973 | ok | |
| cb_* | Excel/CSV import with template | — (comparable `xlImport`) | fixed | `importCodebook` (same code = update, tested) |
| konto | classes, add/edit/delete | 6822 | ok | |
| konto | Excel import with template | — | fixed | `importAccounts` (tested) |
| partneri / artikli / uslugiS | Увоз од Excel, Додели шифри, usage lock list, columns | 6818–6821, 13455 | ok | merged from main (sales agent) |
| partneri | „Нов комитент од тековна состојба“ (AI read of CRM PDF) | 13455 | gap | editor area of the sales agent |
| artNames, artQ, artKonta, barkodi, kursna, banke | all elements | 17360, 11338, 8445, 9201, 6499, 6983 | ok | |

## Phase 7 known gaps (ROADMAP)

| Gap | Status |
|---|---|
| stock-list Excel | fixed (g_lager Excel/CSV + import) |
| supplier returns in stock | ok — `povratDob` writes `supret` moves (Phase 3); store returns in m_izlez belong to the retail screens |
| promotions UI, barcodes | ok (m_akcii, barkodi exist) |

## Counts

Audited 34 views / ~120 elements; fixed 52; deliberate differences 5; remaining gaps 5 (ksInv, ksMerge, duplicate
calculations + PDF drop in kalkG, AI read of a work order PDF, partner from CRM extract).

New tables: none (no `parity-stock.ts` schema needed; work-order mode stored in `production_orders.note`, rnPct in
`firms.settings`). Migrations to generate: none.
