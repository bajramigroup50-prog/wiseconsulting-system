# Brief for parallel phase agents

You are one of several agents building phases of the WISE CONSULTING rebuild at the same time. Each agent works in its own git worktree. A coordinator merges the branches into `main` one at a time.

## 0. Setup (do this first)
- Your worktree may have been created from an old commit. Run `git merge --ff-only main` first. If that fails because you have no commits yet, run `git reset --hard main`. Then `pnpm install`.
- Read `README.md` (conventions), `docs/ROADMAP.md`, `docs/PLAN.md`, your phase's section in `docs/LEGACY-MAP.md`, and the "Cross-cutting machinery" section there.

## 1. What already exists — use it, don't rebuild it
- **Pure domain logic** in `packages/core` is golden-tested against legacy. Import from `@wise/core` or from subpaths like `@wise/core/posting`.
  - `posting.ts`: journal lines for every document kind: `invoiceEntries`, `purchaseEntries`, `bankEntries`, `saleEntries`, `fiskEntries`, `blgEntries`, `scrEntries`, `kompEntries`, `vatCloseEntries`.
  - `vat.ts`: `ddvFor`, `ddv04`, the VAT books, `calcLines`.
  - `payroll.ts`: `empCalc`, `payrollEntries2`, `mpinTxt`, and more.
  - `stock.ts`: average cost, landed costs, FIFO/LIFO, levelling, transfers.
  - `bank-parsers.ts` and `bank-match.ts`.
  - `yearend.ts`.
  - `ledger.ts`: trial balance, account cards, numbering.

  If a ported function is wrong or missing something, fix or extend it in place, with a test. Do not write a second version.
- **Posting service** (`@wise/db`): `postJournal(tx, {firmId, date, kind, sourceType, sourceId, lines, userId, ...})`, `updateJournal`, `unpostSource`, `deleteJournal`, `loadLedgerLines`, `effectiveChart`. Every document that affects the books must post through it, inside the same transaction as the document save and `audit()`. Re-posting the same `sourceType` + `sourceId` replaces the journal.
- **Guards and audit:** `requireCan(action, firmId)` from `apps/web/lib/auth.ts`, and `audit(tx, …)` from `@wise/db`.
- **UI:** keep the legacy markup and classes (`apps/web/app/legacy.css` and `legacy-injected.css`, which includes the print CSS `.pdfdoc`, `.kart` and so on). A page is `apps/web/app/(app)/<legacy-view-id>/page.tsx`, using view ids from `apps/web/lib/nav-data.ts`. Look at the Phase 2 pages (`partneri`, `nalozi`, `bilanc`) as examples.
- **Printing:** use HTML print views with the legacy print CSS plus the browser's print-to-PDF. Server-side PDF rendering comes later (Phase 9), so don't add Playwright or Chromium.

## 2. Ownership of shared infrastructure (avoid duplicates)
- **AI document reading:** Phase 3 owns it. That covers the Anthropic client, tiers, `ai_usage` logging, and the job + review UI, in `apps/worker/src/ai/` and `packages/db/src/schema/ai.ts`. Other phases must not build AI calls. Leave a clear `TODO(ai)` hook instead, and the coordinator wires it up after merging.
- **E-mail:** Phase 6 owns it. That covers the Nodemailer mailer in `apps/worker/src/mail/`, the `mail_log` schema and a `mail.send` job. Others leave a `TODO(mail)` hook.
- **File storage:** the existing MinIO upload service from Phase 1 (`apps/web/lib/storage.ts`, `upload.ts`, `files` and `file_links`).

## 3. Merge-friendliness rules
- **Schema:** create only `packages/db/src/schema/<your-module>.ts`, and append one export line to `schema/index.ts`.
- **Migrations:** run `pnpm --filter @wise/db generate` to get a migration for testing, and commit it. The coordinator will regenerate the migrations when merging, because parallel branches all create `0003_*`. Any custom SQL (triggers, functions) must ALSO be saved in `packages/db/src/schema/<your-module>.sql`, so it can be re-applied.
- **Shared index files:** in `packages/core/src/index.ts`, `schema/index.ts`, `apps/worker/src/jobs/index.ts`, and `package.json` dependency lists, only APPEND lines. Never reorder or reformat them.
- **Exports:** if a new export name in `packages/core` would clash with an existing one, give yours a module-specific name.
- **Package files:** don't edit root config, other phases' pages, or `pnpm-lock.yaml` by hand. `pnpm add` is fine.

## 4. Definition of done
- Every screen for your phase listed in LEGACY-MAP works against a real database. For local testing, run PGlite: `pnpm --filter @wise/db dev-server`. **Use a port no one else uses.** Pick 54330 + your phase number (Phase 3 → 54333, and so on); set it with the `PGLITE_PORT` environment variable.
- Every server action is guarded and audited. Documents post balanced journals through the posting service. Period locks are respected.
- Tests: unit tests for the new logic, plus DB tests on PGlite for the save → post → unpost flows.
- `pnpm typecheck && pnpm test && pnpm build` pass.
- Fix the "bugs to fix deliberately" for your phase, each with a `FIX` comment.
- Commit in logical commits on your branch. End every commit message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push, and do not merge into main.
- Work autonomously to completion. Make sensible decisions and document them; don't stop to ask.
- **Final reply:** branch name, commits, what was built (screens and tables), test counts, deliberate fixes, `TODO(ai)`/`TODO(mail)` hooks left for the coordinator, and known gaps.
