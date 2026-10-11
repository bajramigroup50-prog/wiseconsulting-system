# Legacy parity — Дејности and transport

Scope: hotel, hotelSoby, hotelKniga, servis, vozila, delovi, potsetnici, rent, flota, rentIzv, gradba, gradbaIzv, tura,
turaIzv, termini, kartoni, periodicni, moduli; transport pnalozi, pnLive, pnGorivo, mojpn, frTuri, frFak, frGor, frDnev,
frDok. Legacy = `legacy/index.html` (final behaviour after the runtime patches, line numbers in the text).

How it was checked: a manual audit of each view and its helpers / ACT handlers / patches, then the automated label
checker (`node tools/parity-check/check.mjs --view <id>`) after the fixes. The **Status** column is the state
**before** this work.

**PDF / Excel / import (the user's hard rule).** Every screen header (`Hd`) on main has „⬇ PDF“ (server PDF of the
screen) and „⬇ Excel“ (every visible table), so each list, report, card and book in this area has PDF + Excel. On top
of that, the legacy-specific documents, exports and imports listed below were added. Shared building blocks are
`apps/web/components/list-tools.tsx`: `ExportXlsx`, `ListPdf`, and `XlsxImport` (Excel/CSV import with a „⬇ Образец“
template download and extra `fields`).

## Checker after the fixes

| view | labels present | moved (found on another screen) | missing | what is still "missing" |
|---|---|---|---|---|
| hotel | 67 | 1 | 3 | validation messages that live in the db service (`hotel.ts`); „Не може да се креира комитент“ cannot happen (`findOrCreatePartner`) |
| hotelSoby | 24 | 0 | 1 | message in the service |
| hotelKniga | 29 | 0 | 0 | — |
| servis | 54 | 0 | 1 | message in the service |
| vozila | 23 | 0 | 0 | — |
| delovi | 13 | 1 | 0 | — |
| potsetnici | 16 | 0 | 0 | — |
| rent | 74 | 4 | 5 | messages in the service; the draft-invoice toast — see "Remaining" |
| flota | 24 | 1 | 0 | — |
| rentIzv | 20 | 0 | 0 | — |
| gradba | 80 | 1 | 2 | messages in the service |
| gradbaIzv | 24 | 0 | 0 | — |
| tura | 85 | 2 | 2 | messages in the service |
| turaIzv | 41 | 0 | 0 | — |
| termini | 31 | 0 | 2 | messages in the service |
| kartoni | 12 | 2 | 0 | — |
| periodicni | 35 | 6 | 0 | — |
| pnalozi | 57 | 1 | 1 | message in the service |
| pnLive | 11 | 0 | 0 | — |
| pnGorivo | 41 | 2 | 2 | messages in the service / fleet component |
| mojpn | 18 | 1 | 0 | — |
| frTuri | 77 | 1 | 2 | legacy "Excel not available in this view" fallback; draft-invoice toast — see "Remaining" |
| frFak | 32 | 15 | 0 | — |
| frGor | 20 | 2 | 0 | — |
| frDnev | 23 | 0 | 0 | — |
| frDok | 16 | 1 | 0 | — |
| moduli | 16 | 0 | 0 | — |

## Element table

| view | element | legacy behaviour | status | fix |
|---|---|---|---|---|
| pnalozi | header „🛰 Возила во живо“ | link to pnLive | missing | added |
| pnalozi | warning callout | 🔧 service due (`pnSvc`: oil / tyres overdue or within 1,000 km), 📄 registration / insurance / technical inspection within 30 days, ⛽ fuel > 15 % over norm in a month ≥ 200 km (`pnFuelAlerts`) | missing | `serviceDue`, `vehicleDocAlerts`, `fuelAlerts` (core `transport-parity.ts`) + callout |
| pnalozi | cash callout | cash collected by drivers and not booked, per driver | ok | — |
| pnalozi | documents of a day | date input changes the day immediately; count; „🚚 Креирај патен налог за сите (N)“; first 12 listed | different (separate form) | `DateJump` + inline form |
| pnalozi | list columns | Број, Датум, Возило, Возач, Релација, Застанувања (done/all + ↩ pill), Км, Готовина (+ „непрокнижено“ pill), Статус | different | ↩ and „непрокнижено“ pills, fq km |
| pnalozi | row actions | Отвори, PDF, 🗑 (an order that has left only with the delete right) | missing 🗑 | `RowAction` delete with the legacy rule |
| pnalozi | ⚙ Стандардно | vehicle, driver, phone user (all active non-client users), „Тргнување од (магацин)“, „Дневница – полн износ (ден.)“, business-trip checkbox, legal note, no-vehicles hint | different labels and users list | legacy labels, note and hint; all active users |
| pnalozi | new-order defaults (`pnNew`) | vehicle: default → last order → first; driver: default → last → the only driver; assignee: default → last; start km from `pnOdo` or the last return km | missing | `newTravelOrderDefaults` + `lastTravelOrder` |
| pnalozi | editor callouts | expired vehicle document („не треба да тргне на пат“), load over capacity, service due | missing | added |
| pnalozi | editor fields | Број, Датум, Возило, Возач, „Сопатник / помошник“, „На телефон кај (терен)“, Тргнување од, Цел, km at departure / return, fuel l / MKD, per diem | different labels | legacy labels |
| pnalozi | load and fuel line | ⚖ peak kg / capacity %, goods without weight; 🛣 km · l/100 km (norm) · MKD/km; ⏱ duration (`pnHM`) and per diem | missing | added (`travelLoad`, `orderKm`, `orderL100`, `hoursMinutes`) |
| pnalozi | route | 🗺 Google Maps through the open stops, split every 9 legs | missing | `travelRoute` |
| pnalozi | cash card | 💰 total collected + „Прокнижи во благајна (N уплатници)“ + note | different (one bottom button) | legacy card |
| pnalozi | add stops | „+ Додај фактура / испратница / влезна фактура…“ from the order date's documents not yet on an order; „+ Рачно застанување“ | missing (manual only) | multi-select of unassigned documents (`editedTravelStops`, stops always rebuilt from the stored order) |
| pnalozi | stop block | ☑ loaded (saved), „скенирано N“ pill, signature and photo thumbnails, cash booked / not booked, returns + „↩ Креирај повратница (одобрение)“, receiver, GPS map link | partly | all added |
| pnalozi | delivery confirmation | „📄 Потврда за испорака“ (`pnPodHTML`): buyer, time, GPS, vehicle / driver, cash, receiver, goods qty / returned / received, signature, photo | missing | print view `/pnalozi/pod` (`podHtml`) |
| pnalozi | notify the buyer | „✉ Извести го купувачот“ per stop (re-send shows the date) and „✉ Извести ги купувачите (N)“: e-mail with the delivery-confirmation PDF | missing | `travelMailAction` (worker PDF + mail queue, stops marked `mailed`) |
| pnalozi | over-capacity save | confirmation before saving | missing | error + „Сепак зачувај (товар над носивоста)“ checkbox |
| pnalozi | trip log | „Дневник на патувањето“ with GPS (±accuracy) | different | legacy card; GPS accuracy recorded |
| pnalozi | order PDF | „ПАТЕН НАЛОГ ЗА ТОВАРНО ВОЗИЛО“: departure / return time + km, km / duration, fuel l/100 km, peak load, per diem, stops table with 8 legacy columns and signature image, signatures „Издал налогот / Возач“ | different | rewritten as legacy |
| pnalozi | invoice preview | „🚚 Испорачано dd.mm hh:mm ✍“ opens the delivery confirmation (`docView` patch 9486) | missing | `PodLink` in `/print/doc/[id]` (one added line) |
| mojpn | header | name of the field user | different | sub = user name (logout is in the top bar) |
| mojpn | order card | border colour by status, number · plate, date · driver · loaded x/y · 💰 cash on me | missing | added |
| mojpn | navigation | 🗺 through all stops (from here when on the road) | missing | added |
| mojpn | barcode loading | „📷 Товари со скенирање“: camera BarcodeDetector (EAN-13/8, Code 128/39, UPC-A/E), USB / Bluetooth scanner + Enter, beep, quantity counter, „сите“, auto-save, message when the browser has no detector (ROADMAP Phase 10 gap) | missing | `TravelScan` component + `saveTravelScanAction` (`saveTravelLoading`) |
| mojpn | delivery form | cash only for invoice stops with the „= debt“ button, returns in `<details>`, confirmations: no receiver name or signature; cash above the debt; negative cash | partly | `CashFill`; `DriverForm` `needOne` / `cashOpen` |
| mojpn | departure / return confirmations | not all goods loaded (when scanned); open stops at return | missing | `confirmMsg` |
| mojpn | finished orders | last 5 | missing | `doneOrdersOfAssignee` |
| mojpn | live indicator and note | live-location callout, legacy note | partly | added |
| pnLive | whole view | list, age, speed, delivered, next stop, map, track SVG, 30 s refresh | ok | — |
| pnGorivo | fuel tab | click on a vehicle → per month (⚠ months), vehicle name, legacy note | missing | `fuelRows` + month table |
| pnGorivo | service tab | „✓ Направен сега“ (km → last service, odometer), „следен на X км“, load capacity, „истечено / за n дена“, note | missing | `serviceDoneAction` (`travelServiceDone`) |
| pnGorivo | per-diem tab | columns Датум / Налог / Возач / Тргнување / Враќање / Траење / % / Износ; warning when the full amount is not set; „Збир по возач и месец“; PDF „ПРЕСМЕТКА НА ДНЕВНИЦИ – ВОЗАЧИ“ | different | `perDiemRows`, `perDiemByDriverMonth`, print `/pnGorivo/dnevnici` |
| pnGorivo | patch 14654 | when the freight module is on: buttons 🚛 Тури / 🌍 Дневници во странство / ⛽ Картички + „сопствена дистрибуција“ hint | missing | added |
| pnGorivo | vehicles | fleet editor + Excel import of the transport fields (template) | import missing | `importVehiclesAction` |
| frTuri | list | title, buttons (Лиценци, Дневници, Картички, ⬇ Excel with the 23 legacy columns, + Нова тура), licence-expiry callout, filters (open / all / status, month, client), columns incl. costs / difference / invoice number, totals, hint | different | rebuilt (`freight-parity.ts`, `FreightPickForm`) |
| frTuri | editor | Основно / 📦 Товарење / 🏁 Истовар / Стока (за CMR) / 💶 Цена и фактура / 🌍 Граници / Трошоци sections, CMR field labels (Влекач, Број на тура, нарачка, Испраќач / Примач поле 1–2, ADR класа, колети, договорена цена, курс), currency lists, per-segment hours / auto units, costs note, ⛔ expired documents, validations, quick add of vehicle / trailer / driver | different | `FreightEditor` + `frQuickAction` |
| frTuri | CMR | international consignment note with the firm stamp in box 23 (ROADMAP gap) | stamp missing | `invoicePrintImg(settings.stamp)` |
| frTuri | invoice from tours | same client and currency, legacy line text and notes, invoice date from unload | ok (issued directly, legacy opened a draft) | — (see "Remaining") |
| frDnev | view | month, „+ Ново патување со дневници“, per driver with PDF (`frDnevPdfHTML` + stamp), tours without borders callout, ⚙ amounts per country with validation | different | rebuilt + print `/frDnev/print` |
| frDok | view | columns За (👤/🚛) / Вид / Број / Важи до / badge, single „+ Документ“ with the За switch, hints without vehicles or employees, delete only with the delete right | different | `FrDocForm`, legacy columns; Excel import with template |
| frGor | view | import with column detection, month table, imports list with delete | ok | — |
| frFak | view | invoices from tours, paid / partly / unpaid, totals, „должат“ | ok | — |
| rent | customer documents | „📷 Скенирај пасош / лична карта“, „🪪 Скенирај возачка дозвола“ (AI read, copies kept with the contract) | missing | AI kinds `rcdoc` / `rclic` (worker prompt `RC_DOC_PROMPT`), `RentDocScan`, `rcDocToDriver` |
| rent | customer fields | Државјанство (list), „ЕМБГ / Personal No.“, document type, valid until, „Издаден од“, licence categories, „Возачка издадена“, „📞 Телефон за контакт *“ with call / WhatsApp links, „Контакт во итен случај (име, телефон)“, „Дополнителен возач (име, возачка)“ | different labels / missing | added |
| rent | countries | „🌍 Држави во кои ќе се патува“ checkboxes, green card, exit authorisation | different (text field) | checkboxes + callout |
| rent | warnings | vehicle taken, driver age, licence years, licence / ID / vehicle documents expiring before the return, abroad without green card | missing | `rentWarnings` |
| rent | handover / return | km, fuel eighths select, „Оштетувања / забелешки“, 📷 photos, customer signature | different | `PhotoField` ×3 + `SignaturePad`, stored as files |
| rent | contract | „🖨 Договор“ + „🖨 2 примероци“, sheet 1 (sections 1–5, terms, declaration) + sheet 2 (handover record, fuel bars, damage sketch, equipment checklist, photos, signatures); „💾 Зачувај и 🖨 договор“ | different | rewritten print `/rent/dogovor?n=2` |
| rent | calendar | date input for the start | missing | `DateJump` |
| flota | prices import | Excel prices of the fleet (`DIG.fleet`) | missing | `importFleetPricesAction` + template |
| rentIzv | tabs | 🚗 By vehicle (service and deadlines), 📅 By month (fleet use, not invoiced, average per day, bar), 👤 Clients and countries, ⚠ Open items (late, abroad, no invoice, unpaid, deposits, documents) | only the vehicle tab | added (`rentByMonth`, `rentClients`, `rentOpenItems`, `rentReportRows`) |
| hotel | reception | grid date input, colour legend, 🧹 click marks a room clean, partner name and invoice / folio pills in the list | missing | added by the hotel / rent pass |
| hotel | editor | clash / date callouts, room → price and beds for a new reservation, check-in validation (guests required, confirm missing birth date / document), item price from the article | missing | added |
| hotel | imports | rooms (`DIG.hroom`) and reservations (`DIG.hres`, Booking.com / Airbnb / Excel) | missing | `XlsxImport` + `importHotelRooms` / `importHotelReservations` |
| hotelKniga | tabs | book, foreigners, tourist tax, occupancy (ADR / RevPAR), 📊 ДЗС by country (patch 11809), PDF | ДЗС missing | added (`hotelDzsStat`) |
| servis | invoice | „🧾 Фактура“ opens a DRAFT invoice for review (legacy `bzInvDraft`); parts leave stock when it is saved; short-stock confirmation (ROADMAP gap) | different (booked at once) | unbooked `draft` invoice, refreshed while it is a draft, the order frozen once booked |
| servis / vozila | registration certificate | „🪪 Сообраќајна“ AI read → prefilled vehicle form | missing | AI kind `vreg` + `VregScan` |
| vozila | form | VIN-length confirmation, duplicate check, „+ Налог“, history | partly | `vehicle-form.tsx`, Excel import of vehicles |
| delovi | „+ во налог“ | adds the part to the work order the search came from, saved or not | different | restore-and-add flow |
| potsetnici | reminders | WhatsApp text, e-mail, „✓ Контактиран“, settings | ok | export only |
| gradba | project photos | „📷 Додај фотографии“ (`cp_ph`) | missing | `ProjectPhotos` (`addConstructionPhotos`, `file_links`) |
| gradba | list | „📈 Анализи“ (patch 11839) | missing | added |
| gradba | imports | projects and the BOQ from Excel | missing | `importProjectsAction`, `importBoqAction` |
| gradbaIzv | tabs | 📍 By project and city (contract, executed, invoiced, not invoiced, collected, receivable, costs, result, margin; city totals), 💰 Cost structure (invoices / cash / diary, cost to executed, bar), 📅 By month; status filter | one table | rebuilt (`consRow`, `consByCity`, `consByMonth`, `documentPayments`) |
| tura | booking | „📷 Скенирај пасош“ adds a passenger; „🎫 Ваучер“; „Вкупно рачно (ако е договорено)“; „Соба / забелешка“; „📞 Телефон *“; passport valid under 3 months warning | missing | `RentDocScan variant=passport`, print `/tura/vaucer`, labels, `passportWarn` |
| tura | travel contract | `tbPdfHTML` sections 1–5, includes / excludes, terms, guarantee, declaration (+ чл. 38 note) | different | rewritten |
| tura | import | arrangements from Excel | missing | `importArrangementsAction` |
| turaIzv | чл. 38 evidence | „Патник / нарачател“ column | missing | added |
| termini | reminder | e-mail, else WhatsApp (marked reminded), else „Нема телефон ни е-пошта.“ | different | WhatsApp link + „✓ Потсетен (WhatsApp)“ |
| kartoni | import | clients / patients from Excel | missing | `importClientsAction` |
| periodicni | import | recurring definitions from Excel | missing | `importRecurringAction` |
| moduli | entity type | „Вид на субјект“ radio (patch 10531) | missing | `saveEntityAction` |
| moduli | activity profiles | profile checkboxes, automatic from the NKD code / manual, „↺ Врати автоматски од шифрата“ | missing | `saveModuleSetupAction`, `autoProfilesAction` |
| moduli | modules | per module: activities, automatic yes/no, setting (автоматски / секогаш вклучен / исклучен), state | different (plain checkboxes) | three-state setting (`settings.modsOv`) |
| moduli | overview | all firms with NKD, activity, „рачно“ pill, modules, „Отвори“ | partly | added (`FirmGo`) |

## Counts

- Elements audited: 112 table rows above (each row groups the legacy elements of one area; the checker matched 868
  labels across the 27 views).
- Fixed in this pass: 101 rows. Rows marked ok: 11.
- Remaining: 4 differences (below). The checker reports 0 missing button, column, field or export labels in this area.
  What it still lists are validation messages that are implemented in `packages/db` services, which the checker does
  not scan.

## Remaining differences (with reasons)

1. **Draft invoices from hotel, rent-a-car, travel and freight.** Legacy `bzInvDraft` opened an unsaved invoice for
   review. Here these modules issue the invoice through the Phase 3 service straight away, so advances, deposits and
   module links stay consistent. Only the work order uses a draft (ROADMAP requirement). The same mechanism
   (`saveInvoice({ draft: true })` + approve in the invoice editor) can be applied to the others if wanted.
2. **Travel-order return credit note** is created directly with the returned quantities. Legacy opened the credit-note
   editor for review.
3. **„Отвори“ on a firm in moduli** switches the firm and stays on Модули. Legacy reopened the same view too, so this is
   only listed because the switch now goes through `selectFirm`.
4. **Live tracking with the phone locked** is not possible from a web page (legacy said the same). A GPS device or
   native app would be needed.

## New tables / migrations

None. Everything uses the existing tables (jsonb `stops`, `driver`, `out` / `ret`, `firms.settings`, `file_links`,
`firm_docs`). TypeScript-only additions to jsonb shapes: `RentDriver.auth` / `scans`, `RentHandover.photos` / `sig`.
New text values in the `ai_documents.kind` column: `vreg`, `rcdoc`, `rclic`. The column is plain text, so no migration
is needed. `packages/db/src/schema/parity-industry.ts` exists for future tables and is empty.
