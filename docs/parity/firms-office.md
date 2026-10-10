# Legacy parity — Фирми / Канцеларија / Архива / Систем / Помош / Анализи

Audit of the legacy views (final behaviour after every `VIEWS.<id>` patch in `legacy/index.html`) against the server,
2026-10-10. Status: **ok** = matches legacy, **fixed** = was missing/different and is fixed on this branch,
**different** = deliberately different (reason given), **remaining** = still missing (reason given).

Every screen header now has „⬇ PDF“ / „⬇ Excel“ of what it shows through the shared `ScreenExport` in `Hd`
(main, 450ecad); the rows below list the legacy-specific prints, exports and imports on top of that.

| view | element | legacy behaviour | server status | fix |
|---|---|---|---|---|
| firmi | header | ⬇ Excel образец · 📥 Увоз од Excel · 📷 Нова фирма од решение · + Нова фирма | ok | (main 2e471b0) + ⬇ Извоз (server addition) |
| firmi | list columns | Фирма (+ „пример“ pill) · ЕДБ · ДДВ (Да · месечно / тримесечно / Не) · Заклучено до | fixed | columns, example pill, „тековна“ pill; search kept (server addition) |
| firmi | row actions | Отвори (select + go home) · Измени · Избриши | fixed | `openFirm`, edit link, delete (in the firm card, admin) |
| firmi | 🔓 Отклучи | admin: lock moves back to 31.12 of the previous year, confirm text | fixed | `unlockFirm` + `unlockTo` (core, tested), audit |
| firmi | firm report card | „🖨 Извештај за фирмите“: filter (Сите / ДДВ / месечно / тромесечно / не), вклучи примери, PDF (landscape list with totals + signatures), Excel (10 columns) | fixed | `/print/firmi`, `/firmi/izvestaj`; filter also filters the table |
| firmi | editor tabs | Основни · Дополнителни · Плата · е-Фактура | fixed | `firm-form.tsx`, all tabs submit together |
| firmi | Основни fields | шифра, име, правна форма (grouped LF_OPTS, lfGuess), адреса, град, телефон, факс, доп. телефон, жиро (+ „Жиро сметки…“), реална жиро, доп. жиро, ЕМБС, рег. број, ЕДБ, банка, доп. банка, ЕДБ/жиро/депозитор на банката, дејност, општина/2/за друг град, код за плата, контакт, е-маил, потписник + статус | fixed | all stored under legacy keys in `firms.settings` (`bank` mirrored to `bankAccount`) |
| firmi | side panel | контен план, репро зависност, ДДВ + период, ГДВП година, тековна година, фирма родител, заклучен период, транспортни трошоци по количини | fixed | lock date moved back only by admin |
| firmi | invoice look | лого / потпис / печат (upload, „Отстрани“), изглед (classic/modern/minimal), боја, 👁 Преглед, QR, напомена (INV_NOTE0 default), законска забелешка | fixed | images → file store ids; preview `/print/firmPregled` with unsaved values |
| firmi | Сметководствени услуги | месечно без ДДВ + фактурирај од, note with office firm and contract no. (not for office firm / clients) | fixed | `accFee` decimal string, validated (core test) |
| firmi | Дополнителни | шифра во малопродажба, сериски статус, инст./сметка/обрасци плати, рег. бр. сметководители, ДДВ конта по стапки (VAT_BAD ignored), сите претходни на едно конто, составувач (9), одговорно лице (8), „Копирај составувач → одговорно лице“ | fixed | `vOk` like legacy |
| firmi | Плата / е-Фактура | тип, занаетчија, заштитна, даночен обврзник, просек, заклучена, адвокат; ef_taxNo, ef_contact, ef_email, ЕПДД, сертификат serial/thumb | fixed | |
| firmi | new firm | creates the client-portal profile (klAutoUser) and opens the firm | fixed | credentials shown once |
| firmi | 📷 Пополни од решение | button in the new-firm card | fixed | → `/firmiResh` |
| firmi | Избриши фирма | admin, two confirmations, backup, hard delete of all data | different | FIX: archived (`active=false`), hidden from lists/picker/current firm, „🗄 Избришани фирми“ → ↩ Врати; books and audit are kept |
| top bar / picker | no firm selected | full-screen firm picker (search, groups, Excel, new firm) instead of a dashboard | fixed | `FirmPicker`, `lib/top-status.ts`, `picker.ts` (tested) |
| top bar | firm pill, ЕДБ · ДДВ · заклучено, robot badge, mail icon, „Нема известувања“, user + Одјава, „⏏ ИЗЛЕЗ ОД ФИРМАТА“ | fixed | `top-bar.tsx`, `top-actions.ts`, `izlezF` |
| home | dashboard | hero, period, quick actions by role/modules, KPI tiles, charts, deadlines, checks, money, ageing, top lists, open items, latest docs with „Налог“, recurring invoices per firm (one click), autopilot tile with messages, incoming-messages chip, law robot | fixed | PDF of the dashboard |
| home | fuel banner | `fuelBanner` | remaining | needs the fuel VAT rule / fuel item flags (not kept on the server) |
| izvestuvanja | header | 🔊 Прочитај · ↻ Провери повторно, reminder settings (popup / voice / daily e-mail) | fixed | `AlVoiceButton`, `AlSettings` |
| izvestuvanja | filters | level buttons with counts, Сите, kind, firm, прикажи и потврдените | fixed | |
| izvestuvanja | per-firm cards | level · kind · text · Отвори (opens the firm on the screen) · ✓ Во ред / ↺ | fixed | `unackFinding` added |
| izvestuvanja | per-firm kind switches in the matrix (`alOff`) | turn a check off for one firm | remaining | the autopilot job has no per-firm exclusions yet |
| izvestuvanja | checks run in the browser | | different | the autopilot job runs them every 6 h / on „Провери повторно“ |
| arhiva | rows | every document with files: влезна/фискална/увозна, излезна/одобрение, archived docs, assets, employees, fiscal reports | fixed | `lib/archive.ts` from `file_links`; unlinked files shown as „Датотека“ (server addition) |
| arhiva | filters / columns | text, Вид, Од, До in the working year; Датум · Вид · Број · Комитент · Износ · Налог · Документи · Отвори / 🗑 | fixed | core `archive.ts` (tested) |
| arhiva | Листа (Excel) | arXlsx, oldest first | fixed | `/arhiva/xlsx` |
| arhiva | scan card | 📷 Скенирај / прикачи нов документ · 🗂 Досие на фирмата | fixed | → `/arNewNav` |
| arNewNav | opens the new-document form | | ok | |
| dosie | header | 📷 Нова тековна состојба · 📷 Нова – вистински сопственик · + Нов документ / скенирај | fixed | category preset |
| dosie | callouts | stale current-state (3 / 6 months), expiring documents (30 days) | fixed | |
| dosie | search / kind filter, selection | ✉ Gmail · 💬 WhatsApp / Viber · ⬇ Преземи on the selected | fixed | e-mail form preselected, `/dosie/zip` |
| dosie | WhatsApp | share sheet with the files | different | browser cannot attach files to WhatsApp from a server page: message opens prepared and the ZIP downloads |
| dosie | table | ☐ · Назив (најнова / постара верзија) · Број · Издаден / старост · Архивирано · Важи до · Датотеки · ✉ 💬 ✎ 🗑 | fixed | edit adds pages |
| dosie | AI naming of a new document (`dosAi`) | the scan is read to suggest the title | remaining | needs a new AI prompt kind in the worker |
| paket | presets | 🏛 УЈП – еден клик, Банка – кредит, Лизинг / тендер, ДДВ пријави, Плати, Исчисти | fixed | preselect newest dossier docs, highlight reports |
| paket | period, freshness age, cover letter, sent history | | fixed | history from `mail_log` |
| paket | report × year matrix (PKG_REP, 5 years), auto-build of all PDFs in one click, partner cards selection (`kpBox`) | | remaining | the server adds each report PDF through its print view (`?pkg=`); server-side batch rendering of every report is not built |
| kdogovori | contract list, editor with preview, office/client signatures, signed PDF into the dossier, all-firms overview, monthly invoice plan | | fixed | `kdog.ts` (tested) |
| klPortal | header 📥 Пристигнато (n) · 👁 Види како клиент; warning; profiles (auto from NKD / by hand); sections with ★, module off; Само основно / + препорачани; store-door notice with PDF; sticker image; client users | | fixed | `/print/klNote`; sections filtered by modules everywhere (`klAllowedViews`) |
| klHome / klSend | send document / message, contract to sign | | ok | |
| insp / autop | inspection readiness and autopilot details | | fixed | partial port by sub-agent (insp-extra, autop-view) |
| aml | access | only owner / AML officer; others get the report form | fixed | |
| aml | tabs | 👥 Клиенти (🔍 Анализирај ги сите, risk counts, client file, overview) · 🏢 Канцеларија (officer, user, deputy, trainings, annual control, links) · 🚩 Пријави (new report, status Анализа / Пријавено во УФР / Без пријава) | fixed | new table `aml_reports`; office settings `app_settings.aml` |
| aml | office documents (одлука, програма, проценка на ризик) Word / PDF | | remaining | texts not ported yet; link to Шаблони |
| zzlp | owner only, law callout, tiles, checklist, per-client agreement table with ✓ Потпишан / ↺, upload | | fixed | |
| zzlp | Word/PDF of УЈП request, statement, DPA per client; control-code verification; subprocessor editor | | remaining | documents through `/tpl`; code verification needs the document-code register |
| tpl | per built-in document: own .docx override, versions, 🧪 Проба, ↺ Вграден | | different / remaining | server `tpl` is a library of Word templates filled with firm data; per-document overrides of the built-in generators are not wired |
| mojzad | my tasks, accept / done / problem, upload, free tasks, done list | | ok | |
| semi | Врати стандардни, Зачувај | | ok | |
| semi | „Прекнижи ја {година} според шемите“ | | remaining | needs a re-post entry point for invoices / purchases in the sales module |
| uvoz | template per collection | | ok | |
| sistem | backups, export | | ok (not re-audited in detail) | |
| PWA | installable app | (server addition, requested) | fixed | manifest, icons, theme colour |
| kanc, baranja, osnovanje, moduli, zatvoranje, firmiImp, firmiResh, klInbox, klProfili, korisnici, aktivnost, mailPotpis, greski, uvozStara, pomos, klDash, mojIzv, analizi | | | not re-audited element by element in this pass | label scan only: no missing header actions except those listed above |
