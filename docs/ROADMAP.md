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
- [ ] **3. Sales & purchases** — invoice editor + print templates, credit notes, proforma, dispatch; purchases with landed costs; AI document reading job + review UI (batch), duplicate detection; UBL import/export.
- [ ] **4. Bank & cash** — statement import (MT940, camt.053, Halk, KB), auto-match & rules, FX differences, cash register (blg) with receipt scanning.
- [x] **5. VAT** — ДДВ-04, VAT books, posting & period close, PDF form.
- [ ] **6. Payroll & HR** — employees, payroll runs, payslips (PDF + e-mail), MPIN TXT/XLSX, payment orders, contracts, HR registry.
- [ ] **7. Stock & retail** — moves, stock lists, ЕТ/ЕТМ/МЕТГ, levelling, transfers, POS & fiscal reports (КДФИ, DFI control), production & BOM.
- [x] **8. Year-end** — depreciation, close/open year, AOP statements, ДБ, ЦРСМ XML export/import, phase gate (`zcFindings`).
- [ ] **9. Office** — dossier, inbox & client portal (klient role), tasks, Word templates, packages/ZIP, reminders, recurring invoices, autopilot, inspection readiness, AML, GDPR, formation.
- [ ] **10. Industry modules** — hotel, rent-a-car, travel, transport, construction, restaurant, appointments (per-firm `mods` toggle).
- [ ] **11. Legacy import** — `packages/legacy-import` CLI: backup JSON → Postgres + MinIO, journal recompute, trial-balance verification.
- [ ] **12. Deploy** — VPS (Docker, deploy user, firewall), `/opt/wise/.env`, `docker compose up -d`, Caddy TLS for `wiseconsulting.com.mk` + `www`, nightly pg_dump + MinIO mirror (30 days), GitHub Actions deploy.

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
- MKhost DNS: `A` records `wiseconsulting.com.mk` and `www` → VPS IP (user sets these in the MKhost panel).
- Secrets entered by the user in `/opt/wise/.env`: Anthropic API key, SMTP, DB/MinIO passwords.

## Progress log

| Date | Phase | Commit | Notes / known gaps |
|---|---|---|---|
| 2026-10-08 | 1 Foundation | f517d2f | Built by session "New infrastructure setup". Gaps: Caddyfile serves DOMAIN + files.DOMAIN only (www still to add); MinIO image tags in compose.yml not verified; Cyrillic ILIKE needs C.UTF-8 initdb (PGlite dev is ASCII-only); abandoned-upload cleanup leaves orphan MinIO objects. |
| 2026-10-08 | 2 Core books | merged 2026-10-08 | Schema books.ts (+ migrations 0001 generated, 0002 custom deferred balance trigger), posting service (`postJournal`/`updateJournal`/`unpostSource`/`deleteJournal`), core `ledger.ts` with golden tests, KONTO_SRC/cities/currencies seed, views partneri, artikli, konto, nalozi, bilanc, kkart, pocetna. Gaps: codebook (`cb_*`/`sifrarnik`) and partner-card (`kartici`, `analitika`/IOS) screens, PDF/AI opening import, nalog PDF, posting schemes (`semi`, SCH_OLD fix) not ported. |
| 2026-10-08 | Wave A core ports | merged | `packages/core`: payroll+MPIN, stock costing, year-end (AOP/ДБ/ЦРСМ/depreciation), VAT (ДДВ-04, books) + posting schemes for all document kinds, bank parsers + matching; all golden-tested vs legacy. Root export clashes resolved in `index.ts` (namespaces `Stock`, `Posting`, `Vat`, `Payroll`, `Yearend`, `Bank`, `BankParsers`, `Ledger`). Follow-ups: margin konto 6690 vs 6694 in fiscal `trgNoVat` (settle in Phase 7); `test/` dirs not typechecked (core tsconfig includes only `src`); `closeYearLines` exists in both ledger (stopgap 10% tax) and yearend (ДБ tax), unify in Phase 8. |
| 2026-10-08 | 5 VAT | merged (ff) | `vat_periods` + migration 0003; `/ddv` (ДДВ-04, corrections, close/reopen, inspector table, VAT accounts), `/ddvKnigi`, print views; closed-period posting lock (`vat-lock.ts`). TODO(merge): plug document tables (Phases 3/4/7) into `VatDocumentSource`, align `VAT_SOURCE_TYPES` with their sourceType names, merge `vat-context.ts` with Phase 3's posting context. Until then the ledger fallback misses 0%/export/exempt/non-deductible detail. |
| 2026-10-08 | 8 Year-end | merged | Fixed assets + depreciation, year close/open/lock via the year-end engine (one implementation; stopgap 10% close removed), AOP statements, ДБ/ДБ-ВП, forms 38/35, ЦРСМ XML export/import, findings gate, NPO + sole trader, print views. Migration regenerated as 0004_yearend. TODO(merge): payroll head counts (bu257), gate inputs from bank/stock/invoices/pending docs. Gaps: zsDos, zsRok, AOP rule editor, sole-trader books, 0193 → bs015. |
