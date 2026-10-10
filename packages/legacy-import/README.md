# @wise/legacy-import

Brings the data of the old single-file program (`legacy/index.html`, a claude.ai artifact whose data lives in the
artifact's shared document store `S.db`) into the server.

- **Admin UI:** Систем › 📥 Увоз од старата програма (`/uvozStara`, admin only — `users` permission).
- **Job:** `legacy.import` (`apps/worker/src/jobs/legacy-import.ts`) — reads the uploaded files, runs `importBundle`.
- **Code:** `src/format.ts` (formats, parser), `src/zip.ts`, `src/ledger.ts` (legacy ledger port), `src/map.ts` (pure
  mapping legacy → table rows), `src/writer.ts` (database writer), tests in `test/` on synthetic backups.

## 1. What the legacy program stores

`S.db` is a Firestore-like store. Per firm: the firm record `firms/{fid}` and 14 collections `firms/{fid}/{col}`
(`COLS`, index.html 3200):

`codes, employees, partners, items, invoices, purchases, bank, sales, journal, payroll, moves, production, assets, docs`

`docs` is polymorphic by `type` (`blg, komp, supcr, pp, nivel, prenos, mout, proforma, dispatch, arch, inbox, recur,
kdog, hr, pdd, loan, hroom, hres, appt, cproj, csit, cdiary, tarr, tbook, rres, frt, …`). Office-wide documents live in
global collections (`appusers`, `appaudit`, `appsettings/*`, `settings/pay`, `office_*`, `pnal`, `apptpl`, …).
Every record is plain JSON with a string `id` (`Date.now().toString(36) + random`). Attached files (scans, PDFs,
photos) are stored separately with `claude.use('assets')` and referenced as `{id, name, type, size}` in `files[]` /
`photos[]` / `scans[]` arrays or as `/_blob/<id>` strings; firm logo / signature / stamp are data-URLs or `/_blob/` links.

## 2. Backup file formats

All formats are JSON, UTF-8.

### 2.1 Daily backup of all firms — `bkp-v1` (the main source)

`bkpRun` (index.html 8979, "💾 Направи копија сега (сите фирми)", also automatic once a day) writes **one file per
firm** to the asset store:

```json
{ "v": 1, "at": "2026-10-01T08:00:00.000Z",
  "firm": { "id": "…", "name": "…", "edb": "…", "ddv": true, "per": "quarter", "lock": "2026-03-31",
            "banks": [...], "blg": [...], "sch": {...}, "accounts": {...}, "izv": {...}, … },
  "data": { "codes": [...], "employees": [...], "partners": [...], "items": [...], "invoices": [...],
            "purchases": [...], "bank": [...], "sales": [...], "journal": [...], "payroll": [...],
            "moves": [...], "production": [...], "assets": [...], "docs": [...] } }
```

`firm` is the full firm record **without** `logo`, `sign`, `stamp`. An index document `backups/bk-YYYYMMDDHHMMSS`
lists the files (`files[{fid, name, asset, url, size, counts}]`) and carries the office settings
`glob: {'appsettings/schemes', 'appsettings/fx', 'settings/pay'}`; the last 30 backups are kept.

"⬇ Последната копија (ZIP)" (`bkZip`, 9013) downloads the newest backup as `Rezervna_kopija_site_firmi_<date>.zip`: a
plain *stored* ZIP (no compression) with one `<firm name>_<fid>.json` per firm in exactly the shape above. The ZIP does
not contain the index document, so the office settings are not in it.

### 2.2 One firm — `firm-json`

"⬇ Само оваа фирма (JSON)" (`backupJson`, 5060) → `Rezervna_kopija_<firm>_<date>.json`:

```json
{ "firm": { …the full record, including logo / sign / stamp… }, "exported": "ISO time", "data": { <14 collections> } }
```

This is the only file that carries the firm's logo, signature and stamp (data-URLs are imported into the object store).

### 2.3 Optional: full export — `full-export`

No legacy backup contains users, the audit log, office-wide data or the attached files (LEGACY-MAP 11.1). The importer
also accepts one JSON with everything the artifact can read, should the legacy program ever be republished with an
"export everything" button:

```json
{ "kind": "wise-legacy-export", "v": 1, "at": "ISO",
  "users": [ <appusers docs, without pw0> ], "settings": { "appsettings/schemes": {...}, "appsettings/fx": {...},
  "settings/pay": {...}, "appsettings/office": {...} }, "firms": [ { "firm": {...}, "data": {...} } ] }
```

Snippet for that button (runs inside the legacy program, uses its own `S` and `bkpLoadFirm`):

```js
async function exportAll(){const users=(await S.db.collection('appusers').get()).docs.map(d=>{const {pw0,...u}=d.data();return u});
 const settings={};for(const p of ['appsettings/schemes','appsettings/fx','settings/pay','appsettings/office']){const d=await S.db.doc(p).get();if(d.exists)settings[p]=d.data()}
 const firms=[];for(const f of S.firms)firms.push({firm:f,data:await bkpLoadFirm(f)});
 await S.downloads.save({filename:'Wise_celosen_izvoz.json',data:new Blob([JSON.stringify({kind:'wise-legacy-export',v:1,at:new Date().toISOString(),users,settings,firms})],{type:'application/json'})})}
```

The backup index document (`{files, glob}`) is accepted as well, for its settings only.

### 2.4 Parsing rules

- A ZIP is read entry by entry (stored or deflated; Windows re-zipped archives work); JSON files at any level.
- Several files may be uploaded at once. A firm (by legacy id) found in several files is imported from the **newest**
  copy (`at` / `exported`); missing logo/sign/stamp are taken from an older per-firm export.
- Records without `id` are dropped, duplicate ids keep the first; unknown collections are reported.

## 3. What maps where

One transaction per firm; every record goes through `legacy_id_map` (firm, kind, legacy id → new id), so a re-import
updates in place and never duplicates. A firm is matched by `firms.legacy_id`, else by EDB (a firm created by hand).

| Legacy | Server |
|---|---|
| firm record | `firms` (code, name, `lf`→legal form, EDB, EMBS, address, city, e-mail, phone, activity, `ddv`, `per`, `lock`, `mods`); every other field in `firms.settings` (scheme `sch` with SCH_OLD values removed = effective values) |
| `firm.accounts` | `accounts` firm overrides (renamed / added / hidden) |
| `firm.banks`, `firm.blg` | `bank_accounts` (+ `settings.banks` for numbering), `cash_registers` |
| `firm.rules`, `firm.osnovK` | `bank_rules` |
| logo / sign / stamp (data-URL) | `files` + `file_links` (`firm`, logo/signature/stamp) |
| `codes` | `codes` (warehouses/stores = stock locations) |
| `partners` | `partners` (leaked `rate/konto/type` dropped; duplicate codes → imported without code) |
| `items` | `items`, `item_barcodes`, `boms` (from `bom[]` + `labor`) |
| `employees` | `employees` (contract `ct`, files etc. in `data`) |
| `invoices`, docs `proforma` / `dispatch` | `invoices` + `invoice_lines` + `invoice_advances`, credit → `ref_invoice_id`; `pend` → status `pending` |
| `purchases` | `purchases` + `purchase_vat_groups` + `purchase_stock_lines` + `purchase_costs` |
| docs `supcr` | `supplier_credits` + lines |
| `bank` | `bank_statements` (one per account + date, number / balances / totals from `firm.izv*`) + `bank_lines` |
| docs `blg` | `cash_vouchers` |
| docs `komp`, `pp` | `compensations`, `payment_orders` |
| `sales` | `sales_daily` |
| `payroll` (v2) | `payroll_runs` + `payroll_emp` + `payroll_lines` |
| `production` | `production_orders` |
| docs `nivel`, `prenos`, `mout` (pop/otp) | `levelling_docs`, `transfers`, `stock_counts` |
| `moves` | `stock_moves` (owner document resolved from `src`: `pur-`, `inv-`, `isp-`, `scr-`, `prn-`, `mo-`, `prod-`/`rn-`, `z-`; others `legacy`) |
| `assets` | `fixed_assets` (+ `fleet_vehicles` when the asset has a plate) |
| `journal` | `journals` / `journal_lines` through the posting service; `open-Y` → opening, `close-Y` → year close (+ `year_closings`), `amort` → depreciation (+ `depreciation_runs`), `ddv-…` → VAT close (+ `vat_periods`, closed), `bbimp-Y` → imported trial balance |
| docs `arch` (dossier), `inbox`, `recur`, `kdog`, `hr` | `dossier_docs`, `inbox_items`, `recurring_invoices`, `service_contracts`, `hr_docs` |
| docs `hroom`, `hres`, `appt`, `cproj`, `csit`, `cdiary`, `tarr`, `tbook`, `rres`, `frt` | hotel rooms / reservations, appointments, construction projects / situations / diary, travel arrangements / bookings, rent-a-car rentals, freight tours |
| any other `docs` type, or a record its table rejects | `firm_docs` (type, number, date, full JSON) — listed in the report |
| `appusers` (full export only) | `users` (legacy `p2$…` / sha256 hash + salt kept → re-hashed with argon2 at first login; `pw0` never imported) + `user_firms` |
| `appsettings/schemes`, `/office`, `/fx`, `settings/pay` | `app_settings` `schemes` / `office` / `legacy:settings/pay` (only when not set on the server), `fx_rates` |

### Journals and the trial-balance check

Legacy never stored its ledger; `src/ledger.ts` ports `ledger()` (3448 + wrappers 12429, 17424): stored `lines` of
invoices / purchases / Z reports / payroll / moves / journals, live postings of bank lines (`bankEntries`), cash vouchers
(`blgEntries`), supplier credits (`scrEntries`), compensations (`kompEntries`), ПДД and levelling; correction overlays
`ed` / `edAdd`, red storno for credit notes (`crMode`), off-balance VAT-base lines (994/999), side flips and extra lines
of the office scheme (when the bundle carries it), the 12x/22x partner fix; `pend` documents are skipped. Each source
becomes one journal through `postJournal` (same `source_type` the modules use: `invoice`, `purchase`, `bank_statement`,
`cash_voucher`, `supplier_credit`, `compensation`, `sales_daily`, `payroll`, `levelling`, `stock:<type>`, `vatPeriod`, …)
so the module screens find them. Accounts missing from the chart are added to the firm's chart. Lock date and closed
VAT periods are applied after posting. The report compares turnover per account: legacy ledger vs imported journals.

## 4. Not imported (no target table yet, or not in any legacy backup)

Stored as `firm_docs` (no own table yet): `loan`, `paynote`, `maillog`, `mpinack`, `akcija` (promotions), `rasnorm`,
`cveh` / `wo` (auto service), `ord` / `po` (orders), `lcard` / `coupon` (loyalty), `mout` sale/inv/ret, `pdd` (its journal
is posted), plain `arch` archive items, `rtable` / `rord` / `frdoc` / `frfuel` / `frcfg` (by design in `firm_docs`).
Kept in `firms.settings` / `employees.data` only: `firm.payNotes` (→ `payroll_notes`), `firm.contacts` (→ `firm_contacts`),
employee `ct` (→ `hr_contracts`), item supplier codes. Dropped: `outscan` (transient scan queue).

Not in any legacy backup: users (unless full export), `appaudit`, `appinbox`, `applaw`, `appmpin`, `appaml`, `apptpl`
(Word templates), `apperrors`, `office_tasks`, `office_tpl`, `office_newco`, `office_apsent`, `pnal` (travel orders),
`appsettings/tpl|doccodes|kdogNo|notice|bankfmt|owner`, and **all attached files** (`/_blob/` assets — the report counts
them per firm).

## 5. Steps in the legacy program

1. Log in as administrator, Систем › **Податоци и резервна копија**.
2. Click **💾 Направи копија сега (сите фирми)** and wait for "Копијата е направена: N фирми".
3. Click **⬇ Последната копија (ZIP)** and save `Rezervna_kopija_site_firmi_<date>.zip`. The server accepts files up to
   100 MB each; for a larger ZIP, unzip it and upload its JSON files in several batches.
4. Optional, per firm with a logo / signature / stamp: open the firm, Систем › Податоци и резервна копија →
   **⬇ Само оваа фирма (JSON)**.
5. On the server: Систем › **📥 Увоз од старата програма** → upload the files → **Започни увоз**; check the report
   (бруто биланс ✓ per firm, skipped records with reasons). Re-run any time with a newer backup.
