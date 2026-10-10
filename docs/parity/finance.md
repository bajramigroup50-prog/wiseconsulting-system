# Finance parity audit (legacy → server)

Area: banka · devizni · bankFmt · blagajna · ppNal · fiskPer · kompenzacii · pocetna · nalozi · kartici · bkAdv · kkart ·
analitika · poobjekti · bilanc · bbPart · recon · recFree · pozajmici · kamati · kursna · konto.

Legacy = `legacy/index.html`, final behaviour (base view + every wrapper, ACT override and change listener). Line numbers
refer to legacy. Status: **ok** = same behaviour · **missing** · **different** · **→ fix** = planned fix (becomes **✅** when done on
this branch) · **n/a** = intentionally not ported (reason given) · **open** = still missing (reason in “Remaining”).

Hard rule (coordinator): every list / report / card / book / document screen has PDF (server PDF via `PdfButton` or a
print view), export (Excel .xlsx, CSV) and import (Excel/CSV/XML with a downloadable template) wherever legacy had it or a
comparable screen had it. Rows marked **PDF/Excel/Import** track that rule.

Shared building blocks added: `components/parity-fin/export-bar.tsx` (PDF of an on-screen area + .xlsx + CSV),
`components/parity-fin/table-import.tsx` (Excel/CSV import + template), print views `app/print/nalog`,
`app/print/dnevnik`, …

---

## nalozi

| P | element | legacy behaviour | server before | status / fix |
|---|---|---|---|---|
| P1 | Nalog PDF / print | `nalogPdf` 7346 → `nalogPdfZ` 3561: firm head, „Финансов налог број“, Од, uppercase title, Отпечатено; Бр.·Датум·Изв.Бр·КОНТО·Должи·Побарува·Комитент·Содржина·Док.+забелешка; Вкупно; Книжел/Контролирал/Одговорно лице | missing | → `app/print/nalog?n=`; PDF button on the nalog page and on every list row |
| P1 | Correction of document journals (✎ Корекција F2) | `nalEdit` 7336 / `nalSaveRows` 3580: edit konto/D/P/partner/note/doc of any line, delete (↺ restore), add rows; must stay balanced; overlays `ed`/`edAdd` survive re-posting, dropped when the document line changes | different (refused) | → `journal_overrides` table, `@wise/core/finpar` (`applyOverride`/`diffOverride`), applied in `postJournal` on every re-post; editor in override mode, `requireCan('nalEdit')`, audit `nalOverride`; „🛠 рачно коригиран“ marker + „Врати како во документот“ |
| P1 | Nalog view columns | `nalogHTML` 3552: + Изв. бр., Назив налогодавач/примач (statements), Дев. должи / Дев. побарува | different | → Дев. columns from `amount_cur` when any line has a currency; Изв. бр. column for statement journals |
| P1 | Statement nalog note (`bankNote` 3597) | callout: items, inflow/outflow, D/P reversal explanation, unlinked count | missing | → callout on bank journals |
| P1 | Manual journal save checks | `saveJ` 7258 + 12981 | ok | ok |
| P1 | Numbering by kind/period | `nalogMap` 3483 | ok (persisted) | ok |
| P2 | Nalog Excel | `nalogXlsx` 7345: .xlsx Р.бр., Датум, Опис, Конто, Назив на конто, Должи, Побарува, Документ, Дев. должи, Дев. побарува, Шифра, Комитент | different (CSV) | → .xlsx with the legacy columns + CSV |
| P2 | Дневник CSV (`ledCsv` 7259) | one row per ledger line: Датум, Извор, Документ, Конто, Назив, Партнер, Должи, Побарува | different (per nalog) | → line-level Excel/CSV route `/nalozi/dnevnik` |
| P2 | Дневник PDF (`ledPdf` 7269) | landscape, ДНЕВНИК НА КНИЖЕЊА | missing | → `app/print/dnevnik` + header button |
| P2 | „Од шема“ in the journal editor (`jFromSch` 7254) | custom scheme + amount → rows | missing | → scheme select + amount → `custApply` |
| P2 | Shortcuts F2 / Esc / F4 / Ins | 7891–7893 | only Ins | → |
| P2 | List row actions | Отвори, ✎ Измени, PDF, 🗑, row double-click | only Отвори | → Измени / PDF / 🗑 (where allowed) |
| P2 | Delete nalog with its documents (`nalDelete` 6370) | deletes every source document | different | **n/a** – documents are deleted on their own screen (posting service keeps one writer); nalog shows links to the source screen |
| P2 | Duplicate purchases callout (`purDups` 4440) | warn + delete duplicates | missing | → callout with link to the purchases list |
| P2 | `oldVatHTML` 3872 | legacy collective-VAT-konto migration | missing | **n/a** – legacy data migration only (server never posts the collective konto) |
| P3 | Line search columns | Извор pill, konto name | different | → Извор + konto name columns |
| P3 | Per-bank nalog codes | `data-nb` inputs in „Шифри на налози“ | missing | → one input per firm bank account → `settings.banks[].nal` |
| P3 | 🔒 Фиксирај броеви / auto freeze | `nalFixAll` 7335 | n/a | **n/a** – numbers are persisted at posting and never move |
| P3 | Nalog date / title in list | period end + NAL_DEF title | different | → NAL_DEF title for ranged numbers |
| — | requirePartner on opening correction | opening allows 12x/22x without partner | bug | → `requirePartner:false` for `open`/`bbimp` |

## pocetna

| P | element | legacy behaviour | server before | status / fix |
|---|---|---|---|---|
| P1 | Manual grid, save, transfer from Y-1, date, full-year toggle, Excel/CSV parse | 6319, 7329, 7323, 13237, 10626 | ok | ok |
| P2 | PDF / image import of the trial balance (`importOpen` 10670 → `obAi`, `OB_PROMPT` 10618) | text parse + AI in chunks | missing | → AI kind `ob` (worker prompt = legacy `OB_PROMPT`) via the existing AI read pipeline; PDF/images accepted in the opening editor |
| P2 | Difference analysis (`obDiag` 12280–12338) | per class totals, result 4–8 vs diff, rows = diff / 2×diff / ½diff, duplicates, D+P rows, unknown kontos, pair search, ⇄ swap, summary-row removal | missing | → `obDiag` in `@wise/core/finpar` + panel in the editor |
| P2 | Opening PDF (`openPdf` 7333) | „НАЛОГ ЗА ПОЧЕТНА СОСТОЈБА“ | missing | → PDF button → `app/print/nalog?n=0&title=…` |
| P2 | Bank accounts from 100x/103x rows (`obAddBanks` 12222) | callout + auto after save | missing | → created on save (103x → EUR) |
| P2 | Excel template | template download | missing | → „⬇ Образец“ |
| P2 | Opening Excel export | — (comparable screens) | missing | → .xlsx/CSV of the rows |
| P2 | „+ Внеси ги сите како комитенти сега“ (`obMkP`) | creates partners now | different (on save) | ok – created on save in the same transaction |
| P3 | „🗑 Избриши ги сите“ draft rows | clears draft | different | → client „Исчисти“ |
| P3 | Confirm full mode for current year | 17173 | missing | → |
| P3 | Line notes reloaded | 6321 | missing | → |
| P3 | Draft survives navigation | `S.draft` | different | **n/a** – server-saved; draft is in-page only |

## konto

| P | element | legacy behaviour | server before | status / fix |
|---|---|---|---|---|
| P1 | List, class headers, add/edit/delete, 3–8 digits | 6822, 7385–7388 | ok | ok |
| P2 | Firm VAT kontos in `ACC()` 3278 | VAT in/out kontos from tariffs added to the chart | missing | → `effectiveChart` callers: firm VAT kontos are inserted as firm accounts when missing (konto page action „Додај ДДВ конта“ + on posting error message) |
| P2 | PDF / Excel / Import (hard rule) | legacy had none; comparable codebook screens have Excel | missing | → PDF + Excel/CSV export, Excel/CSV import of firm accounts with template |

## kursna · bkAdv · bankFmt · kompenzacii · ppNal

| P | view | element | legacy behaviour | server before | status / fix |
|---|---|---|---|---|---|
| P1 | kursna | Data source / shared list | `appsettings/fx` 6493 | ok | ok |
| P1 | kursna | „+ Нова курсна листа“ | all currencies, prefilled with `getFx` 7961 | different (12 currencies) | → all currencies |
| P1 | kursna | Edit with changed date | deletes rows of the old date too (7962/7966) | different | → hidden `orig`, old date removed |
| P2 | kursna | Excel | .xlsx Датум·Валута·Назив·Среден курс, ascending, settings users | different (CSV) | → .xlsx + CSV + PDF, Назив column |
| P2 | kursna | Import (hard rule) | — | missing | → Excel/CSV import (Датум, Валута, Курс) with template |
| P3 | kursna | „+ Валута“ live name | 7964 | different | ok – fixed empty rows are enough |
| P1 | bkAdv | FIFO virtual allocation, three tables | 12529–12551 | ok | ok |
| P1 | bkAdv | `paidFor` wrapper affects all reports | 12538 | different (FIX 4.4 #7, intentional) | **n/a** – kept: virtual allocations are a view, not bookings |
| P2 | bkAdv | Year scope | all years | different | ok – current year is the business-year rule everywhere else |
| P2 | bkAdv | Links from banka/kartici (callout, pill, Детали) | 12523, 12553–12555 | missing | → banka callout + link; kartici callout |
| P2 | bkAdv | PDF / Excel (hard rule) | — | missing | → |
| P2 | bankFmt | Analyzer, per-bank best format, bank table | 12726–12750 | ok | ok |
| P2 | bankFmt | KB default bank 300 | 12730 | different | → |
| P3 | bankFmt | banka header link „🔎 Формати по банка“ | 12751 | missing | → |
| P3 | bankFmt | Analyzer for every user | 12746 | different | **n/a** – needs a firm for the account match; kept behind login + firm |
| P1 | kompenzacii | List filtered by year | 8926 | different | → |
| P1 | kompenzacii | Налог column | 8928 | missing | → |
| P1 | kompenzacii | Live totals Побарувања/Обврски/Разлика | 8939/8944 | missing | → client totals |
| P1 | kompenzacii | „⚖ Пополни автоматски“ (bilateral only) | 8936/8960 | different | → |
| P1 | kompenzacii | Duplicate number → auto К-nnn/yyyy | 8969 | different (DB error) | → |
| P1 | kompenzacii | Bilateral = one partner check | 8964 | missing | → |
| P2 | kompenzacii | Edit: change kind / add partners | 8956 | different | → |
| P2 | kompenzacii | Print header (firmHead with ЕДБ, bank, Отпечатено) | 8945, 3254 | different | → `FirmHead` |
| P2 | kompenzacii | Confirm text, explanatory note | 8971, 8930 | different | → |
| P2 | kompenzacii | Excel/CSV/PDF of the list (hard rule) | — | missing | → |
| P1 | ppNal | Municipality code in ПП50 account (`ppMuni`) | 15765 | different | → `mpOpsFrom(muni ‖ city ‖ address)` |
| P1 | ppNal | VAT ПП50 suggestion, sort by due | 15773–15775 | different | → |
| P1 | ppNal | Calibration dx/dy per form | 15816/15823 | missing (print reads it) | → calibration card + action |
| P1 | ppNal | `printed` stamped only once | 15800 | different | → |
| P2 | ppNal | Bank names auto-filled from accounts | 15820 | different | → filled on save via `ppBankName` |
| P3 | ppNal | „Готов образец за данок“ select in ПП50 editor | 15809 | missing | → |
| P3 | ppNal | IBAN notice, help text, printer card | 15841/15818/15845 | missing | → |
| P2 | ppNal | Excel/CSV of saved orders (hard rule) | — | missing | → |
| P1 | ppNal | Print without saving first | 15806 | different | ok – save is one click before print (server data) |

## banka · devizni

| P | element | legacy behaviour | server before | status / fix |
|---|---|---|---|---|
| P1 | Add bank account → konto in chart | `addBankAcct` 7203 / 4846 creates „Трансакциска сметка – name“ / „Девизна сметка CUR – name“ | missing (posting fails `unknown_account`) | → create firm account in `saveBankAccount` |
| P1 | Duplicate bank konto | 7204 „Ова конто веќе се користи…“ | missing | → reject |
| P1 | Unbooked lines posting | `bankEntries` 3384 posts unbooked lines to 1200/2200 | different (statement stays draft, saldo pill wrong) | → draft statements show „непрокнижен – не е во книгите“ instead of a false saldo difference (strict posting kept) |
| P1 | „Прокнижи автоматски“ incl. AI classification (`aiClassify` 4856) | autoMatch layers + AI classification of the rest with reason pills | AI step missing | → AI kind `bankClassify` (legacy prompt verbatim), proposals in review with reason |
| P1 | Auto-match after import | 4761/4784/4808 | different (needs click) | → import goes to the review with proposals preselected |
| P1 | Re-import in another format (`_impAsk` 12661) | replace old lines or cancel | missing (lines appended) | → preview option „замени ги старите ставки“ |
| P1 | Undo import per batch (`undoImp` 7201) | | partial (only creating batch) | → undo per import batch |
| P1 | Control totals from file (`izvTot`) | MT940 / XML / AI totals saved | missing | → stored as stated debit/credit for single-date statements |
| P1 | Bulk link partners (`bkpFix` 12433) | callout + „Поврзи ги со комитентот од изводот“ | missing | → callout + action |
| P1 | Inline booking select (`data-bk` 4838) | per-row select, bank kontos excluded, toast with learned rule | different | → bank kontos excluded, learned rule in message, editor anchored at the row |
| P1 | Change konto of an account with lines | 4846 allowed, statements re-booked | blocked | → allowed with confirm, re-post statements |
| P1 | Manual line (`mbNew` 13255) | direction, invoice picker, amount in currency, date today | partial | → direction, open-document picker, FX conversion, today |
| P1 | FX rate & amounts, FX closing, MKD closing, POS/VAT/osnov/fee/payroll/rules layers, conversions, header number, balances, control totals inputs, Налог button, unlink, flip, delete, learned rules, lock | 4708–4885, 12385–13325 | ok | ok |
| P1 | devizni: AI printed rate | 4802 saved as statement rate | different | → statement rate from AI |
| P1 | devizni: balance in currency (`bookSaldoCur` 12652) | opening + Σ amountCur | different | → statement-chain balance |
| P2 | AI/PDF statement read; archive file „Извод“ | 4796 prompt verbatim; `archiveFile` | prompt ok; file not linked | → file id stored + archive |
| P2 | Excel/CSV fallback to AI | 4789 | missing | → „Прочитај со AI“ fallback |
| P2 | KB unknown account → add 108x account (12677) | | different | → preview error + „Додај сметка“ |
| P2 | KB balances-only file (12679) | saves balances + number | missing | → header without lines |
| P2 | Missing numbers suggestion + `izvFill` (12389) | neighbour-based | different | → `izvSugg` port + callout with confirm |
| P2 | POS box + `posFee` (13075–13082) | card turnover vs received, „Книжи провизија 4460“ | missing | → callout + action (banka and fiskPer) |
| P2 | Payment notifications `pnCard` (13319) | e-mail payment confirmation to customer, summary to office | missing | → firm setting + mail queue on invoice links |
| P2 | Unlinked payments callout / pill (12522, 12553) | links to bkAdv / bkUnl | missing | → callout + pill |
| P2 | Transit one-sided (`trOpen` 12764) | warn | missing | → callout |
| P2 | Transit residue direction label | 4810/7810 | partial | → label |
| P2 | Fee fix confirm / count over year (12406) | | different | → confirm, year count |
| P2 | Same-reference partner search (`bkSameRef`, `bkPick` 12692) + note | | partial | → same-ref list + note field |
| P2 | Owner check against other firms (12880) | | partial | → other-firm match by account |
| P2 | Gaps, Halk fee split, MT940, Excel/CSV table import, multi-file, currency warning | | ok | ok |
| P3 | Osnov / reference under description (12650) | | missing in list | → |
| P3 | Pills own / conv / POS from flags | | partial | → |
| P3 | „🔎 Формати по банка“ header link (12751) | | missing | → |
| P3 | Admin bulk delete (`bkDel` 16905) | | missing | → checkbox column + bulk delete (admin) |
| P3 | Rules, accounts panel, empty states, devizni = banka FX | | ok | ok |
| P2 | PDF / Excel (hard rule) of the statement list | none in legacy (printed from the nalog) | missing | → PDF + Excel/CSV of the shown statements |

## kartici · kkart · analitika · poobjekti · bilanc · bbPart · recon · recFree

(recon/recFree archive PDF is another agent's work and not tracked here.)

| P | view | element | legacy behaviour | server before | status / fix |
|---|---|---|---|---|---|
| P1 | bilanc | „Заклучен лист (PDF)“ (`zlHTML` 8238) | 14 columns, Актива/Пасива, Расходи/Приходи, Финансиски резултат | missing | → `app/print/bilanc/zl` + button |
| P1 | bilanc | Објект filter (`bb_w`) | by location | missing | → `wh` filter (screen, print, bbPart) |
| P1 | kkart | PDF (`kkPdf` 7973) | landscape card | missing | → print view + button |
| P1 | kkart | columns (`kkTable` 12823): Налог датум, Датум на валута, Докум./калк., `kkSod` | | different | → columns + `kkSod` |
| P1 | kartici | supplier warnings (`supWarn` 8485) | | missing | → callouts |
| P1 | kartici | „ставки без комитент“ view: Извор, bank party, ✎ gated, `bkpFix` button | | partial | → |
| P1 | kartici | advances callout `#kcAdv` (12554) | | missing | → |
| P1 | kartici + analitika | „📨 Потврди на салдо – сите“ (13834–13854) | bulk balance confirmations, PDF and e-mail | missing | → bulk page: PDF all + e-mail via mail queue |
| P1 | recon | PDF / image card read (`REC_PROMPT`) | AI | missing | → AI kind `rec` |
| P1 | recon | „📄 Потврда на салдо“ with diff note (13747) | | missing | → `diff` param |
| P2 | bilanc | analytic PDF layout `bbo` (13653) + `bbAnK` setting (13681) | per-partner breakdown | different / missing | → |
| P2 | bbPart | partner filter carried over | | different | → |
| P2 | kartici print | right block, Извод број, Калкул. број columns (`kcPdfPart` 6444); `kcSod` text | | different | → |
| P2 | analitika | „Картица“ → kontos 12,22 (`toKart` 7273); confirm >30 | | different | → |
| P2 | analitika/kartici | ИОС print permission from kartici too | | different | → |
| P2 | recFree | period mode (v433 13827), difference tile (v432 13803), record extras | | missing / different | → |
| P2 | recon | ЕДБ in record sub, Конто column, header names, Excel names | | different | → |
| P3 | kkart | Excel .xlsx 14 columns; back param | | different | → |
| P3 | analitika | line-level CSV (`anCsv` 7261) | | different | → extra „Ставки“ export |
| P3 | kartici | CSV decimal comma; Enter opens exact konto | | different | → |
| ok | kartici/analitika/poobjekti/bbPart/bilanc | header buttons, pickers, cards, synthetic card, ИОС, card PDFs, poobjekti PDF, bbPart table, levels/filters/CSV/PDF | | ok | ok |
| P2 | all | Excel (.xlsx) next to CSV (hard rule) | | CSV only | → |

## blagajna · fiskPer · kamati · pozajmici

| P | view | element | legacy behaviour | server before | status / fix |
|---|---|---|---|---|---|
| P1 | kamati | invoices of earlier years (`sInv` 3870) | all open overdue invoices | different (year filter) | → |
| P3 | kamati | PDF / Excel (hard rule) | none in legacy | missing | → |
| P1 | blagajna | validation, posting, numbering, nalog per register, header, registers, scan, editor, tiles, cash book | 6513–6591, 7938–7952 | ok (posting cents-precise FIX 4.4 #14) | ok |
| P2 | blagajna | live duplicate warning + batch pill (`blgDup`) | | different | → |
| P2 | blagajna | F4 / Esc, focus | 7957 | missing | → |
| P2 | blagajna | Excel `blgXlsx` 7952 (Курс, Салдо CUR, .xlsx) | | different | → |
| P3 | blagajna | PDF дневник: country, signature „Одговорно лице“ | 7275 | different | → |
| P3 | blagajna | konto name / fx source under fields; description label · note | | missing | → |
| P1 | fiskPer | post all rows (per day / summed with days) | `fkPost` 11448 | different | → |
| P1 | fiskPer | same day re-post guard | 11414 | missing | → |
| P1 | fiskPer | revenue / card / cash konto inputs, nonVat | 11422–11428, 13104 | missing | → |
| P2 | fiskPer | read VAT per group, control checks + tick gate, transcript, read table, confirm, remember options, DFI settings, attach file | 11351–11463, 13043–13140 | missing / different | → |
| P2 | fiskPer | multi-page scan, МЕТГ day spread, step-2 goods issue, manual device field | | different | → |
| P2 | fiskPer | POS box | 13084 | missing | → |
| P3 | fiskPer | devices tab, DFI print links, non-store warning | 11511, 13134, 13151 | missing | → |
| P1 | pozajmici | loans from bank lines not on loan kontos (`lnBankKind` 16681) | | missing | → |
| P2 | pozajmici | rebook to 1620/2620, „🔗 Поврзи“, 📎 signed contract, amount in words, select all | 16743–16879 | missing | → |
| P2 | pozajmici | Word export (`lnWord`) | | missing | → |
| ok | pozajmici | contracts, KPI, unlinked list, editor, ignored list, contract print | | ok | ok |
