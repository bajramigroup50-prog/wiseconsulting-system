# Parity audit — VAT, payroll & HR, year-end, law

Legacy reference: `legacy/index.html` (final behaviour after the runtime wrappers). Server: `apps/web/app/(app)/<view>`.
Status: **ok** = matches legacy; **fixed** = was missing/different, fixed on this branch; **different** = deliberate
difference (reason given); **gap** = still missing (reason given). Every screen also has the shared header „⬇ PDF“ /
„⬇ Excel“ of what it shows (`components/hd.tsx` → `ScreenExport`, from main); legacy-specific exports are listed below.
Automated check: `node tools/parity-check/check.mjs --view <id>` (results at the end).

## VAT

| View | Element | Legacy behaviour | Status | Fix |
|---|---|---|---|---|
| ddv | Period list, tiles, ДДВ-04 table/form, PDF form, inspector link | 5969 → 13126 → 16456 → 16836 | ok | – |
| ddv | Month/quarter switch | 16456: select, confirm „Даночниот период на … да се смени во МЕСЕЧЕН/ТРИМЕСЕЧЕН?…“ | fixed | `ddv/period-kind.tsx` (select + confirm, submits on change) |
| ddv | Excel (CSV) VAT evidence | `ddvCsv` 7263: rows per document & rate group, `DDV_evidencija_<p>.csv` | fixed | `core/vat/evidence.ts` `ddvEvidenceRows` (+tests); CSV + Excel buttons |
| ddv | PDF книга на фактури | `ddvBookPdf` 7318, landscape, both books | fixed | `print/ddvKniga` + `invoiceBookRows` (credit notes negative in the last column too — FIX) |
| ddv | Posting card button/messages | „Потврди и книжи во налог“, „ДДВ-04 е книжена во налог.“, „Книжењето на ДДВ е избришано.“ | fixed | close/reopen labels and messages |
| ddv | „Прекнижи“ while closed | 7313 | different | reopen + close (reopen needs `close` — deliberate FIX from Phase 5) |
| ddv | Control card ДДВ-04 ↔ 994/999 | `vbCheckHTML` 3532 | gap | off-balance VAT base lines (`vbLines`) are not posted by the rebuild's posting schemes, so there is nothing to compare |
| ddvKnigi | Tabs, period, check pill, columns, PDF, Excel | 8901 | ok | CSV file name `Kniga_izlezni_<a>_<b>.csv` (fixed) |
| ddvTab | Years, rows mode, columns, Excel | 16806–16829 (`/ddv?tab=insp`) | ok | – |
| ddvTab | „последни 5“, „Стандардни“, „Сите 31“ | `dtLast5`, `dtColsDef`, `dtColsAll` | fixed | links in the inspector |
| ddvTab | Column choice remembered per firm | `dtSaveCols` → `firm.dtCols` | fixed | `saveDtColsAction` → `settings.dtCols` (guarded, audited), default in `lib/vat-insp.ts` |
| ddvTab | 🖨 PDF | `dtPdf` landscape, page per year | fixed | `print/ddvTab` |
| ddvTab | 📦 Во пакет за УЈП | `dtPkg`, preset `ujp` | fixed | report `ddvt` in `paket` REPORTS + UJP preset; header link |
| tarifi | Editable VAT kontos (final 12844 replaced 6975) | per rate out/in/import, 32-a, close, scope firm/all | fixed | `/tarifi` renders the editor (`ddv/tarifi-view.tsx`); all-firms confirm; legacy note; TARIFI kontos fixed to analytic defaults |
| efPrep | Steps, check, stats, table, bad buyers | 15200–15233 | ok | – |
| efPrep | „✎ Отвори партнери“, step 5 date, law status line, checked-at, empty text | 15214 … | fixed | (open-firm button also landed on main) |

## Payroll

| View | Element | Legacy behaviour | Status | Fix |
|---|---|---|---|---|
| plati (list) | Month table, МПИН column + box, notes card, new month, recalc all | 6168, 14097, 15240 | ok | – |
| plati | „📥 Плата од Excel“ (template + import → draft month) | v478 `plxTpl`/`plxImp` 14736–14781 | fixed | `core/payroll/xlsx-import.ts` (+tests; FIX: template rows by column key), `plati/xlsx-actions.ts`, `xlsx-box.tsx`; warnings callout in the editor (from the `plxImp` audit row) |
| plati | Пребарувај (employee across the year) | `payFind` 7115 | fixed | search card, „Отвори“ preselects the employee |
| plati | 🗑 МПИН delete (admin) | `mpinDel` 14147 | fixed | admin-only in `deleteMpinMonth` too |
| plati | Преглед per month, Дефинирани ставки / Измени шифри | 6172 | fixed | links |
| plati | „Нема отклучени месеци.“ | `payCalcAll` | fixed | – |
| editor | 2027 rate warning + F4 confirm | `payRateWarn` 14407 | fixed | `payRateWarnNeeded` (+test), law entry title |
| editor | After-F4 panel | `payDoneModal` 8258/14822 | fixed | `DonePanel` (browse slips, print/PDF/send all, office-only totals) |
| editor | List keys Ins/Enter/↑↓ | 6286–6294 | fixed | (line dialog F9 not added — the dialog is a form, Enter submits) |
| editor | Hours tooltip | 6196 | fixed | – |
| editor | Payslip e-mail as PDF attachments | 8288–8305 | fixed | `pdf.mail` via `queuePdfMail`; default mode „one“ to the firm e-mail |
| editor | Group mail: names/count, „✎ Распореди ги вработените по единици“ | 8283, 14886 | fixed | `OeEditor` + `oe-actions.ts` |
| editor | Office signature on the slip | v487 `offSigPrep` 14827 | fixed | `SlipPreparer` (office sig image, rep · brand) |
| editor | ≤480 KB PDF parts | 14865 | different | server mail has no Gmail size limit |
| payPredlog | Notes card | 15260 | fixed | – |
| payGod | Excel `Плати {Y}`, PDF | 7138–7141 | fixed | Excel; PDF via header export |
| payM4 | Excel `М4 {Y}` with Од/До месец, PDF | 7142–7143 | fixed | – |
| payBatch | „prev“ mode copies only `sin` lines | 15283 | fixed (bug) | `payCopyPrev(…, ['sin'])` (+test) |
| payBatch | 2027 rate gate, notes message | 15301 | fixed | – |
| payBatch | Preview with Часови, also for calculated months; auto note + МПИН archived | 15326–15330 | fixed | – |
| payBatch | Отвори switches firm | 15315 | fixed | `PickFirm` |
| payBatch | МПИН zip folders `МПИН – name – ЕДБ/YYYY/file` | 15335 | fixed | `zipFiles(…, {dirs:true})` |

## HR

| View | Element | Legacy behaviour | Status | Fix |
|---|---|---|---|---|
| vraboteni | List, form (26 fields + MPIN), leave table, AI read, ⚖, contract | 6813, 14726, 15691 | ok | – |
| vraboteni | „Увези од Excel“ + „Excel образец“ (`Vraboteni.xlsx`) | `XT.employees` 6906 / `IMP_T` 5384 | fixed | `core/payroll/emp-import.ts` (+tests), `importEmployeesXlsx`; Excel export with the same columns |
| vraboteni | 📎 documents per employee | 6816 | fixed | – |
| vraboteni | Admin bulk delete | `slDel` 16934 | fixed | `deleteEmployeesBulk` (skips employees in payroll runs) |
| vraboteni | Sort by name | `simpleList` | fixed | – |
| vraboteni/dogovori | Office-owner lock | 7754 / 15683 | fixed | `lib/hr-lock.ts` (office firm → administrator only) |
| dogovori | Registry, filters, PDF | 6099 | ok | „Договорот ги содржи задолжителните елементи.“ added |
| pdd | List, editor, PDF | 8329 | ok | message „Прокнижено како директен трошок.“ not shown (save redirects) |
| mpinIn | Upload, rows, grid | 14074–14172 | ok | grid 🗑 admin-only (fixed) |
| mpinIn | Client inbox payroll file → МПИН list | 14104 | gap | portal routing kept to Плати (office area of another agent) |
| cb_paysif / cb_position | Codebooks | 6957 | ok | – |

## Year-end

| View | Element | Legacy behaviour | Status | Fix |
|---|---|---|---|---|
| phase bar | 7. Досие, 8. Нова година, ⚙ Алатки (АОП, Правила, стар XML, Што каде кога) | `ZS_PH` 11157 | fixed | `ph-bar.tsx` |
| zsProc | Cards 1–8 (notes archive Y−1/Y, Y−1 shortcuts, ЦРМ period, size line, dossier, new year) | 11178 | fixed | `archiveNotesAction` (snapshot in `settings.belSnap/zsArch`), `setCrmPeriodAction`, `YearGo` |
| zsProc/zsKontrola | „⇄ Распредели по партнери“ | npDist 17047–17090 | fixed | `npDistAction` (replaces the line through `updateJournal`, creates partners); „📥 Пополни од аналитика“ not ported (gap: needs the AI/sheet reader of the opening import) |
| findings | Open partner card on the partner | `zcGo` | fixed | – |
| zsKontrola | Steps 1–6 + ЦРМ card 7 | 10893 → 11070 | fixed | `core/yearend/kontrola.ts` (+tests) |
| zs_bs / zs_bu | „📥 Увези од поднесена годишна сметка“ (Excel/CSV), Актива = Пасива pill | `zmImport` 10953 | fixed | `core/yearend/zm-import.ts` (+tests); PDF via AI is a gap (no generic AI reader kind for annual accounts) |
| zs_skr | Скратен биланс на успех | 7666 | fixed | new view + Excel |
| zs_aop | АОП list, CSV, XML | 7692, 7724–7725 | fixed | new view + Excel + `AOP_<Y>.xml` |
| zs_pr | Rules editor, Excel template/import, reset | 7695–7730 | fixed | new view, `saveZsRulesAction`/`resetZsRulesAction` (settings perm) |
| vjetore | Годишна сметка (стар XML) | 6772 / `gsXml` 6791 | fixed | new view + CSV + `Godisna_smetka_<Y>.xml` |
| zs_sp | Revenue per konto with activity code, by activity, Зачувај шифри | `spData` 7652 | fixed | `spRows` (+test), `saveActMap` |
| zsXml | `GS_<Y>_<ЕМБС>.xml`, confirm on ЦРМ errors, rules table, gate message | 11066 | fixed | – |
| zsBel | Previous year from the archived notes | 10924 | fixed | uses `belSnap[Y−1]` when present |
| zsNPO | Tabs, previous-year column, ДБ-НП 01–04, small NPO books + statement, chart tab, npoPlan | 10463–10493 | fixed | `core/yearend/books.ts` (+tests), `npoPlanAction` |
| zsTP | Books КП/КТ/КО/КПС, tax stored, advance note | 10499–10518 | fixed | – |
| zsRok | Filing calendar | 10523 | ok | – |
| zsDos | Select-all / Gmail / share | 11136 | ok (main) | done by the office/zsDos agent |
| os | View (photos, documents, QR), card/label PDFs, vehicle block, preset → konto+rate, unique inv. no., expiry badges, scan-to-open, Excel export/import | 5850, 8631–8684 | fixed | `core/yearend/assets-io.ts` (+tests), `os/asset-form.tsx`, `(print)/os/{etiketi,karton}`, `components/qr.tsx` (new dep `qrcode@1.5.4`) |

## Law

| View | Element | Legacy behaviour | Status | Fix |
|---|---|---|---|---|
| lawrep | Rules p_lnfree / l_lnint | v541 16762 | fixed | `LrInput.loans` from `loanStateOf` (+tests) |
| ujpZakoni | INSP u_loan | 16759 | fixed | `inspLoans` in the firm snapshot (+test) |
| zakoni | ⛽ fuel-selling firms callout | 14373 | fixed | `core/law/fuel-seller.ts` (+tests) |
| zakoni | Top-bar robot badge | 14321/14392 | ok (main) | – |
| zakoni | Live search (debounce), 🗑 admin-only | 14337, 14340 | different | submit-based search; delete needs `del` |

## Automated check (after the fixes)

`node tools/parity-check/check.mjs --view <id>`: ddvKnigi, tarifi, payGod, payM4, payPredlog, zsTP, zsRok, os, zs_db, zs_sp,
zs_de, zs_vp, zsBel, zs_aop, zs_pr, zs_skr, vjetore, lawrep, ujpZakoni: 0 missing. Remaining "missing" labels are
legacy toasts with no server equivalent (AI-unavailable texts, Gmail draft messages, `askConfirm` cancel texts) or the
gaps listed above.

## New tables / migrations

None. Extra data is stored in existing jsonb columns (`firms.settings`: `dtCols`, `belSnap`, `zsArch`, `actMap`,
`zsRules`, NPO `accounts`/`sch`/`ent`; `fixed_assets.data`: vehicle fields, `docs`, `photos`) and in `file_links`
(entity `fixed_asset`). The payroll Excel import keeps its warnings in the `plxImp` audit row.
