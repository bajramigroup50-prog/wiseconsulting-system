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
- [ ] **2. Core books** — partners, items, chart of accounts (KONTO_SRC seed), journals (manual entry, numbering, locks), trial balance, account cards, opening balance (manual + Excel).
- [ ] **3. Sales & purchases** — invoice editor + print templates, credit notes, proforma, dispatch; purchases with landed costs; AI document reading job + review UI (batch), duplicate detection; UBL import/export.
- [ ] **4. Bank & cash** — statement import (MT940, camt.053, Halk, KB), auto-match & rules, FX differences, cash register (blg) with receipt scanning.
- [ ] **5. VAT** — ДДВ-04, VAT books, posting & period close, PDF form.
- [ ] **6. Payroll & HR** — employees, payroll runs, payslips (PDF + e-mail), MPIN TXT/XLSX, payment orders, contracts, HR registry.
- [ ] **7. Stock & retail** — moves, stock lists, ЕТ/ЕТМ/МЕТГ, levelling, transfers, POS & fiscal reports (КДФИ, DFI control), production & BOM.
- [ ] **8. Year-end** — depreciation, close/open year, AOP statements, ДБ, ЦРСМ XML export/import, phase gate (`zcFindings`).
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
| 2026-10-08 | 1 Foundation | (this commit) | Built by session "New infrastructure setup". Gaps: Caddyfile serves DOMAIN + files.DOMAIN only (www still to add); MinIO image tags in compose.yml not verified; Cyrillic ILIKE needs C.UTF-8 initdb (PGlite dev is ASCII-only); abandoned-upload cleanup leaves orphan MinIO objects. |
