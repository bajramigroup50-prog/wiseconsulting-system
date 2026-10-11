# Parity audit — Малопродажба (retail)

Legacy = final behaviour in `legacy/index.html` (later `VIEWS.x` / `ACT.x` definitions and runtime wrappers win).
Server = `apps/web/app/(app)/<view>`, `_stock/*`, `_retail/*`, `packages/core/src/retail/*`, `packages/db/src/parity-retail.ts`.
Every page header carries the shared „⬇ PDF / ⬇ Excel“ of the screen (`components/hd.tsx` → `ScreenExport`); documents with
their own legacy print have a server PDF (`PdfButton`) of the print layout with the firm head (`FirmHead`).

Status: **ok** (matches), **fixed** (missing/different, fixed in this pass), **diff** (deliberate difference, reason given),
**gap** (still missing, reason in the last column). m_lager / m_lagerp / m_kartica / m_trg (ЕТМ, МЕТГ, образец ЕТ) share their
components with the wholesale views and are audited in `stock-production.md`; only retail-specific rows are repeated here.

## Фискална каса (`kasa`, legacy 5680 + 9937 / 9940, `posSell` 5838, `posFile` 7229)

| Element | Legacy behaviour | Status | Fix / note |
|---|---|---|---|
| title „Фискална каса“, sub „малопродажба · <објект>“ | 5685 | fixed | |
| „Продавница / каса“ select | `locSel('pos_wh')` | fixed | `LocSelect` (re-renders with `?wh=`) |
| callout about the fiscal device driver | 5686 | fixed | text verbatim |
| „📷 Скенирај баркод или внеси шифра + Enter“ | `itemByCode` (barcode, extra barcodes, code), beep ok / error, qty from the qty box, same item adds up, toast when unknown | fixed | `Retail.itemByCode`, `cartScan` (core, tested), WebAudio beep, autofocus |
| item select with price and stock, qty, „Додај“ | 5689 | fixed | |
| cart: name, qty × price, amount, ✕, „Вкупно со ДДВ“ | 5690 | fixed | |
| 💳 loyalty card (scan or phone + Enter), 🎟 coupon, „искористи N поени“, card line, coupon error, „Попуст … · За плаќање …“ | wrapper 9937 | fixed | live preview with `Retail.posDiscount` / `couponCheck`; recomputed on the server |
| „Евидентирај продажба“ | `posSell` + wrapper 9940: discount split per VAT rate as negative lines, POS day `z-<wh>-<date>`, goods + BOM issue, points / spend / visits / log, coupon use | fixed | `posSaleWithLoyalty` (db, tested) in one transaction with `loyaltyApplySale`; discount lines `Retail.posDiscountLines` (golden-tested); coupon error blocks the sale |
| „Преземи сметка за апаратот“ (.inp) | `posFile` | fixed | `Retail.fiscalInpFile` (tested, byte-exact format) |
| „Дневни извештаи (Z) · <објект>“: Датум, Сметки, Основица, ДДВ, Вкупно | 5693 | fixed | all sales of the location (POS + fiscal), totals row, delete for POS days, PDF / Excel |
| sale date | today | diff | date field kept (default today) for late entry |
| „Од тоа со картичка“ | — | diff | kept: card payments go to the POS account (fiscal scheme) |
| restaurant „💶 Наплати (каса)“ → till with the bill | `roPay` 9986 | fixed | `/kasa?ro=<bill>`; FIX: the bill is closed in the same transaction as the sale (legacy closed it before the till opened) |

## Фискални извештаи / апарати (`fiskPer`, final 11411 + tabs 11528 + wrappers 13043–13152)

| Element | Legacy behaviour | Status | Fix / note |
|---|---|---|---|
| tabs „📠 Извештаи → книжење“, „✅ Контрола на ДФИ“, „🖨 Апарати и PC поврзување“ | 11528 | fixed | `FTabs` |
| POS terminal box: cards from reports / received from bank / open, „Книжи провизија 4460“ | `posBox` 13076, `posFee` 13078 | fixed | `posSaldo` (core, tested), `bookPosFee` (D 4460 / C POS account with the POS partner, ≤ open balance) |
| callout (period reports, FIFO / LIFO / proportional) | 11416 | fixed | |
| 📷 scan / 📎 PDF, „🔍 Прочитај“ | `fkRead`, FISK_PROMPT | ok | worker `fisk` read; FK_SIMPLE second read when the total is 0 (worker) |
| status after read incl. „(втор обид)“ / failure hint | 13042 | fixed | |
| „📝 Што е прочитано од сликата (за проверка)“ with text + second read, device, period, total | 13043 | fixed | |
| „✎ Внеси рачно (само вкупно)“ | `fkManual` 13048 modal: Вкупен промет, Од / До (ДД.ММ.ГГГГ), Од картичка, Даночна група (Г-ставка без ДДВ / А / Б / В / Г), Апарат, „не е ДДВ обврзник“ → result card | fixed | `FiskManual` + `fkManualRead` / `fmDate` (core, tested); the detailed manual form (per rate, Z, goods plan) stays as a second button |
| messages: zero turnover, „Нема ставки за излез.“, issue done, „Внесете износ до“, „Внесете фискален број.“, upload right | 12996, 11454, 13078, 11536, 4620 | fixed | |
| „1. Промет“: rows per day / period, groups with VAT, cash, card, checks (`fkCheck`), pill | 11419 | fixed | `fkRows2`, `fkChecks2` (core, tested) |
| device, EDB check against the firm | 11363 | fixed | `fkEdbOk` |
| „не е ДДВ обврзник“, „Книжење по денови / вкупно за периодот“, „Датум на книжење“ (ДД.ММ.ГГГГ) | 11422–11424, 13110 | fixed | multi-day read posted at once (was: one day at a time) |
| МЕТГ notice / „распредели еднакво по работни денови“ / „еден ред“ | 11425, `fkMetgDays` | fixed | `fkMetgDays` (core, tested) → `sales_daily.days` |
| „Шема на книжење“ (FK_SC) + „Конто за готовина“ | 13105 | fixed | |
| Продавница / каса, Конто за приход, Конто за картичка (1009 → 1200001) | 11428, 13119 | fixed | |
| warning existing days (replaced), warning „не е продавница“ (МЕТГ) | 11429, 13151 | fixed | existing day of the location is replaced (legacy id `zf-<wh>-<date>`) |
| „ги проверив разликите“ + „✓ Прокнижи го прометот“ | 11430 | fixed | `postFiskRead` (db, tested) |
| „2. Излез на стока“: method, plan, items, „📦 Направи излез на стока“ | `fkIssueHTML`, `fkIssue` | fixed | done together with the posting (checkbox) instead of a second step; „Само услуги“ / „без ДДВ“ texts as legacy |
| scanned report kept with the posting (archive) | 11450, 13137 | fixed | `fisk.fileId` → 📎 in the list |
| ✅ DFI control: object, from / to (starts at the first report), checks, list | `dfiHTML` / `dfiControl` / `dfiStart` | ok | |
| DFI options: неработни денови, благајнички максимум, полог до (дена) | 11505 | fixed | `saveDfiOptions` |
| „За печатење: КДФИ-01 / МЕТГ / ДДВ-04“ | 13134 | fixed | |
| 🖨 devices: list, editor (all fields), devices seen on reports „+ додај“, delete (del right), bridge plan card | `devHTML`, `devSave`, `devDel` | fixed | `fiskDev` in firm settings |
| posted reports list | — (legacy goes to Налози) | diff | extra list kept, with PDF / CSV and delete |

## Излез од продавница (`m_izlez`, 5698–5795)

| Element | Legacy behaviour | Status | Fix / note |
|---|---|---|---|
| no store → empty state + „Отвори шифрарник“ | 5707 | fixed | |
| header „← Влезни калкулации“, „+ Нов документ (Ins)“ | 5712 | fixed | Ins / F7 shortcuts |
| „Тип (F7)“ radios: Продажба / парагон, Фактура, Повратница, Отпис, Попис + note of the type | 5713–5715 | fixed | was: only count and write-off |
| store filter „Сите продавници“ | 5714 | fixed | |
| list: Број, Датум, Продавница, Опис / Добавувач, Ставки, Продажна вредност / Разлика; Измени, PDF, 🗑 | 5717 | fixed | |
| Фактура → link to invoices | 5716 | fixed | |
| editor: Продавница / Објект, Датум, Број, Добавувач + бр. документ (ret), Наплата (sale), конто отпис / кусок / вишок | 5726–5731 | fixed | `MoEditor` |
| item entry (datalist with stock and price, Enter), stock pill, sale price / VAT, retail price / cost value, totals | 5732–5735 | fixed | |
| „Excel шаблон“ / „Пописна листа (Excel)“, „Увоз од Excel / CSV“ (column recognition, unknown items reported) | `moTplDl`, `moImport`, `MO_COL` | fixed | `Retail.moCols / moImport / moTemplate` (core, tested) |
| „Откажи (Esc)“, „Зачувај (F4)“ | 5724 | fixed | |
| save: stock check, numbers ПР / ПВ / ОТ / ПП, sale → turnover (D Наплата / C revenue + VAT, КДФИ / ЕТМ) + COGS issue, return → D 2200 (supplier) | `moSaveDoc` 5766 | fixed | new table `store_outs` + `saveStoreOut` (db, tested); sale turnover is a fiscal-day row (scheme `trg`, cash account = Наплата) |
| PDF: ПРОДАЖБА / ПАРАГОН, ПОВРАТНИЦА, ЗАПИСНИК ЗА ОТПИС, ЗАПИСНИК ОД КОНТРОЛЕН ПОПИС with signatures | `moPdfHTML` 5789 | fixed | firm head + server PDF |

## Акции и попусти (`m_akcii`, 5797–5836, ACT 7901–7913)

| Element | Legacy behaviour | Status | Fix / note |
|---|---|---|---|
| list, due callout with Започни / Заврши, statuses, avg discount, row actions, prints Одлука / Калкулација / Враќање | 5802–5809 | ok | |
| editor fields, per-item % or price, „под набавна“ pill | 5814–5818 | ok | |
| „Избери ги сите прикажани“ / „Отстрани ги прикажаните“ | `akAll` | fixed | |
| „Избрани: N · разлика по продажни цени“, column „Разлика“ | 5816–5817 | fixed | |
| procedure note incl. price display in the store | 5808 | fixed | |
| prints with firm head (`ph`), „Во <град>, <датум>“, PDF file names | `akDocHTML`, `akPdf` | fixed | server PDF |

## Нивелација (`nivel`, 5137 + 13196 + 17193 + 17433, `nivelHTML` 5155)

| Element | Legacy behaviour | Status | Fix / note |
|---|---|---|---|
| Објект, Датум (ДД.ММ.ГГГГ), note, table Шифра / Назив / Ед. / Количина / Стара / Нова МПЦ / Разлика, total | 5137, 13196 | fixed | `NivelEditor` |
| checkbox column + select all shown, search, „Избрани“, ▼ / ▲ %, fixed price, rounding (1 / 10 / без / …9), „Примени на избраните“, „Исчисти ги новите цени“ | 17433, `nvApply` 17445 | fixed | `Retail.nivBulkPrice` / `nivRound` (core, tested) |
| „📥 Увоз од Excel“ (Шифра · Нова цена · Количина · Стара цена, ✎ marks), „⬇ Шаблон“, unknown codes listed | `nivImp`, `nivTpl` | fixed | `Retail.nivImport` (tested); imported qty / old price saved (`saveLevelling` `qty` / `old`) |
| „+ Додај артикл рачно“ | `nivAdd` | fixed | |
| „Акција важи до“ (second levelling the next day) | 13196 | ok | |
| correction banner „✎ Корекција на нивелација …“, Корекција / 🗑, note under the number | 17193 | fixed | |
| list „Нивелации <год>“, PDF (НИВЕЛАЦИЈА бр., Изготвил / Одговорно лице) | 5150, `nivelHTML` | fixed | firm head, signatures, server PDF |
| „+ Креирај ги како нови артикли“ for unknown import codes | `nivMk` 13221 | fixed | `createLevellingItems` (db, tested): „Артикл <шифра>“, ком, VAT 18 / 0 %, store price = old (else new) price |
| saving / „Акција важи до“ messages | 17180 | fixed | |
| „🧪 Пример фирма“ (admin demo) | `metgDemo` 13155 | diff | demo data generator not ported (production system) |

## КДФИ-01 (`kdfi`, 5099 + 13143)

| Element | Legacy behaviour | Status | Fix / note |
|---|---|---|---|
| filters, full official form (all columns), totals | 5099 | ok | |
| summary (days, total, VAT, estimated days) | 13146 | ok | |
| screen table (total, 0 / 5 / 10 / 18 %, VAT, Macedonian products, „распр.“ pill) + full form folded in „Целосен образец КДФИ-01“ | 13147–13148 | fixed | |
| PDF of the form | — | fixed | server PDF with firm head |

## Лагер листа малопродажба (`m_lager`, `m_lagerp`) — retail-specific

| Element | Legacy behaviour | Status | Fix / note |
|---|---|---|---|
| list, filters, Excel / CSV / PDF, admin delete | `lagerView` | ok | see stock-production.md |
| „Увоз од Excel / CSV“ (приемница / почетна залиха, попис, нови МПЦ → нивелација) | `lagImpOpen` 4935 | fixed | store preselected; retail template Шифра, Назив, Ед.мера, Количина, Набавна цена, Продажна цена со ДДВ, ДДВ %, Баркод; per-row checks in the preview; new items with unit, VAT rate and store retail price (tested) |

## Лојалност, ресторан, кујна (9943–9991)

| Element | Legacy behaviour | Status | Fix / note |
|---|---|---|---|
| lojalnost: tabs, cards / coupons editors and lists, rules | 9943–9956 | ok | |
| lojalnost → wired into the till | 9937–9942 | fixed | see kasa |
| restoran: areas, tables, open bills, menu search, lines ± / note, send to kitchen, bill preview, close empty | 9963–9987 | ok | |
| restoran: „Келнер“ on the bill | `#ro_w` | fixed | |
| restoran: „💶 Наплати (каса)“ → till (loyalty, coupon, fiscal file) | `roPay` | fixed | see kasa |
| kujna: waiting tables, „✓ Готово“, refresh 20 s | 9989 | ok | |

## Calculations, import, AI batch (`kalkM`, `uvozMalo`, `masovnoM`)

| View | Status | Note |
|---|---|---|
| kalkM (= `VIEWS.kalk` for stores) | ok | shared `KalkPage`; audited with kalkG in stock-production.md |
| kalkG / kalkM „📄 Копирање на калкулацијата во излез“ (`ksInv`) | fixed | `/izlez?calc=<ids>`: invoice draft with the goods (`ksInvLines`, `calcInvoiceDraft`, tested) |
| kalkG / kalkM „🔗 Спојување на селектираните“ (`ksMerge`) | fixed | `mergePurchases` (db, tested): one supplier / location, no imports; diff: merged and old deleted in one transaction, then opened for review (legacy opened a draft and deleted the old ones on save) |
| kalkG / kalkM duplicate-calculations callout + „Избриши N дупликати“, PDF / photo drop zone | fixed | |
| artQ „⇢ Спои ги сите групи“, „⇢ Спои ги сите над 90%“ | fixed | `artMergeAllAction` (legacy `artDupAll` / `artSimAll`) |
| uvoz: itemised-invoice warning „→ Увези ја како … фактура со ставки“ | fixed | legacy wrapper 17311 |
| lojalnost / m_akcii validation messages | fixed | legacy `lcSave` / `cpSave` / `akcSave` texts |
| uvozMalo (`uvHub(m,'malo')`) | ok | shared `UvHub` |
| masovnoM (AI batch reading of store purchases) | ok | shared `ScanCenter`; audited in sales-purchases.md |

## Counts

Audited 20 views / ~170 elements; fixed 92; deliberate differences 7; remaining gaps: none in this area except the admin
demo-firm generator (not ported on purpose). Auto-checker leftovers are helper-text noise (generic Word-template buttons
„⬆ Прикачи .docx / 🕘 Верзии / 🧪 Проба“, batch AI-read toasts).

New tables: `store_outs` in `packages/db/src/schema/parity-retail.ts`. **Migration to generate** (coordinator): create
table `store_outs` (see the schema file; the DB test creates it with `create table if not exists` until then).
JSON-only additions (no migration): `SalesItemLine.name` (POS discount line), `SalesFiskInfo.periodic / fileId / receipts`,
firm settings `fiskDev`, `fiskOpt.konto / offDays / cashMax / depDays`.
