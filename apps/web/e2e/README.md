# End-to-end tests (Playwright)

Real-browser checks of the screens against a running dev server:

| File | What it proves |
|---|---|
| `nav-smoke.spec.ts` | Log in, create + open a firm, open every menu group and every submenu (flyouts must stay inside the window) and click through every item (~160 screens); fails on console / hydration errors, page errors, 5xx responses and the error boundary „Се појави грешка“. Firm editor: PNG upload to logo / signature / stamp and the file served back. |
| `safety.spec.ts` | Login is the first screen → year screen → firm list; two tabs of different firms: the stale tab shows „освежете ја страницата“ and its save is refused (nothing in the other firm); top-bar year change needs a confirmation and shows the „Работите во …“ strip; a new browser context has no session. |
| `smoke-all-views.spec.ts` | Every admin view opened by URL in a firm with data: time per view (fails over `E2E_MAX_MS`, default 2 s), console / hydration / page errors, failed requests, busy markers that never end — see „Smoke of every view“ below. |
| `flows.spec.ts` | Partner and item forms → invoice editor (18 % + 5 %) → print view → credit note → VAT book; bank statement (camt.053 XML) for a firm without a bank account → account opened → automatic booking review; opening balance from Excel in the editor → Бруто биланс totals. |

The amounts per konto of the same workflows are asserted by the vitest suites (no browser):
`packages/db/src/flows/*.test.ts`, `apps/web/test/flows/*.test.ts` (server actions on PGlite), `packages/legacy-import/test/workflow.test.ts`.

## Run locally

Everything is local: PGlite instead of Postgres, an in-memory S3 stand-in instead of SeaweedFS, the installed Chrome
(no browser download; `E2E_CHANNEL=msedge` for Edge).

1. `apps/web/.env.local` (never committed) — e.g.

   ```
   DATABASE_URL=postgres://postgres@127.0.0.1:54339/postgres
   DB_POOL=1
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<at least 10 characters>
   S3_ENDPOINT=http://127.0.0.1:9339
   S3_PUBLIC_URL=http://127.0.0.1:9339
   S3_ACCESS_KEY=test
   S3_SECRET_KEY=testtesttest
   S3_BUCKET=wise-docs
   ```

2. Three terminals:

   ```sh
   PGLITE_PORT=54339 pnpm --filter @wise/db dev-server          # database (data in packages/db/.pglite)
   node apps/web/e2e/mock-s3.mjs                                # uploads (MOCK_S3_PORT, default 9339)
   pnpm --filter @wise/web exec next dev -p 3107                # the app
   ```

   First time only, against the dev-server database:

   ```sh
   cd packages/db
   DATABASE_URL=postgres://postgres@127.0.0.1:54339/postgres pnpm migrate
   DATABASE_URL=postgres://postgres@127.0.0.1:54339/postgres ADMIN_USERNAME=admin ADMIN_PASSWORD=… pnpm seed
   ```

3. Run:

   ```sh
   pnpm --filter @wise/web e2e                                  # everything (~10 min; screens compile on first open)
   pnpm --filter @wise/web e2e e2e/flows.spec.ts                # one file
   E2E_GROUPS=Финанс,Мало pnpm --filter @wise/web e2e e2e/nav-smoke.spec.ts   # only these menu groups
   ```

   `E2E_BASE_URL` (default `http://localhost:3107`), `E2E_USER` / `E2E_PASSWORD` (default: `ADMIN_*` from `.env.local`),
   `E2E_HEADED=1` to watch.

Each run creates its own firms (names with a time stamp), so it can be repeated on the same database.

## Smoke of every view (speed + errors)

`smoke-all-views.spec.ts` opens every view of the admin menu (`lib/nav.ts`) by its URL in an existing firm with data and
fails on a console / page error, a React hydration warning, a failed or 5xx request, the error boundary, a busy marker
(`aria-busy`, „Се вчитува…“) that stays on screen, or a page slower than `E2E_MAX_MS` (default 2000 ms). The per-view
table (`ttfbMs`, `readyMs`, problems) goes to `test-results/smoke-all-views.json`.

Time it against the production build, not `next dev` (the dev server compiles every screen on its first open):

```sh
pnpm --filter @wise/web build
pnpm --filter @wise/web exec next start -p 3107                  # with the database of step 2 (with data in it)
E2E_FIRM="ДЕМО ТРГОВИЈА ДООЕЛ" pnpm --filter @wise/web e2e e2e/smoke-all-views.spec.ts
E2E_VIEWS=banka,nalozi,izlez pnpm --filter @wise/web e2e e2e/smoke-all-views.spec.ts   # only these view ids
```

`E2E_FIRM` (default: the first firm of the picker), `E2E_YEAR`, `E2E_MAX_MS`, `E2E_VIEWS`, `E2E_SKIP`. Data for it: the
demo seed (`seedDemo` in `packages/db/src/demo/seed.ts`); for realistic volume add a few thousand documents to one firm.
On the PGlite dev database the home page (`/`) can fail with „unnamed prepared statement does not exist“ (its many
parallel queries, see the note below) — that is the dev database, not the app.

## Notes

- Run one Playwright process at a time. The PGlite dev server is a single Postgres session behind a socket; under
  concurrent load it can still mix up the unnamed statements of overlapping queries („bind message supplies 4 parameters,
  but prepared statement "" requires 2“). That is a limitation of the dev database only (production runs Postgres), but
  it shows up as a failed screen in the smoke test — re-run before chasing it.
- Pages are filled only after hydration (`waitForLoadState('networkidle')` before choosing files): a file chosen before
  React attaches `onChange` is ignored by the browser page.
