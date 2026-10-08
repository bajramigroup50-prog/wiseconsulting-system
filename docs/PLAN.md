# WISE CONSULTING: push to GitHub, then rebuild on Next.js + PostgreSQL + MinIO

## Context
The current app is a single 4.5 MB, 17,491-line `index.html` plus two OCR language-data files: `ocr/eng.js` and `ocr/mkd.js`. Each is base64/gzip Tesseract traineddata. Claude chat built it as a claude.ai artifact.

It is a full accounting system for an accounting office in North Macedonia. It handles 400+ client firms and covers:
- invoices, purchases with landed costs, and bank statements (MT940, camt.053, Halk, KB)
- the general ledger and journals, VAT (ДДВ-04 and the VAT books), payroll and MPIN, stock and retail (МЕТГ, КДФИ, levelling)
- POS and fiscal reports, fixed assets, and year-end (AOP statements, ДБ, ЦРСМ XML)
- the office side: the firm dossier, tasks, company formation, contracts, AML, GDPR, payment orders and autopilot checks
- industry modules: hotel, rent-a-car, travel, transport, construction, restaurant and production

**Where it runs today.** Everything depends on the claude.ai artifact runtime:
- `claude.use('db')` is a Firestore-like document store: `firms/{fid}/{14 collections}` plus about 20 `app*` collections.
- `'assets'` stores files, served at `/_blob/<id>`.
- `'sample'` makes the AI calls that read documents (quick/default/complex tiers).
- `'mcp'` sends Gmail; `'downloads'` saves files to the user's machine.

**Code shape.** The code has grown through v3xx–v5xx monkey-patches: functions are wrapped or redeclared, for example `importOpen`, `dbData`, `zsCompute`, `save` and `render`. Each feature's real behaviour is therefore a chain of patches. Rate constants are also inconsistent: `empCalc` uses PIO 18.8%, while `PAY_DEF` uses 19.9%.

**Goal.** Preserve the original in a public GitHub repo. Then rebuild it as a maintainable, multi-user (RBAC) Next.js app on the user's VPS:
- PostgreSQL for data
- MinIO for documents and images (200 GB available)
- Docker Compose for deployment; the user will send the VPS details

---

## Step 1: Push the current app to GitHub (do first)
- **Git.** It is installed at `C:\Program Files\Git\cmd\git.exe`, but this shell's PATH is stale. Call git by its full path, or prepend it to `$env:Path` for the session.
- **GitHub CLI.** `gh` is not installed. Run `winget install GitHub.cli`, then the user runs `gh auth login` themselves; I never type credentials. Fallback: the user creates an empty public repo `wiseconsulting-system` on github.com and gives me the URL.
- **Repo layout:**
  - Move the original files into `legacy/` (`legacy/index.html`, `legacy/ocr/*.js`) so the new app can live at the root.
  - Add a `README.md` covering what it is, the legacy status and the rebuild plan.
  - Add a `.gitignore` for Node, Next.js and `.env*`.
- **Commands:** `git init -b main` → `git add` → commit "Import legacy single-file app" → `gh repo create wiseconsulting-system --public --source . --push`.
- **Public-repo notice.** The repo is public. The code holds no secrets or API keys. It contains only example personal IDs (ЕМБГ) and one real-looking firm tax number: `MPIN_SAMPLE.edb = 4082015515270` at legacy line 6120, probably the office's own firm. I'll point this out before pushing. Large files (4.5 MB and 3.9 MB) are fine under GitHub's 100 MB limit.

---

## Step 2: Target architecture

| Concern | Choice |
|---|---|
| App | Next.js 15 (App Router), TypeScript, Server Actions plus Route Handlers for uploads and webhooks |
| UI | **Same style/design as legacy (user requirement).** Port the legacy stylesheet (`legacy/index.html` lines 5–276 plus `PDF_CSS`) verbatim into `globals.css`: same tokens, classes (`.mbar`, `.mg`, `.dd`, `.card`, `.tile`, `.pill`, `.btn`, `.form`, `.ftabs`, `.dash-*`), top-bar dropdown nav from `NAV`, firm bar, fonts and dark mode. React components render the same markup and class names. No shadcn/Tailwind restyle. Keep the F-key shortcuts and the print/PDF layouts |
| DB | PostgreSQL 17 with Drizzle ORM and drizzle-kit migrations. `numeric(18,2)` for money, never float |
| Files | MinIO via the S3 SDK. Bucket `wise-docs`, keys `firms/{firmId}/{yyyy}/{uuid}.{ext}`. Uploads and downloads use presigned URLs; a sha256 hash catches duplicates |
| Auth/RBAC | Better-Auth (or Auth.js credentials) with argon2 password hashes. Roles come from the legacy `RP`/`ACT_NEED` model: admin, senior, acc, oper, teren, view, klient. Access is set per firm (`user_firms`) and enforced in one `can(user, action, firmId)` guard used by every server action. Client-role entries are saved as `pending` until the office approves them |
| Jobs | pg-boss, a queue that lives in Postgres. It runs AI document reading, OCR, recurring invoices, autopilot every 6 h, nightly backups, e-mail sending and law-robot ingestion |
| AI | The Anthropic SDK replaces `S.sample`. quick → `claude-haiku-5-5`, default → `claude-sonnet-5-5`, complex → `claude-opus-5-5`. Prompts are ported verbatim (`PUR_PROMPT`, `SALE_PROMPT`, `BLG_PROMPT`, `EMP_PROMPT`, `IMP_PROMPT`, `REC_PROMPT`, `MPIN_ASK`, etc.). Cost is logged per firm, which replaces `/api/ai/cost` |
| OCR | Fallback only. tesseract.js runs in a Node worker job, using plain `.traineddata` files in MinIO or on disk instead of the base64 JS |
| PDF | Server-side Playwright/Chromium renders HTML templates, replacing html2pdf. pdf-lib splits and merges; `docx` builds Word files; SheetJS (xlsx) handles Excel |
| Email | Nodemailer over SMTP (or the Gmail API) replaces the Gmail MCP. Every message is logged (`maillog`) |
| Audit | `audit_log` table, written in the same transaction as each mutation |
| Deploy | Docker Compose: `app`, `worker`, `postgres`, `minio`, `caddy` (automatic TLS). Volumes for pg and minio data; `pg_dump` plus `mc mirror` backups |

**Repo structure (after `legacy/`)**
```
apps/web            Next.js app (UI, server actions, route handlers)
apps/worker         pg-boss job runner (AI, OCR, PDF, mail, cron)
packages/core       pure TS domain logic: posting, VAT, payroll, stock, AOP; no I/O
packages/db         Drizzle schema, migrations, seed (chart of accounts, AOP rules, code lists)
packages/legacy-import  importer for legacy backup JSON → Postgres + MinIO
docker/             compose.yml, Caddyfile, .env.example
```
pnpm workspaces plus Turborepo.

---

## Step 3: Data model (Postgres)
The main change is a **persisted double-entry ledger**. Legacy rebuilds the ledger from each document's `lines` every time. The new app writes journal rows when a document is posted.

- **Tenancy:** `firms` holds the legacy firm record. Common fields are columns; settings blobs (`sch`, `nalCodes`, `zsMan`, `insp`, `kl`, etc.) go into `settings jsonb`. Every per-firm table has a `firm_id` foreign key and is indexed on `(firm_id, date)`.
- **Masters:** `partners`, `items` (with `item_barcodes`, `item_supplier_codes`), `employees`, `assets`, `codes` (warehouses, stores, vehicles, currencies), `accounts` (chart of accounts plus per-firm overrides).
- **Documents:**
  - Sales: `invoices` and `invoice_lines`.
  - Purchases: `purchases`, `purchase_vat_groups`, `purchase_stock_lines`, `purchase_costs`.
  - Bank: `bank_statements` and `bank_lines`, with `bank_rules`.
  - Retail: `sales_daily` (Z reports).
  - Payroll: `payroll_runs`, `payroll_emp`, `payroll_lines`.
  - Other: `cash_vouchers` (blg), `stock_moves`, `production_orders`, `boms`.
- **Ledger:**
  - `journals`: id, firm, date, kind, number, source_type, source_id, locked.
  - `journal_lines`: account, partner_id, debit, credit, cur, amt_cur, note.
  - A deferred constraint trigger ensures debit equals credit for each journal.
- **Polymorphic legacy `docs.type`** (hotel, rent-a-car, travel, construction, loans, AML, contracts, …): one `firm_docs` table (type, number, date, `data jsonb`, status). Modules move to their own tables later, only when they need it.
- **Files:** `files` (id, firm_id, bucket_key, name, mime, size, sha256, uploaded_by) plus `file_links` (entity_type, entity_id, role). This replaces the scattered `files[]` arrays and `/_blob/` URLs.
- **Global:** `users`, `user_firms`, `roles_permissions`, `app_settings` (schemes, fx rates, office, tpl, doccodes), `fx_rates`, `audit_log`, `mail_log`, `inbox`, `law_updates`, `ai_usage`, `errors`.
- **Period locks:** `firms.lock_date` and VAT-closed periods, enforced in the posting service rather than only in the UI.

---

## Step 4: Port the domain logic (`packages/core`)
Extract the pure logic from legacy into typed, unit-tested modules. Take the *final* patched version of each function.

| Module | Legacy source |
|---|---|
| `vat.ts` | rates, accounts and validation: `VAT_IN`/`VAT_OUT`/`VAT_IMP`/`VAT_BAD`, `ddvFor`, `ddv04`, VAT books, travel-margin VAT, Art. 32-a |
| `posting.ts` | `SCH0` schemes plus `invoiceEntries`, `purchaseEntries`, `bankEntries`, `saleEntries`, `blgEntries`, `fiskEntries` (`FK_SC`), `kompEntries`, `scrEntries` |
| `payroll.ts` | `grossFromNet`, `empCalc`, `payrollEntries2`, `PAY_DEF` 2026, `PSIF0`, `mkHolidays`/`orthEaster`/`BAJRAM`, MPIN TXT (`mpinTxt`, cp1251) |
| `stock.ts` | weighted average cost (`stock`, `postOut`, `reaverage`), landed-cost allocation (`allocAuto`), FIFO/LIFO for fiscal reports (`fkAlloc`) |
| `ledger.ts` | trial balance (`bbRows`), cards, `closeYear`/`openYear`, journal numbering (`nalogMap`, `NAL_DEF`) |
| `yearend.ts` | `ZS_DEF` AOP engine (`zsCompute`), `DB_F`, ДБ-ВП, `DE38`, `crmXml`, `crmRules`, NPO and sole-trader variants |
| `bank-parsers.ts` | `parseMT940`, `parseBankXml`, `parseKB`, `autoMatch`, `bmRun` (subset-sum matching) |
| `misc` | `ublXml` e-invoice, `ppIban` (mod-97), `mkWords`, interest, depreciation (`depFor`), AML risk |

Reference data (`KONTO_SRC` with about 2,858 accounts, `ZS_DEF`, `NKD21`, `FX_DEF`, `CB`, MPIN code lists, `FORMS0`, plus `FORM_BG` images moved into MinIO) becomes seed data or JSON in `packages/db/seed`.

**Golden tests.** A Vitest harness loads `legacy/index.html` scripts into Node `vm`/jsdom with a stubbed `claude.use`. It runs legacy and new functions on the same fixtures (invoices, payroll month, VAT period, AOP). Outputs must match before a module counts as ported. Fix the known inconsistencies on purpose and document them: PIO fallback, 8100/2330 vs 2340, 951/961 vs 9500/9600.

---

## Step 5: Build phases (each one deployable)
1. **Foundation:** monorepo, Docker Compose, Drizzle schema v1, auth and RBAC, firm picker (400+ firms), layout/nav from `NAV`, audit log, MinIO upload service, user and role admin.
2. **Core books:** partners, items, chart of accounts, journals (manual entry, numbering, locks), trial balance, cards, opening balance (manual and Excel).
3. **Sales and purchases:**
   - Invoice editor and print templates, credit notes, proforma and dispatch notes.
   - Purchase editor with landed costs.
   - AI document reading as a job with review UI (batch "masovno"), duplicate detection.
   - UBL import and export.
4. **Bank and cash:** statement import (all formats), auto-match and rules, FX differences, cash register with receipt scanning.
5. **VAT:** ДДВ-04, VAT books, posting and closing the period, PDF form.
6. **Payroll and HR:** employees, payroll runs, payslips (PDF and e-mail), MPIN TXT and XLSX, payment orders, contracts and HR registry.
7. **Stock and retail:** moves, stock lists, ЕТ/ЕТМ/МЕТГ, levelling, transfers, POS and fiscal reports (КДФИ, DFI control), production and BOM.
8. **Year-end:** depreciation, close and open year, AOP statements, ДБ, ЦРСМ XML export and import, phase gate (`zcFindings`).
9. **Office:** dossier, inbox and client portal (klient role), tasks, Word templates, packages and ZIP, reminders, recurring invoices, autopilot, inspection readiness, AML, GDPR, formation.
10. **Industry modules:** hotel, rent-a-car, travel, transport, construction, restaurant, appointments. Each is behind a per-firm `mods` toggle.

---

## Step 6: Migrate legacy data
- **Export from the claude.ai app.** Use the existing per-firm `backupJson` and the `backups` collection. If those miss global collections, add a small "export everything" button to the legacy artifact that dumps all `app*` collections.
- **`packages/legacy-import` CLI:**
  1. Map each collection to its tables.
  2. Download each `/_blob/<id>` asset and re-upload it to MinIO, rewriting references into `files`/`file_links`.
  3. Recompute `journal_lines` from each document's `lines`.
  4. Verify that each firm's trial balance matches the legacy figure, account by account.
- **Users.** The legacy PBKDF2 hashes (`p2$`, 150k iterations, salt `wc|`) are accepted at first login, then re-hashed with argon2.

---

## Step 7: Deploy to the VPS (once the user sends SSH details)
- Install Docker and the compose plugin on the VPS and create a non-root deploy user.
- Clone the repo and fill `/opt/wise/.env` from `.env.example`. It holds DB, MinIO and Anthropic keys, SMTP settings and the domain. The user enters the secrets in the file themselves; I don't type them.
- Bring the stack up with `docker compose up -d`. Caddy gets TLS for the domain. Postgres and MinIO are not exposed publicly; the MinIO console is reachable only through an SSH tunnel.
- Nightly cron: `pg_dump` plus a MinIO mirror to a separate backup location, kept 30 days (same retention as the legacy backups).
- Optional CI: GitHub Actions builds the image and deploys over SSH.

---

## Verification
- **Step 1:** `git log` shows the commit; `gh repo view wiseconsulting-system --web` shows the public repo with `legacy/` and the README.
- **Domain:** Vitest golden tests compare against legacy outputs for posting, VAT-04, payroll and MPIN TXT, average cost, AOP and the bank parsers.
- **App:** Playwright e2e covers login per role (klient can't post; view is read-only), create invoice → journal balanced → shows in the VAT return, upload PDF → MinIO object plus AI draft → save, and lock period → edits blocked.
- **Migration:** import one real firm backup and check that its trial balance and VAT-04 match the legacy app.
- **Deploy:** the HTTPS health endpoint works, an upload lands in MinIO, a backup job runs, and a restore works on a scratch DB.
