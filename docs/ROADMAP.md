# Rebuild roadmap & progress

Source of truth for the phase-by-phase rebuild. Full design: [PLAN.md](PLAN.md). Functional reference: `legacy/index.html`.

**Rules for every phase**
- Port behaviour from the *final patched* legacy function; keep the legacy UI markup/classes (`legacy.css`).
- Domain logic lives in `packages/core` (pure, unit-tested, golden-tested against legacy where possible).
- Every mutation goes through `can(user, action, firmId)` and writes `audit_log` in the same transaction.
- Money is `numeric(18,2)` / integer denars-cents in code, never float arithmetic for stored amounts.
- A phase is **done** when `pnpm typecheck`, `pnpm test` and `pnpm build` pass, its features work in the running app, and it is committed.
- Record each finished phase in the log at the bottom (date, commit, notes, known gaps).

## Phases

- [x] **1. Foundation** — monorepo, Docker Compose, Drizzle schema v1 + migrations, auth (argon2 + legacy hash upgrade) & RBAC, firm picker (400+ firms), layout/nav from legacy `NAV`, audit log, MinIO upload service, user & role admin.
- [x] **2. Core books** — partners, items, chart of accounts (KONTO_SRC seed), journals (manual entry, numbering, locks), trial balance, account cards, opening balance (manual + Excel).
- [x] **3. Sales & purchases** — invoice editor + print templates, credit notes, proforma, dispatch; purchases with landed costs; AI document reading job + review UI (batch), duplicate detection; UBL import/export.
- [x] **4. Bank & cash** — statement import (MT940, camt.053, Halk, KB), auto-match & rules, FX differences, cash register (blg) with receipt scanning.
- [x] **5. VAT** — ДДВ-04, VAT books, posting & period close, PDF form.
- [x] **6. Payroll & HR** — employees, payroll runs, payslips (PDF + e-mail), MPIN TXT/XLSX, payment orders, contracts, HR registry.
- [x] **7. Stock & retail** — moves, stock lists, ЕТ/ЕТМ/МЕТГ, levelling, transfers, POS & fiscal reports (КДФИ, DFI control), production & BOM.
- [x] **8. Year-end** — depreciation, close/open year, AOP statements, ДБ, ЦРСМ XML export/import, phase gate (`zcFindings`).
- [x] **9. Office** — dossier, inbox & client portal (klient role), tasks, Word templates, packages/ZIP, reminders, recurring invoices, autopilot, inspection readiness, AML, GDPR, formation.
- [x] **10. Industry modules** — hotel, rent-a-car, travel, transport, construction, restaurant, appointments (per-firm `mods` toggle).
- [x] **11. Legacy import** — dropped 2026-10-08, revived 2026-10-10 by the user: `packages/legacy-import` (backup ZIP/JSON → Postgres + object store, legacy ledger recompute through the posting service, trial-balance verification), worker job `legacy.import`, admin page Систем › 📥 Увоз од старата програма (`/uvozStara`). Formats and mapping: `packages/legacy-import/README.md`.
- [x] **12. Deploy** (live on https://207.180.254.154 until DNS works) — VPS (Docker, deploy user, firewall), `/opt/wise/.env`, `docker compose up -d`, Caddy TLS for `app.wiseconsulting.com.mk` + `www.app` + `files.app`, nightly pg_dump + S3 bucket sync (30 days), GitHub Actions deploy on push to main (`.github/workflows/deploy.yml` → forced-command key → `docker/deploy.sh`).

## Parallel execution plan

Phases run as separate agents, each in its own git worktree/branch (`phase/<n>-<slug>`). The coordinating session merges them into `main` one at a time and runs the full check suite after each merge.

**Wave A — starts when Phase 1 is committed**
- Agent: Phase 2 Core books (ledger, posting service, masters, trial balance). This is on the critical path.
- Agents writing pure `packages/core` logic + golden tests only, with no DB or UI (each touches only its own new files):
  - `vat.ts` + `posting.ts` schemes (feeds 3 and 5)
  - `payroll.ts` + MPIN TXT (feeds 6)
  - `stock.ts` average cost, landed costs, FIFO/LIFO (feeds 7)
  - `bank-parsers.ts` + matching (feeds 4)
  - `yearend.ts` AOP engine, ДБ, ЦРСМ XML (feeds 8)

**Wave B — starts when Phase 2 and Wave A are merged:** DB + UI for Phases 3, 4, 5, 6, 7 in parallel.
**Wave C:** Phases 8, 9, 10, 11 in parallel.
**Then** Phase 12 deploy.

**Conflict rules for parallel agents**
- Schema: each phase adds `packages/db/src/schema/<phase>.ts` and re-exports it from the schema index. Agents do **not** generate migrations; the coordinator generates one migration after each merge.
- Nav and routes: each phase adds its own route folder under `apps/web/app/(app)/<module>/` and registers nav items in its own file, not by editing one shared list.
- Shared files (root config, `packages/core/src/index.ts`, schema index, nav registry): add lines only, never reorder or rewrite them, so merges stay trivial.
- Each agent runs `pnpm typecheck && pnpm test && pnpm build` on its branch before reporting done.

## Needed from the user (blocking only Phase 12)
- VPS: IP address, SSH user, and SSH key access set up (no passwords typed by Claude).
- MKhost DNS: `A` records `app`, `www.app` and `files.app` (zone wiseconsulting.com.mk) → VPS IP (user sets these in the MKhost panel).
- Secrets entered by the user in `/opt/wise/.env`: Anthropic API key, SMTP, DB/S3 passwords.

## Progress log

| Date | Phase | Commit | Notes / known gaps |
|---|---|---|---|
| 2026-10-08 | 1 Foundation | f517d2f | Built by session "New infrastructure setup". Gaps: Caddyfile serves DOMAIN + files.DOMAIN only (www still to add); MinIO image tags in compose.yml not verified; Cyrillic ILIKE needs C.UTF-8 initdb (PGlite dev is ASCII-only); abandoned-upload cleanup leaves orphan MinIO objects. |
| 2026-10-08 | 2 Core books | merged 2026-10-08 | Schema books.ts (+ migrations 0001 generated, 0002 custom deferred balance trigger), posting service (`postJournal`/`updateJournal`/`unpostSource`/`deleteJournal`), core `ledger.ts` with golden tests, KONTO_SRC/cities/currencies seed, views partneri, artikli, konto, nalozi, bilanc, kkart, pocetna. Gaps: codebook (`cb_*`/`sifrarnik`) and partner-card (`kartici`, `analitika`/IOS) screens, PDF/AI opening import, nalog PDF, posting schemes (`semi`, SCH_OLD fix) not ported. |
| 2026-10-08 | Wave A core ports | merged | `packages/core`: payroll+MPIN, stock costing, year-end (AOP/ДБ/ЦРСМ/depreciation), VAT (ДДВ-04, books) + posting schemes for all document kinds, bank parsers + matching; all golden-tested vs legacy. Root export clashes resolved in `index.ts` (namespaces `Stock`, `Posting`, `Vat`, `Payroll`, `Yearend`, `Bank`, `BankParsers`, `Ledger`). Follow-ups: margin konto 6690 vs 6694 in fiscal `trgNoVat` (settle in Phase 7); `test/` dirs not typechecked (core tsconfig includes only `src`); `closeYearLines` exists in both ledger (stopgap 10% tax) and yearend (ДБ tax), unify in Phase 8. |
| 2026-10-08 | 5 VAT | merged (ff) | `vat_periods` + migration 0003; `/ddv` (ДДВ-04, corrections, close/reopen, inspector table, VAT accounts), `/ddvKnigi`, print views; closed-period posting lock (`vat-lock.ts`). TODO(merge): plug document tables (Phases 3/4/7) into `VatDocumentSource`, align `VAT_SOURCE_TYPES` with their sourceType names, merge `vat-context.ts` with Phase 3's posting context. Until then the ledger fallback misses 0%/export/exempt/non-deductible detail. |
| 2026-10-08 | 8 Year-end | merged | Fixed assets + depreciation, year close/open/lock via the year-end engine (one implementation; stopgap 10% close removed), AOP statements, ДБ/ДБ-ВП, forms 38/35, ЦРСМ XML export/import, findings gate, NPO + sole trader, print views. Migration regenerated as 0004_yearend. TODO(merge): payroll head counts (bu257), gate inputs from bank/stock/invoices/pending docs. Gaps: zsDos, zsRok, AOP rule editor, sole-trader books, 0193 → bs015. |
| 2026-10-08 | 9 Office | merged | Dossier, tasks/reminders, office inbox + klient portal (server-enforced pending approvals), Word templates (docx fill), packages + ZIP, AML, GDPR, formation, inspection readiness, autopilot (6h job), recurring invoices, service contracts; server PDF via playwright-core + Debian chromium in the worker image (`pdf.render`). Migration regenerated as 0005_office. TODO(merge): data readers from Phases 3/5/6/7, approval → real document handlers, recurring → Phase 3 invoice drafts; TODO(mail) and TODO(ai) hooks. Gaps: baranja, opomeni, law robot, klProfili, mail history, firm import, loans, docCode. |
| 2026-10-08 | 7 Stock & retail | merged | Generic `stock_moves` (write via `replaceSourceMoves`), levelling, transfers, counts/write-offs, POS + Z reports (`sales_daily`), BOM + production, re-averaging; stock lists, item cards, ЕТ/ЕТМ/МЕТГ (golden-tested `stock-books`), КДФИ, DFI control. Margin konto settled on 6694. Migration regenerated as 0006_stock. TODO(phase3): move→document resolver for purchases/invoices/dispatches; TODO(ai): fiscal-report reading, BOM suggestion. Gaps: promotions UI, barcodes, stock-list Excel, supplier returns in m_izlez. |
| 2026-10-08 | 4 Bank & cash | merged | bank_accounts/statements/lines/rules, fx_rates, cash registers + vouchers, payment orders (ПП30/50/10), compensations; screens banka, devizni, blagajna, ppNal, kursna, bankFmt, bkAdv, kompenzacii + print views; migration 0007_bank. TODO(merge): `OpenItemsSource` → Phase 3 tables, posting-context helper, `cash_vouchers` into VAT source; TODO(ai): PDF statements, receipt reading; TODO(payroll): net-salary matching. Gaps: POS fee journal, statement files not stored, ppCal editor. |
| 2026-10-08 | 6 Payroll & HR | merged | employees, payroll runs/emp/lines, params, settings, notes, MPIN exports, hr_contracts/hr_docs, mail_log; Nodemailer `mail.send`/`mail.flush` + web `queueMail`; screens for employees, payroll months/editor, payslips, recap, MPIN TXT/XLSX, ПП30/ПП50, payslip e-mail, params, contracts, HR registry; year-end head counts wired. Migration 0008_payroll. Gaps: УЈП acceptance inbox, cross-firm payroll, ПДД, Excel import, code editors. |
| 2026-10-08 | 3 Sales & purchases | merged | invoices (+credit notes, proformas, dispatch, advances), purchases with VAT groups/stock/landed costs, supplier credits, UBL export/import, print views, AI reading (`apps/worker/src/ai`, `ai.read-document`, `ai_usage`, legacy prompts verbatim), scan review + batch; stock via Phase 7 `replaceSourceMoves`. Migration 0009_sales. One shared `firmPostingContext`. Gaps: paid/remaining columns, payment QR, multi-invoice PDF split, Excel purchase import, fuel VAT rule, red-storno credit mode. |
| 2026-10-09 | Integration pass | branch worktree-agent-af14bf7a1574d8038 | All cross-phase hooks resolved (no TODO(merge/ai/mail/phase3/phase7/payroll/vat) left): VAT from document tables (+ ledger fallback for manual VAT journals), vatDueEstimate → ПП50 + autopilot; bank open items from invoices/purchases with paid/remaining columns, net-salary matching; office readers, client-entry approval → posted documents, recurring → Phase 3 drafts, year-end gate inputs; e-mail everywhere via mail_log, invoice.mail (PDF attached), server PDF buttons, packages with generated reports; AI reads for receipts, statements, employee docs, fiscal reports, BOM, inbox classification; store purchase → levelling; ET sale value. Migration 0010_ai_kinds (ai_documents.file_id nullable). Gaps: бруто биланс is not yet a print view, so packages cannot hold it; the fiscal second read (FK_SIMPLE) runs in the worker, multi-day fiscal reads prefill one day at a time. |
| 2026-10-09 | 10 Industry modules | merged | Module toggles (`moduli`, `firms.mods`, menu + routes + services gated), hotel, restaurant, rent-a-car + shared fleet, construction, travel agency (margin VAT via the real VAT source), appointments, travel orders, freight; invoices via Phase 3, cash via Phase 4, POS via Phase 7. Migration 0011_industry. Gaps: auto service, orders/replenishment, loyalty, MRP, lots, GPS/signature driver flow, fuel-card import, CMR print. |
| 2026-10-09 | Deploy prep | 5e33c63 | MinIO images are no longer published (quay.io 401, Docker Hub gone) → SeaweedFS 4.48 as the S3 store (`s3` service, bucket via `s3-init`); www → apex redirect; optional `IP_HOST` self-signed access before DNS; backup syncs the bucket with aws-cli 2.31.0. Images build on the VPS (web 423 MB, worker 4.26 GB — worker image copies the full build stage; slim it later). |
| 2026-10-09 | 12 Deploy | live | VPS 207.180.254.154 (Ubuntu 24.04, 6 CPU/11 GB/193 GB): Docker, `wise` deploy user, ufw 22/80/443, fail2ban, unattended upgrades, 4 GB swap, SSH password login off. `/opt/wise/app` = git checkout, secrets in `/opt/wise/.env` (600). Stack up: postgres 17, SeaweedFS, app (healthy), worker (9 jobs), Caddy. Reachable at https://207.180.254.154 (self-signed, `IP_HOST`). Nightly backup 02:30 (wise crontab), verified. Pending: wiseconsulting.com.mk is NXDOMAIN (domain not active / no NS) → Let's Encrypt waits; ADMIN_PASSWORD empty → set it and run `docker compose run --rm migrate`; SMTP not configured. Update: `cd /opt/wise/app && git pull && docker compose -f docker/compose.yml --env-file /opt/wise/.env up -d --build`. |
| 2026-10-10 | 11 Legacy import | branch worktree-agent-a4cd26d80afe50390 | New schema file `legacy-import.ts` (`legacy_import_runs`, `legacy_id_map`) — migration to be generated by the coordinator. Idempotent per firm (legacy id map), one transaction per firm, audit row per import. Gaps: users / office data / attached files are in no legacy backup (full-export format supported if the artifact is republished with the export snippet); docs types without tables go to `firm_docs` (see README §4); `firm.payNotes`, `firm.contacts`, employee contracts stay in jsonb. |
