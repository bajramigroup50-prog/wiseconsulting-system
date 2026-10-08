# Year-end engine (`@wise/core` → `yearend.ts`)

Pure port of legacy Phase 8 (docs/LEGACY-MAP.md §8). Golden tests: `packages/core/test/golden/yearend/` load the
legacy functions into Node `vm` and compare on four fixtures (ДОО, ДООЕЛ, ТП, НПО). The port has a `legacy: true`
switch wherever it fixes behaviour; in that mode it must equal legacy exactly.

| Module | Legacy (final definition) |
|---|---|
| `balances.ts` | `balances` 3600, `sumPref` 3601 — fed from a trial balance instead of the computed ledger |
| `aop.ts` | `ZS_DEF` 7411, `ZS_FIX` 7618, `zsRules` 7619, `zsCompute` 7620 → 10940 → 17099, `statements` 3652 |
| `tax.ts` | `DB_F` 10748, `DB_MIG` 10828, `dbData` 10829, `dbEdb` 10843, `vpData` 17105 |
| `close.ts` | `closeYear` 6732, `openYear` 6744, `obResK`/`obResLines` 12386 |
| `depreciation.ts` | `depFor` 5861, `runDep` 7239, `DEP_PRESETS` 3183 |
| `npo.ts` | `NPO_*` 10412–10449, `npoMode` 10450, `npoCompute` 10451, `npoDb` 10460, `npoClose` 10486 |
| `soleTrader.ts` | `DLD_ND` 10496, `tpData` 10497 |
| `crm.ts` | `DE38`… `deVals` 10976–10990, `NKD35`… `f35Rows` 10992–10999, `crmRules` 11001, `crmXml` 11022, `crmXmlImport` 17027, `crmXClr` 17043 |
| `findings.ts` | `zcFindings` 11196 + wrapper 16884 (`izvYearEnd` 16882), `zcOpen` 11221 |

Reference data: `src/data/yearend-*.json` (zs-def, db-form, de38, npo, nkd, misc), checked against the legacy
constants by the golden tests.

## Result accounts — the one mapping

| Step | Debit / credit | Account (KONTO_SRC name) |
|---|---|---|
| close classes 4 and 7 | ↔ | **8000** Добивка пред оданочување |
| profit tax | 8100 → | **2330** Обврски за данок на добивка (not 2340 — that is personal income tax on salaries) |
| net result | 8200 → | **951** Добивка од тековната година / **961** Загуба за тековната година |
| carry forward to the next year | | 951 → **950** Задржана (акумулирана) добивка, 961 → **960** Пренесена загуба — always |

9500/9600 (named in the legacy "Пренос" help text) are firm-specific analytic sub-accounts ("…2018") and are not
used. ZS_DEF already reads this mapping (bs075 950, bs076 960, bs077 951, bs078 961). NPOs on the NPO chart keep
their statutory accounts 800/810/245/970/092 (Сл. весник 117/05); NPOs on the company chart use the table above.
Exported as `YEAR_RESULT_ACCOUNTS` / `NPO_RESULT_ACCOUNTS`; `closeYearLines`, `openYearLines`,
`carryForwardLines` use them. The ledger service should post `close-<Y>` / `open-<Y+1>` through these.

## Deliberate fixes

| Id | Legacy behaviour | Now |
|---|---|---|
| R1 | Result accounts 951/961 vs 950/960 vs 9500/9600; tax 2330 vs 2340; carry-forward remap skipped when the UI flag `S.obFull` was on | One mapping (above); `carryForwardAccount` is unconditional |
| R2 | `closeYear` tax = ДБ AOP 56 only when `dbAdj[Y]` had entries, otherwise `r2(10%)` with cents | `closeYearLines(pre, tax)` is given the ДБ tax (`computeDb(...).tax`, whole denars) |
| F1 | bu252 = 0 until the year is closed, so bu255 / bs077 showed pre-tax profit and the ДБ check "bu252 = ДБ 56" failed | `computeAnnualAccount` puts the ДБ tax in bu252 before close and the same amount in bs101 (current tax liabilities), so A = P; the open-year figures equal the closed-year figures |
| F2 | With 1–20 `zsMan` amounts, the rounding pass recomputed formula rows and overwrote manual totals | Manual keys are never recomputed or used for the A/P rounding |
| F3 | bs077/bs078 rounded from the unrounded bu255/256 (could break ЦРМ rule 2024 `077<=255`); the ±3 A/P rounding could land on bs077 | bs077/078 rebuilt from the rounded bu values (closed year: ±1 gap closed); the A/P rounding never goes to bs077/078 |
| D1 | `runDep` booked 4300 / **0190** (buildings) for every asset | Per asset group: 00x → 4300/009x, 010–011 → 4301/0190, 012 → 4301/0192, 013 → 4302/0193, 014 → 4303/0194, 015 → 4303/0195 |
| D2 | `DEP_PRESETS` 0120 "Градежни објекти" (0120 = Постројки), 0140 vehicles (014 = biological), 0130 twice | 0110 / 0120 / 0136 / 0135 / 0134 |
| D3 | `vehicleOnly` assets depreciated (the gate ignores them); no disposal | Skipped; `disposed` date stops depreciation after that month |
| D4 | Start month from `new Date(date).getMonth()` (UTC parse, local read) | Parsed from the string |
| T1 | ТП: COGS (70/71) netted into income; "Останати расходи" negative | Income without 70/71, expenses with them; result and tax unchanged |
| N1 | NPO close journal had no `net` | `npoCloseLines` returns `net` |
| C1 | XML import replaced `zsMan[Y]` wholesale and "remove imported" deleted the year, losing hand-typed amounts | `crmImportPatch` records what it replaced in `crmImp[Y]`; `clearCrmImport` restores it |
| V1 | ДБ-ВП legal form `/\bАД\b/` never matched (JS `\b` ignores Cyrillic) | Unicode-aware match |

## Phase 8 application layer (added with the screens)

| Module | What |
|---|---|
| `entity.ts` | `yeEntityOf` — the one entity discriminator (FIX P8 #12); `YE_ENTITY_VIEWS` (legacy `ENT_V`) |
| `inputs.ts` | `yeInputsFromLedger` (trial balance / close lines / partner balances from posted lines), `yePayrollFromLedger`, `YePayrollSource` |
| `year.ts` | `yeComputeYear`, `yeClosePlan` (close tax by entity: ДБ, ДБ-ВП, ДЛД-ДБ, NPO), `yeOpenPlan` |
| `rebuild.ts` | `obRebuild` (post-close trial balance; balancing row on 8000, FIX P8 #3), `parseTurnoverTb` |
| `notes.ts` | `BEL`, `belAuto`, `belResolve` (explanatory notes) |

`ledger.ts` `closeYearLines` / `openYearLines` are thin adapters over `close.ts` (the tax is required — the Phase 2
flat-10 % stopgap is gone); the root `@wise/core` names are the engine versions. NPO close on the company chart now uses
8000/8100 (FIX P8 #3). DB service: `packages/db/src/yearend.ts`.

## Gaps (not ported here)

- Transport vehicles (0136/0137) have no accumulated-depreciation account of their own in KONTO_SRC/ZS_DEF; their
  depreciation (0193) still reduces bs015 instead of bs014.
- `zcFindings` returns plain-text messages; the legacy HTML links (`go`/`goSt` view ids) are passed through as data.
- EMP (bu257) needs the head count from the payroll module (`YePayrollSource`, TODO(merge) Phase 6); the ledger only
  gives the tax/contribution amounts.
- Done in Phase 8: print layouts (`zsOffHTML`, `zsCrmHTML`, `dbFormHTML`, `vpFormHTML` as HTML print views),
  explanatory notes, `obRebuild`, gating of close / open / lock and a permission-gated undo. Still open: `tpBookHTML`
  (sole-trader books), the dossier (`zsDos`), the AOP rule editor (`zs_aop`/`zs_pr`), `zs_skr`, `zsRok`.
