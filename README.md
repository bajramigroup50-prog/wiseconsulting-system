# WISE CONSULTING — Accounting System

Bookkeeping and accounting-office system for North Macedonia (multi-firm ledger, VAT/ДДВ-04, payroll/MPIN, stock & retail, bank statements, year-end AOP statements, office/dossier tools).

## Repository layout

| Path | What |
|---|---|
| `legacy/` | The original single-file app (`index.html`) built as a claude.ai artifact, plus Tesseract OCR language data (`ocr/eng.js`, `ocr/mkd.js`). Kept as the functional reference during the rebuild. |

## Rebuild (in progress)

The system is being re-implemented as:

- **Next.js** (App Router, TypeScript) — web UI and server actions
- **PostgreSQL** + Drizzle ORM — relational data with a persisted double-entry ledger
- **SeaweedFS** (S3 API) — object storage for documents and images (MinIO images are no longer published)
- **pg-boss** worker — AI document reading, OCR, PDFs, e-mail, scheduled jobs
- **Docker Compose** on a VPS (app, worker, postgres, s3, caddy)

Structure (pnpm workspaces + Turborepo):

```
apps/web                Next.js app (UI, server actions, route handlers)
apps/worker             pg-boss job runner — jobs registered in src/jobs/index.ts
packages/core           pure domain logic (RBAC now; posting, VAT, payroll, stock, AOP next)
packages/db             Drizzle schema (src/schema/<module>.ts), migrations, seed, password hashing
packages/legacy-import  migration from legacy backups (later phase)
docker/                 Dockerfile, compose.yml, Caddyfile, .env.example, backup.sh
```

The domain logic is ported from `legacy/index.html` and verified with golden tests against the legacy functions.
Progress and phase plan: [docs/ROADMAP.md](docs/ROADMAP.md).

### Local development (no Docker needed)

```bash
pnpm install
pnpm --filter @wise/db dev-server        # PGlite on 127.0.0.1:54329 (leave running)
```

Create `apps/web/.env.local` (gitignored) with `DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres`, `DB_POOL=1`,
`ADMIN_USERNAME` and `ADMIN_PASSWORD`, then load it in your shell and run `pnpm db:migrate`, `pnpm db:seed` and `pnpm --filter @wise/web dev`.
Uploads need an S3-compatible endpoint (`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`).

Checks: `pnpm typecheck`, `pnpm test`, `pnpm build`.

### Conventions for new modules

- **UI** keeps the legacy look: `apps/web/app/legacy.css` and `legacy-injected.css` are copied verbatim from the old app — reuse its markup and class names, don't restyle.
- **Routes**: every legacy menu item already appears in the nav (`apps/web/lib/nav-data.ts`, copied from legacy `NAV`). Unported items fall through to a "во изработка" page; porting a module = adding `apps/web/app/(app)/<view-id>/page.tsx` with the legacy view id. No shared nav file needs editing.
- **Guard** every server action / route handler with `requireCan(action, firmId)` (legacy `ACT_NEED` names work) and write `audit(tx, …)` in the same transaction as the change.
- **Schema**: add `packages/db/src/schema/<module>.ts` + one export line in `schema/index.ts`; money is `numeric(18,2)`.
- **Jobs**: add `apps/worker/src/jobs/<job>.ts` + one line in `jobs/index.ts`.
- **Ledger**: never write `journals` / `journal_lines` directly — compute the lines and call `postJournal(tx, {firmId, date, kind, sourceType, sourceId, lines, userId})` from `@wise/db` inside the document's transaction (`unpostSource` when the document is deleted). It checks balance, lock date, chart and partners, numbers the nalog and writes the audit row.

### Deploy

See `docker/compose.yml` (header comment) and `docker/.env.example`. The system starts empty (no firms, no sample data). The seed creates only the administrator from `ADMIN_USERNAME` (default `1`) and `ADMIN_PASSWORD` in `.env`; set `ADMIN_MUST_CHANGE_PASSWORD=1` to force a change at first login.
