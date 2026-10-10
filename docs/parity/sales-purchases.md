# Legacy parity — Sales & purchases

Area: skan, masovno / masovnoM, uvozMat / uvozMalo, vlez (purchase editor, prints, Excel lines), izlez / uslugi / odobrenija /
profakturi / ispratnici (invoice editor, credit notes, prints, PDF, e-mail, QR, WhatsApp), povratDob, efaktura / efPrep, UBL,
partneri, artikli, uslugiS.

Audit method: every legacy view was read in its **final** form (`VIEWS.x` plus all later wrappers / loop patches / `ACT`
overrides), element by element, and compared with the server screen. Status: **ok** (already equal), **fixed** (changed in
this pass), **different** (deliberate, reason given), **remaining** (not done, reason given).

Every screen header also has the shared „⬇ PDF“ / „⬇ Excel“ of `components/hd.tsx` (`ScreenExport`), so each list, card and
book in this area exports to PDF and Excel; specific legacy exports (ПЛТ, калкулација, приемница, documents, UBL) are listed below.

## 1. Скенирање документ (`skan`) and AI reading

| View | Element | Legacy behaviour | Server | Fix |
|---|---|---|---|---|
| skan | Title / subtitle | „Скенирање документ“ · „автоматско внесување“ | fixed | subtitle |
| skan | Intro note | „Прикачете PDF, фотографија или скен од влезна фактура…“ | fixed | verbatim |
| skan | Drop zone | 1–2 files → read, the editor opens with the draft; >2 files → Масовно (`wireScanDrop` 4637) | fixed | `ScanUpload autoOpen` polls `scanStatus` and opens `/vlez?scan=`; >2 files start a batch and open `/masovno?b=` |
| skan | Queue after save (`S.scanQ`, `nextScan`) | after „Зачувај“ the next file of the queue opens; „Уште N документи во редица… Прескокни ја оваа → следна“ | fixed | `lib/scan-queue.ts`; save actions redirect to the next unsaved draft; callout + skip link in the editor |
| skan | Stage messages | „Брзо читање… N сек.“, „Износите не се совпаѓаат – подетално читање…“, „Откажи“ | fixed | progress pill with seconds, cancel |
| skan | Callout cards (`.cols`) | Банкарски извод → Изводи; Излезни фактури → 📷 Скенирај; Рачен внес note | fixed | three callouts |
| skan | „Повратница или одобрение (добавувач)? 📷 Скенирај повратница“ (16235) | SCR scan | fixed | link to `/povratDob?scan=1` (SCR_PROMPT read kind `scr`) |
| skan | „🧪 Тест AI“ (14435, admin) | `aiCmp`: same invoice read with quick and detailed model, compared, nothing saved | fixed | `/skan?cmp=1`, worker kind `cmp`, comparison table with cost |
| skan | Error texts (`scanErr`) | per-code Macedonian messages | ok | worker stores the message; generic fallback „Читањето не успеа…“ |
| skan | Without AI | the file is attached to a new manual purchase | different | the read errors with „ANTHROPIC_API_KEY…“; the file can still be attached in the editor |
| AI | PUR_PROMPT, SALE_PROMPT, SCR_PROMPT, IMP_PROMPT | verbatim | ok | `apps/worker/src/ai/prompts.ts` |
| AI | invSplit prompt (13689) | page grouping of multi-invoice PDFs | fixed | `apps/worker/src/ai/split.ts` (verbatim prompt, pdf-lib), each part stored as its own PDF and read separately |
| AI | quick → detailed read, `purConsistent`, `fixRates`, `fixLines`, `draftFromScan` (kind → konto), `matchItem`, `ownerCheck` | | ok | `@wise/core/sales` scan.ts |
| AI | OCR (Tesseract) fallback | for images when the model is unavailable | different | the model reads images / scanned PDFs directly |
| AI | readImportDocs (IMP_PROMPT) | Девизна tab drop zone: supplier invoice, ЕЦД, шпедиција, транспорт, other cost fill the fields | fixed | worker kind `imp`; editor maps the results into currency / fx / fxAmt / ЕЦД / costs |
| AI | readIntoDraft / readAtt | read the attached PDF into the open purchase | fixed | „Прочитај ги податоците“ + auto read when a document is attached to an empty draft (`inline` scan) |

## 2. Масовно внесување (`masovno`, `masovnoM`)

| Element | Legacy | Server | Fix |
|---|---|---|---|
| Header „Исчисти листа“ / „Зачувај ги сите што се во ред (N)“ | | fixed | `clearBatch`, `saveBatchOk` |
| Options: Стоката во објект, „Фискални сметки платени во готово (1020)“, „Директни трошоци – без приемница / калкулација“ | | fixed | label „(1020)“ |
| Drop label „…Се читаат по неколку истовремено…“ | | ok | worker jobs run in parallel |
| Tiles Вкупно / Во ред / За проверка / Зачувани | | ok | |
| Columns #, Датотека, Добавувач, Број, Датум, **Основица, ДДВ, Вкупно, Артикли**, Статус | | fixed | added the base / VAT / total / items columns |
| Row actions Прегледај / Отвори и поправи / **Налог** (saved) / ✕ | | fixed | Налог link for saved rows |
| Batch editor callout „Масовно внесување: фактура „…“ · уште N незачувани. По „Зачувај“ автоматски се отвора следната. ← Листа“ | | fixed | `scanQueue` + redirect to the next draft |
| Duplicate rule `batchDup` / `batchCheck` messages | | ok | `batchStatus`, `findDuplicate` |
| masovnoM default store | | ok | |

## 3. Излезни фактури (`izlez`, `uslugi`, `odobrenija`, `profakturi`, `ispratnici`)

| View | Element | Legacy | Server | Fix |
|---|---|---|---|---|
| izlez | „📷 Скенирај фактури (PDF)“ | file input → `outRun` review card | different | opens the sales scan (`/skan?k=sale`) with the same review list |
| izlez | „Увоз од Excel“ (`impGo invoices`) | | fixed | link `/uvoz?t=invoices` |
| all | „PDF листа“ (`listPdf`) | | fixed | shared „⬇ PDF“ / „⬇ Excel“ of the list; CSV kept |
| odobrenija | Intro text („со минус – или на обратна страна, според поставката подолу“) | | fixed | verbatim |
| odobrenija | `crModeHTML` card + red storno posting (default minus) | | fixed | `settings.crMode`; `postInvoice` posts credit notes with minus on the original side unless „flip“; audit „Книжење одобренија: …“ |
| izlez | Fuel banner (14368) + „Постави R% на артиклите“ | | fixed | `fuelBannerFor`, `fuelItemsRateAction` (also on artikli) |
| izlez | Overdue callout `opHint` „⏰ N фактури кај N купувачи се неплатени по рокот…“ + „Опомени →“ | | fixed | from `loadDunning` |
| izlez | `opGoSel` (dunning only for ticked invoices) | | remaining | the opomeni screen (another area) has no selection parameter yet |
| all | Admin bulk delete (bulkScan 16904) | checkbox column, „Избрани: N“, „🗑 Избриши ги избраните“ | fixed | `BulkBar` + `deleteInvoicesAction` (per-document checks, audit „Масовно бришење“) |
| all | Search / month filter, counter | live filter | ok (submit button) | |
| all | Columns incl. Налог, Наплатено, Останува (red when overdue) | | ok | |
| odobrenija | Footer totals negative | | fixed | |
| all | Row actions 👁, PDF, ✎, ↩ Одобр. (title), Во фактура, Налог, Испратница, Товарен лист, 🗑 | | ok / fixed title | |
| all | Row double-click → preview | | remaining | low value; 👁 button exists |
| all | `delDoc`: credit note exists message; invoiced dispatch cannot be deleted | | fixed | messages verbatim; dispatch block added |
| editor | Number label „Калкулација / фактура бр.“ | | fixed | |
| editor | Раб. налог / **приоритет** | | fixed | `prio` input |
| editor | Возило / Шофер datalists (`vehList`, `drvList`), Дата на утовар default = date | | fixed | |
| editor | Advances table „Број на калкулација“ | | fixed | |
| editor | Credit: Кон фактура (remainder), Вид на одобрение auto-copy (ret capped to returnable qty) / gross split on change, „⤵ Копирај…“ toasts, `crInfo` („претходни одобренија … може да се одобри уште …“) | | fixed | `others` (other credit notes, returned qty) computed in the view |
| editor | Service-only firm switch (`svcOnly`), „+ Услуга (слободен опис)“ (unit „усл.“, revService), „+ Ред (артикл)“, placeholders, remembered service texts | | fixed | `setSvcOnlyAction`, `settings.svcTexts` (max 60) |
| editor | Quick-add notes („Избрано: …“ / hint), Enter → qty, Escape, refocus, toasts, stock warning | | fixed | |
| editor | Stock hint „на залиха во {објект}: …“ | | fixed | |
| save | Fuel VAT check with automatic fix (14359) | | fixed | `fuelInvoiceCheck` (core, tested) |
| save | Stock shortage confirm, unlinked lines confirm, return unlinked lines confirm, art. 32-a non-VAT buyer warning | | fixed | client confirm chain before submit |
| save | Auto-link free lines to items by name (`matchItem`) | | remaining | the editor links by name/code while typing; no silent server-side relinking |
| save | Production items without cost price confirm | | remaining | cost-price fields of products live in the retail area |
| save | Per-kind success toasts, auto-open preview | | different | one „Документот е зачуван. 👁 Преглед / печатење“ callout |
| editor | art. 32-a lines konto '7460' | | different | FIX LEGACY-MAP 3.4 item 3 (scheme konto kept) |

### 3a. New (not in legacy): production from a sales invoice

Legacy had only a free „Трошоци за производство“ field when „Производство = Да“. Now the invoice editor opens
„🏭 Репроматеријали за производство“: materials per produced line from the normativ (BOM × quantity) or picked from stock
(quick „шифра количина“), stock on hand, average cost, red when short; materials warehouse; „зачувај како норматив“;
extra costs. On save (same transaction, before the invoice issues the product) one production order per produced line is
made through the production engine (`runProduction` + `replaceSourceMoves`, production posting scheme), dated the invoice
date; „Трошоци за производство“ = materials + extra. Editing replaces, deleting removes, client entries keep the plan and
approval runs it; locked periods are refused. Links: „🏭 Налог за производство бр. …“ in the editor and the list (to its
journal), „📄 Фактура …“ on the production order. Code: `@wise/core/sales` inv-production.ts, `packages/db/src/sales/invoice-production.ts`,
`components/sales/prod-panel.tsx`; tests in `packages/core/src/inv-production.test.ts` and `packages/db/src/invoice-production.test.ts`.

## 4. Prints, PDF, e-mail, QR, UBL, e-invoice

| Print / view | Element | Server | Fix |
|---|---|---|---|
| invoice / proforma | Payment QR (`qrImg` + `invQRText`), classic and modern/minimal, `qr` setting | fixed | `qrcode-generator` (same library as legacy) in `@wise/core` |
| invoice | Advance rows „Одбиен аванс ф-ра N (основа + ДДВ X)“ │ −(основа+ДДВ) | fixed | `advDeduct().list` |
| invoice art. 32-a | row VAT 18% and rate table show the VAT the buyer computes; „Вкупно“ column = base | fixed | |
| e-sign | `margin-top:40mm!important`, certificate fields (Сериски број, Thumbprint) | fixed | |
| dispatch | legacy `firmHead` (UPPERCASE name, phone, e-mail, bank, ЕМБС), „За магацин / За продавница“, „Возило / Возач“ line | fixed | |
| waybill / dispatch from invoice | „Врска: Фактура бр. N“ | fixed | |
| preview | heading, ✉ Е-пошта, **WhatsApp / Viber** (QR of wa.me link, Viber, share, copy, download PDF, 3-step note) | fixed | `wa-panel.tsx` |
| e-mail | confirm before sending, „Отвори во друга е-пошта (без прилог)“ mailto | fixed | „Само нацрт во Gmail“ → remaining (no Gmail integration server-side) |
| e-mail | proformas could not be e-mailed (status draft) | fixed | |
| PDF name | `Faktura_<fn(number)>.pdf` | fixed | page `generateMetadata`, `invoicePdfName` uses legacy `fn` |
| UBL | download `eFaktura_<fn(number)>.xml` | fixed | |
| style form | legacy option labels, QR checkbox, certificate fieldset, logo / sign / stamp uploads, default note pre-filled, „👁 Преглед“ (last invoice) | fixed | preview of *unsaved* values → different (save, then preview) |
| delivery proof | „🚚 Испорачано…“ + ПОТВРДА ЗА ИСПОРАКА | remaining | travel-order stops belong to the transport area |
| recurring invoice e-mail text (`recMail`) | | remaining | office area job; generic invoice text is used |
| efaktura | legacy subtitle, warning callout, „Статус: не е испратена“, „нема ЕДБ“ bad pill, „XML (UBL)“ | fixed | |
| efPrep | step 5 text, law status line, „✎ Отвори партнери“ (switch firm + partneri) | fixed | `OpenFirm` |
| kalk prints | ПРЕГЛЕД НА ВЛЕЗНА КАЛКУЛАЦИЈА, ПЛТ, **ПРИЕМНИЦА** (со/без данок), firm head with bank | fixed | `/print/kalk/[id]?t=priem[&vat=1]` |

## 5. Влезни фактури (`vlez`) and the purchase editor

| Element | Legacy | Server | Fix |
|---|---|---|---|
| Header „Увоз од Excel“, „📥 Фактура со ставки од Excel“, „+ Увозна (девизна)“, „+ Рачен внес“ | | fixed | |
| Drop zone „Прочитај фактура од PDF“ on the list | | fixed | inline `ScanUpload` with auto-open |
| Duplicates callout „Дупликати: N…“ + „Избриши N дупликати“ (`purDups`) | | fixed | |
| Checkbox selection + „🗑 Избриши избрани (N)“ | | fixed | `deletePurchasesAction` |
| Column „Девизен износ“ (`purFxCell`: amount, × rate, „нема курс“, „ставки X“ control), footer per currency | | fixed | |
| „→ Продавница“ (`prFromCalc`) | | remaining | the transfer editor (stock area) has no „from calculation“ entry yet |
| Code-only items callout (`anBtn`) | | fixed | vlez and artikli |
| Editor tabs Основно / Девизна (Зависни трошоци) / Дополнителни | | fixed | |
| Основно: Плаќање (2200 / 1020 labels), Вид Денарска/Увозна + „Прочитај увозни документи од PDF →“, Калкулација бр., ОЕ, Налог, Терк, Доп. трошок, Рабат % (Редовен, Количински, Сезонски), Комитент + „Додај го како партнер“, По документ, Датум на прием, Датум на ф-ра, Валута + дена, Повратница бр., Дистрибутер, Одобр. по док., Евидентен курс + валута, Салдо, Белешки, art. 32-a label | | fixed | stored in `purchases.data` |
| Девизна: Износ во девизи, Валута, Курс (red when empty), Ознака, ЕЦД, Конто добавувач (22xx), „= X ден. → во книжење“, 15 Царински наименувања + „Префрли сума → основица на царина“ | | fixed | |
| Cost slots: car with 3 VAT lines, others 1, dev none; trans „по количини“; totals; notes | | fixed | |
| Дополнителни: Група 1/2, Тип на трошок, Шофер, Камион, Приколка | | fixed | |
| Прикачени документи: + Прикачи, Прочитај ги податоците, ✕ (unlinks on save) | | fixed | |
| Calc bar: F5, F6, „Пропорц. распоред по разл. царински стапки“, „Распоред по повеќе наименувања“, „Вкупно“, margins + custom % + Примени, Заокружи, F2 / F3 / Приемница, „Со данок“ | | fixed | prints available after the first save |
| „Цар. наимен.“ column, type select with konto, notes, unknown-barcode hint | | fixed | |
| applyMargin rounding (`rr`) and < 0,50 warning, remembers defMargin / mgRound | | fixed | |
| „Додај ги во шифрарник“ (createMissingItems now), barcode + supplier code on the new item | | fixed | |
| Line „Вид“ saved on the item (savePur_) | | fixed | |
| Closed VAT period: auto-shift to today with callout | | fixed | „Врати ја во периодот“ → posting into a closed period is refused by the VAT lock (deliberate, LEGACY-MAP 5.4) |
| Курс missing for a FX invoice („Внесете курс за девизната фактура.“), no base message | | fixed | |
| Fuel purchase warning (14361) | | fixed | `fuelPurchaseWarning` (core, tested) |
| Duplicate confirm | | different | server duplicate rule + „Сепак зачувај (не е дупликат)“ checkbox |
| Excel purchase lines (`pxOpen` … `pxBuild`, `pxTpl`) | | fixed | `components/sales/px-import.tsx`, `@wise/core/sales` px.ts (tested); FIX 3.4 item 19: cached cell values, no `Function()` |

## 6. Повратници / одобренија од добавувачи (`povratDob`)

| Element | Server | Fix |
|---|---|---|
| „📷 Скенирај повратница“ (`scrScanFile`, SCR_PROMPT) | fixed | worker kind `scr`, `scrDraftFromScan` (core, tested), unknown supplier added, messages „Непрепознати артикли…“, „Не е најдена оригиналната фактура…“, „Пресметано ≠ на документот“ |
| List, editor, PDF (`scrPdfHTML`), delete | ok | |

## 7. Увоз од Excel / XML (`uvozMat`, `uvozMalo`)

| Element | Server | Fix |
|---|---|---|
| Rows pxdom / pximp (Excel purchase lines, domestic / import) | fixed | open the Excel lines dialog on `/vlez?px` / `?px=imp` |
| other rows (items, purchases, invoices, in, pop, journal, nivel, efaktura, fiskPer, masovnoM) | ok | |

## 8. Партнери, Артикли, Услуги

| View | Element | Server | Fix |
|---|---|---|---|
| partneri | „Увоз од Excel“ | fixed | `/uvoz?t=partners` |
| partneri | „Додели шифри“ | fixed | `autoCodesAction` |
| partneri / artikli | 🔒 N counts **documents**, where-used card (Вид · Број · Датум · Износ) | fixed | `partnerUsage`, `itemUsage`, `usedList` |
| partneri / artikli | Неактивен / Активирај toasts, delete refused when used | fixed | |
| partneri / artikli | Admin multi-select bulk delete (used ones skipped) | fixed | |
| partneri / artikli | „Избриши“ inside the editor | fixed | |
| partneri | ЦРМ „тековна состојба“ AI reader (`tkRead`, FS_PROMPT) | remaining | the firm-registry reader belongs to the firms area; partners can be imported from Excel meanwhile |
| partneri | „Excel образец“ / quick XT import | different | the import screen (`/uvoz`) with its own template covers it |
| artikli | „Увоз од Excel“, fuel banner, code-only callout, Тежина / OE / Замени / Возила columns | fixed | |
| artikli | Конто за приход select (7xxx, not 70xx), defaults from the posting scheme (`REV_K`) | fixed | |
| artikli | XT items import with opening quantity / cost / location | remaining | use the „Приемница / почетна залиха“ import in `/uvozMat` |
| uslugiS | own list (services) with all row actions and a form returning to Услуги | fixed | |
| sifrarnik | „Услуги“ link | fixed | now `/uslugiS` |
| uvoz | imported partners get the next code | fixed | |

## Counts

Approximate, counted from the five element-level audit tables behind this summary (the summary groups related elements):

- Audited elements: about 190.
- Fixed in this pass: about 140.
- Already equal: about 30.
- Deliberately different: 9.
- Remaining: 10 — opGoSel selection, row double-click, auto-link of free lines on the server, product cost-price
  confirm, „→ Продавница“, delivery proof print, recurring mail text, Gmail draft, ЦРМ тековна reader, XT items import.
  The reasons are given above.

No new database tables were needed: every field lives in existing jsonb columns (`purchases.data`, `invoices.data`,
`firms.settings`) and `ai_documents.options`; `AiDocKind` gained `cmp` and `imp` (text column, no migration).
