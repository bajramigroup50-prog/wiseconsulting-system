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
- **MinIO** — S3-compatible storage for documents and images
- **pg-boss** worker — AI document reading, OCR, PDFs, e-mail, scheduled jobs
- **Docker Compose** on a VPS (app, worker, postgres, minio, caddy)

Planned structure:

```
apps/web                Next.js app
apps/worker             background jobs
packages/core           pure domain logic (posting, VAT, payroll, stock, AOP)
packages/db             Drizzle schema, migrations, seed data
packages/legacy-import  migration from legacy backups
docker/                 compose, Caddyfile, .env.example
```

The domain logic is ported from `legacy/index.html` and verified with golden tests against the legacy functions.
