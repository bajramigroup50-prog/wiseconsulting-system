# Legacy map — porting guide for Phases 2–11

Where every feature of `legacy/index.html` lives, which definition is the one that actually runs, what the stored documents look like, and which legacy behaviours are bugs to fix on purpose rather than copy. Companion to [ROADMAP.md](ROADMAP.md) and [PLAN.md](PLAN.md).

Source: `legacy/index.html` — 17,490 lines (4.5 MB). One `<style>` (5–277), CDN scripts (302–305) and **one** `<script>` block (306–17489). OCR data: `legacy/ocr/eng.js` (3.9 MB), `legacy/ocr/mkd.js` (0.96 MB) — base64/gzip Tesseract traineddata loaded by `tessData` (4605).

All line numbers were taken from the file with `grep -n` / `sed -n` (several independent passes). If the file is edited, regenerate rather than trust them.

## Contents

- [How to read this map](#how-to-read-this-map)
- [Cross-cutting machinery](#cross-cutting-machinery) — state, `save`, `render`, `ledger`, `ACT`, `VIEWS`, `NAV`, storage paths
- [Phase 2 — Core books](#phase-2--core-books)
- [Phase 3 — Sales & purchases](#phase-3--sales--purchases)
- [Phase 4 — Bank & cash](#phase-4--bank--cash)
- [Phase 5 — VAT](#phase-5--vat)
- [Phase 6 — Payroll & HR](#phase-6--payroll--hr)
- [Phase 7 — Stock & retail](#phase-7--stock--retail)
- [Phase 8 — Year-end](#phase-8--year-end)
- [Phase 9 — Office](#phase-9--office)
- [Phase 10 — Industry modules](#phase-10--industry-modules)
- [Phase 11 — Legacy import](#phase-11--legacy-import)
- [Reference data to extract as seed JSON](#reference-data-to-extract-as-seed-json)
- [Top fix-on-purpose list](#top-fix-on-purpose-list)

## How to read this map

The code grew through v3xx–v5xx monkey-patches. Four patterns decide which code runs:

| Pattern | Example | Effective version |
|---|---|---|
| Duplicate `function` declaration | `function stockAt` at 4914 and 13858 | The **last** declaration, everywhere — it is hoisted over the whole script, so even calls written *before* it get the later body. Earlier bodies are dead code. |
| Wrapper | `{const _sv=save;save=async function(c,obj,opts){…_sv(…)…}}` | Chain: last wrapper runs first and calls inward. Behaviour = whole chain. |
| Plain reassignment | `kkTable=function(…){…}` (12823) | Last assignment; any earlier wrappers are discarded. |
| View / handler patch | `{const _v=VIEWS.x;VIEWS.x=m=>{_v(m);…}}`, `ACT.x=`, `Object.assign(ACT,{…})` | Same rules; later `Object.assign` keys overwrite earlier ones. |

Conventions in the tables:
- **bold** line = final/effective definition; "→" = chain in file order (last = outermost).
- `(OA)` = handler defined inside an `Object.assign(ACT,{…})` block; `(PR_ACT)`, `(ET_ACT)`, `(BATCH_ACT)`, `(AUTH_ACT)` = helper objects merged into `ACT` at **7740**; a bare ACT line in 7004–7408 = inside the `ACT` literal.
- "dead" = never executes in the shipped app.
- Konto = account number in the Macedonian chart (KONTO_SRC).

Helper indexes used to build this (regenerate with grep if needed): every top-level declaration/patch line (2,784), every `VIEWS.x=` (356 assignments, 181 keys), every ACT key including the 118 `Object.assign(ACT,…)` blocks (1,161 keys/patches).

## Cross-cutting machinery

### C.1 State and persistence

| Name | Lines | Notes |
|---|---|---|
| `COLS` | **3200** | Per-firm collections: `codes, employees, partners, items, invoices, purchases, bank, sales, journal, payroll, moves, production, assets, docs`. `docs` is polymorphic by `type`. |
| `S` | **3261** | Global state: `db, sample, downloads, assets, firms, fid, data{<COLS>}, view, year, draft, subs, ready`, plus hundreds of ad-hoc UI flags (`S._noVirt`, `S.obFull`, `S.bulk`, …) that change behaviour of core functions. |
| `col(c)` | **3287** | `S.db.collection('firms/'+S.fid+'/'+c)` |
| `selectFirm(id)` | **7838** | Subscribes `onSnapshot` to all 14 collections of the firm; whole firm is held in memory. |
| Boot (async IIFE) | **7856–7876** | `claude.use('db'\|'sample'\|'downloads'\|'assets'\|'mcp')`; subscribes `appusers`, `appsettings/schemes` (`S.gsch`), `appsettings/fx` (`S.gfx`), `appaudit`, `office_tasks/office_tpl/office_newco/pnal` (→ `OF()`), `settings/pay` (`S.payUser`), `firms`. |
| `save(c,obj,opts)` | 3295 (base) + wrappers 12421 (via `var _bkSave0` 12420), 12504, 12540, 12568, 12645, 12758, 12772, 13072, 13100, 13255, 13307, 13464, 13476, 13593, 13994, **17305** | Base: auto-code partners, role check (`can('write')`), **klient → `pend:true`** on invoices/purchases/sales/moves/docs (except `BZ_T` types and `inbox`), approval stamps `apprBy/apprAt/fromClient`, period lock (`firm.lock`; `opts.unlock` bypasses, `opts.force` does not for `lockCol` collections), VAT-closed check (`ddvClosed`), stamps `updated, by, byId`, writes `set()`. |
| `lockCol`, `vatCol`, `LOCK_DOC_T` | 3310–3312 | Which collections/doc types are period-locked / VAT-guarded. |
| `del`, `delBlock`, `delOk` | 3313–3320 | Delete guards (lock, VAT closed, linked bank payment, `usedIn`), `auditLog`. |
| `saveFirmPatch(patch)` | **7661** | Firm record update (`firms/{id}.update`). Many features also write `firms/{id}` directly. |
| `auditLog` | **5473** | `appaudit/{id}`. |

**`save` chain, outermost first** (what each layer does):

| Line | Applies to | Effect |
|---|---|---|
| 17305 | purchases | `mergeFrom` → delete merged purchases after save |
| 13994 | docs `inbox` | mirror to global `appinbox/{fid}_{id}` |
| 13593 | docs `recur` | re-index recurring invoices |
| 13476 | journal (manual) | add `nalNo` from `S._jNo` |
| 13464 | journal (manual) | add `pFrom/pTo` and "(период …)" to `desc` from `S._jPer` |
| 13307 | bank | payment-confirmation e-mail queue (`pnRun`) when a bank line is linked to an invoice |
| 13255 | journal (new manual) | same payment notification for bank/1200 journals |
| 13100 | sales | inject fiscal scheme `S._fkSc` into `fisk`, recompute `lines` |
| 13072 | bank | POS card inflow → konto `posK`, POS partner |
| 12772 | bank | after save: `convPair()` (loops all bank rows) |
| 12758 | bank | currency purchase/sale ("откуп") → FX konto, `conv:true` |
| 12645 | bank | learn `firm.osnovK` (payment-basis code → konto) |
| 12568 | bank | own-account transfer → transit 1009/1039, `own:true` |
| 12540 | all | clear `bkVirt` cache |
| 12504 | bank | drop stale `refs` |
| 12421 | bank / journal / invoices / purchases | partner required on 12x/22x (`BKPK_RE`); bank: find/**create** partner; invoices & non-cash purchases must have a partner |
| 3295 | all | base (above) |

Most wrappers only fire `if(!obj.konto)`, so the first matching layer wins — order-dependent. In the rebuild these belong in explicit domain services (bank classification pipeline, notification jobs), not in the persistence layer.

### C.2 Rendering, navigation, actions

| Name | Lines | Notes |
|---|---|---|
| `NAV` | **3184–3199** | Menu tree `[group, [[view,label]\|['-']\|['>',label,[…]]]]`. Mutated at 13428 (`mailhist`), 14101–14102 (`mpinIn`), 14346 (`zakoni`), 15199 (`efPrep`), 15280 (`payBatch`), 15362 (`zzlp`), 15836 (`ppNal`), 15974 (`aml`), 16198 (`tpl`), 16352 (`autop`), 16569/16665/16799 (`insp`, `lawrep`, `ujpZakoni`), 16757 (`pozajmici`), 16983–16985 (Производство submenu), 16988 (`opomeni`), 16990–16995 (industry views moved to Дејности), 14651/14690 (freight). |
| `NAV_SHORT`, `NAV_MINI`, `navFlat`, `navDD` | 3667–3670 | Labels |
| `renderNav` | 3671 → **14677** | |
| `go(v)` | 3678 → **13943** | |
| `renderTop` | 3685 → 12906 → **14322** | |
| `VIEWS` | **3694** (`{}`) | Screen registry; ~181 keys. |
| `render()` | 3695 → 12018 (windows) → 12398 → 12539 → 13535 (recurring auto-check) → 14008 (inbox sync) → 14659 (nav history) → 14678 (module tabs) → 14795 (defer re-render while user edits) → 16133 (Word-template buttons) → 16920 (bulk-delete checkboxes) → **17468** (error log) | Base enforces: auth, `teren` role → `mojzad`, `firmAllowed`, firm picker, `klAllowed` (client), `viewOn` (module/entity gating). |
| `navFor` | 10230 → 14676 → 14904 → 15361 → **15975** | Menu filtering (modules, owner-only, AML). |
| `viewOn` | 10228 → **10410** | Module (`MOD_OF`/`modOnF`) + entity type (`ENT_V`) gating. |
| `firmPicker` | 3712 → **14192** (replacement) → 14251 → **14278** | 400+ firm chooser. |
| `ACT` | **7004–7408** literal (278 keys) + 118 `Object.assign(ACT,…)` + `ACT.x=` | Click handlers, dispatched by `[data-act]`. |
| Click dispatcher | **7804** | Klient blocklist regex, then `ACT_NEED[act]` → `can()`. |
| `ROLES`, `RP`, `can`, `ACT_NEED`, `firmAllowed` | **5455**, **5456**, 5457, **5458** (+91 `Object.assign(ACT_NEED,…)`), 5459 | RBAC model (admin, senior, acc, oper, teren, view, klient). UI-only enforcement — see Phase 9. |
| `winOpen/winClose/winRender` | 12010–12012 | Modal "windows" for drill-downs. |
| `errLog`, `APP_VER='v299'` | 17460, 17458 | Error register (`apperrors`); version string is stale. |

### C.3 The ledger is computed, not stored

`ledger(opt)` — 3448 → 12429 → **17424** — rebuilds every journal line for `S.year` on demand:

| Source | Collection / docs type | Lines come from |
|---|---|---|
| Излез | `invoices` | stored `lines` (credits flipped when `crMode='minus'`) + VAT-basis lines (`vbLines`) |
| Влез | `purchases` | stored `lines` + VAT-basis lines |
| Извод | `bank` | **recomputed** `bankEntries(b)`, grouped per statement `izv-<acct>-<date>` |
| Каса | `sales` | stored `lines` + VAT-basis |
| Плати | `payroll` | stored `lines` |
| Залиха | `moves` | stored `lines`; plus **recomputed** `nivel` docs (levelling) |
| ПДД, Компензација, Поврат, Благајна | `docs` pdd / komp / supcr / blg | **recomputed** `pddEntries`, `kompEntries`, `scrEntries`, `blgEntries` |
| Налог / Почетна / Затворање / Амортизација / Камата / ДДВ / Кауција | `journal` (`kind`) | stored `lines` |

Every document can also carry per-line edit overlays `ed{}` and added lines `edAdd[]` (from nalog corrections, `nalSaveRows` 3580). Documents with `pend:true` (client-submitted, not approved) are skipped. Extra configurable lines come from `extraLines` (3441, `gsch.extra`); `sideFlips` (3446) can swap D/P per konto.

Consequence for the rebuild: some documents store a posting snapshot, others are posted live, so a scheme change re-posts history for only some document types. Persist journal rows at posting time (PLAN.md Step 3) and treat the legacy recomputation as the import-time source of truth (Phase 11).

### C.4 Posting scheme resolution

`sch(k)` (3177): `firm.sch[k]` → `appsettings/schemes.sch[k]` → `SCH0[k]` (3174), ignoring empty values **and values equal to `SCH_OLD[k]`** (3176). VAT kontos use separate Proxies `VAT_OUT/VAT_IN/VAT_IMP` (3169–3171) with different override rules (Phase 5). `ACC()` (3278) = KONTO_SRC + firm VAT kontos + `firm.accounts` overrides. About 40 places hard-code `'7400'` and other kontos instead of using `sch()` (Phase 3 §4). In the rebuild: one `resolveAccount(firm, role, rate?)` with a validation rule and an audit trail.

### C.5 Storage paths (all of them)

Per firm: `firms/{fid}` (firm record, with settings blobs) and `firms/{fid}/{COLS}`.

Global (office-wide):

| Path | Lines (examples) | Content |
|---|---|---|
| `firms` | 7871 | Firm records (all firms subscribed by every user) |
| `appusers/{id}` | 7865, 5509–5511, 9163–9176, 14404 | Users: role, firms[], salt, hash (`p2$150000$…` PBKDF2-SHA256, salt `'wc\|'+salt`; legacy `sha(salt+'\|'+pw)` upgraded at login), **`pw0` plaintext initial password for client users** |
| `appaudit/{id}` | 5473, 7868, 16438 | Audit log |
| `appsettings/schemes` | 5246, 5249, 7866, 12860 | Global posting scheme (`S.gsch`) |
| `appsettings/fx` | 6506, 7867 | Exchange-rate list `{rows[{cur,rate,date}]}` |
| `appsettings/office` | 10332, 10381 + 11 more writers | Office profile `S.kdOff` (mail signature, ЗЗЛП, autopilot, brand, stamp/sign images, eurRate…) — overwritten whole |
| `appsettings/kdogNo`, `notice`, `doccodes`, `owner`, `tpl`, `bankfmt` | 10333, 9083, 15595, 14901, 16100, 12742 | Counters and small office docs |
| `settings/pay` | 7744, 7870 | Payroll parameter overrides (global, not per firm) |
| `appinbox/{fid}_{id}` | 13994–14007 | Client-message mirror |
| `applaw` | 14316, 14340 | Law-change feed (written by an external robot) |
| `appmpin/{fid}_{mo}` | 14108, 14122, 14131 | MPIN acceptance index |
| `appaml/{fid}`, `appaml/_rep_{id}` | 15869, 15968 | AML files |
| `apptpl/{id}`, `apptpl/{id}_p{i}` | 16101, 16156 | Word templates, base64 in 300 KB chunks |
| `apperrors/{id}` | 17464 | Error log |
| `office_tasks`, `office_tpl`, `office_newco` | 7869, 3880 | Office tasks, text templates, company formations (`OF()`) |
| `pnal/{id}` | 9241, 9347 | Travel orders (`OF().pn`) |
| `office_apsent/{hash}` | 16302, 16308 | Autopilot sent-message log |
| `backups/{bk-…}` | 8978–8984 | Backup index (files in assets) |

Files: `claude.use('assets')` (`S.assets.upload`, `attach` 4619) → `{id,name,type,size}` objects in `files[]` arrays; served at `/_blob/<id>`; firm `logo/sign/stamp` either data-URLs or `/_blob/<id>` strings (`firmSlim` 14221). Browser `localStorage` holds `wc_sess`, `lk_*`, `al_*`, `mailSig_*`, `frm_*` (typed form values, may contain personal data).

### C.6 AI calls and prompts

`S.sample` (`claude.use('sample')`) via `sampleDoc` (4597 → **12896**, adds `ownerCheck`) and `S.sample.json(…)`; `aiInput` (4614) turns a file into text/images, falling back to Tesseract OCR (`ocrMain` 4607). Prompts to port verbatim (line, size): `IMP_PROMPT` 4350–4361 (2.0 KB), `OCR_NOTE` 4596, `PUR_PROMPT` 4665–4668 (2.7 KB), `EMP_PROMPT` 6044–6046, `BLG_PROMPT` 6525–6527 (2.1 KB), `SALE_PROMPT` 8379–8382 (function), `FS_PROMPT` 10534 (2.0 KB), `OB_PROMPT` 10619 (1.9 KB), `FISK_PROMPT` 11342 (2.7 KB), `RC_DOC_PROMPT` 11650–11654, `REC_PROMPT` 12909, `FK_TILE_NOTE` 13010, `FK_SIMPLE` 13034, `MPIN_ASK` 14055 (1.6 KB), `NC_ID_PROMPT` 15087, `SCR_PROMPT` 16201–16210 (function), `INSP_NKD_PROMPT` 16669; plus inline prompts in `irClassify` (14044), `invSplit` (13685), `bomAI` (13860), `zmImport` (10953), `importBankImg` (4796), `aiClassify` (4856), `tkRead` (13442), `lawAsk` (14341).

## Phase 2 — Core books

Partners, items, chart of accounts, posting schemes, the ledger, journals (налози: manual entry, numbering, locks), trial balance, account and partner cards, IOS, opening balance (manual + Excel/PDF/AI), codebooks.

### 2.1 Functions & constants

**Chart of accounts and posting schemes**

| Name | Lines (final **bold**) | Purpose |
|---|---|---|
| `KONTO_SRC` | **308–3166** | Built-in chart as a template string, one `konto\|name` per line (2,859 accounts) — see Reference data |
| `KONTO` | **3167** | `KONTO_SRC` parsed into `[konto,name]` |
| `RATES`, `TYPES` | 3168, 3173 | `[18,10,5,0]`; item types service/goods/material/product |
| `VAT_OUT0/VAT_OUT`, `VAT_IMP0/VAT_IMP`, `VAT_IN0/VAT_IN`, `VAT_BAD`, `vOk` | 3169–3171 | VAT account maps (Proxies) — detail in Phase 5 |
| `SCH0` | **3174** | Default posting scheme: role key → konto (73 keys) |
| `schOn` | 3175 | `sch(k)` set and not `'-'` |
| `SCH_OLD` | **3176** | Old defaults; `sch()` treats a matching value as *unset* |
| `sch(k)` | **3177** | `firm.sch[k]` → `S.gsch.sch[k]` → `SCH0[k]`, skipping empty / SCH_OLD values |
| `STOCK_K`, `COGS_K`, `REV_K` | 3178–3180 | Getters over `sch()` per item type (REV_K = default item revenue konto) |
| `ACC()` | **3278** | Effective chart: `KONTO` + firm VAT kontos + `firm.accounts` overrides (`null` deletes; else `{mk:v.mk\|\|v.sq\|\|k}`) |
| `kName`, `kontoOpts`, `partnerOpts`, `itemOpts` | 3279, 3720, 3721, 3722 | Name lookup and `<option>` lists |
| `SCH_UI`, `schGet`, `schEx`, `SCH_LBL` | **5171–5178**, 5179, 5180, **5217** | Scheme editor layout, lookup, labels |
| `custList`, `custHTML`, `custRead`, `custApply` | 5207–5216 | Custom % schemes → journal rows (`jFromSch`) |
| `VIEWS.semi` + ACT `schSave` / `schSaveAll` / `schReset` | **5221** | Scheme editor; `schSaveAll` writes global `appsettings/schemes` (= `S.gsch`, loaded at 7866) |

**Persistence, codes, lock**

| Name | Lines | Purpose |
|---|---|---|
| `firm`, `partner`, `item` | 3274, 3276, 3277 | Lookups into `S.firms` / `S.data` |
| `col(c)` | **3287** | `S.db.collection('firms/'+S.fid+'/'+c)` |
| `AUTO_CODE`, `USE_KEY`, `USE_COLS`, `usedList`, `usedIn` | 3288–3292 | Auto codes for partners; usage scan blocks deletion |
| `nextCode`, `takeCode` | 3293, 3294 | Next numeric code, keeps zero padding |
| `save` | 3295 + 16 wrappers, **17305** final | See *Cross-cutting*; relevant here: 12421 rejects manual journal lines on `BKPK_RE` kontos without partner, 13464 adds `pFrom/pTo`, 13476 adds `nalNo`, 13255 payment notification for new manual journals |
| `LOCK_DOC_T`, `lockCol`, `vatCol`, `delBlock`, `delOk`, `del` | 3310–3320 | Lock and delete guards |
| `saveFirmPatch` | **7661** | `Object.assign(firm,patch)` + `firms/{id}.update(patch)` |
| ACT `lockYear` | **7382** | `lock = Y-12-31` — no role check |
| ACT `firmUnlock` | **17021** | Admin only; moves lock back to (Y-1)-12-31 |
| `BKPK_RE` | **12409** | `/^(12[0-8]\|22[0-8])/` — kontos that require a partner |

**Ledger and journals (налози)**

| Name | Lines | Purpose |
|---|---|---|
| `stornoOn`, `stF`, `crModeHTML`, `sideFlips`, `SRC_COL` | 3444–3447 | Credit-note sign mode (`firm.crMode`), side flips (`gsch.sides`), source → collection |
| `ledger(opt)` | 3448 → 12429 → **17424** | Builds all journal lines for `S.year` (see Cross-cutting §C.3). 12429 fills missing partner on 12/22 from the invoice/purchase; 17424 merges transfer-note (`prn-`) stock lines |
| `izvKey/izvId/izvNo/izvLabel`, `setIzvNos`, `ensureIzvNos` | 3469–3477 | Bank statement numbering (`firm.izv`) |
| `NAL_DEF` | **3478** | Default nalog codes/titles per type (15 keys) |
| `nalCode`, `bankNalCode`, `nalMode`, `nalPer` | 3479, 3480, 3481, 3482 | `firm.nalCodes[k]\|\|NAL_DEF[k][0]`; bank codes 6/66… (MKD), 7/77… (FX); `firm.nalogMode` period/doc |
| `nalogMap` | **3483** | Groups ledger lines into nalozi; numbers `code/m1-m2` or a counter from 1021; frozen `firm.nalNo` wins |
| `nalogList` | 3511 | Unique sorted nalozi |
| `nalRows`, `nalDev`, `bankParty` | 3537, 3547, 3548 | Display rows; FX amounts; bank party name/purpose |
| `nalogHTML` | **3552** | Nalog table with edit mode |
| `nalogPdfZ` | 3563 → **13468** (`nalSigFix`) | Nalog PDF |
| `showNalog`, `nalPage` | 3571, 3573 | |
| `nalSaveRows` | **3580** | Manual correction: writes `ed`/`edAdd` back into the **source document** via `save(…,{force:true})` |
| `balances`, `sumPref` | **3600**, **3601** | Per-konto d/p/s; prefix sums with `!` exclusions |
| `nalDelPlan`, `NAL_DEL_N`, `nalDelete` | 6362, 6370, 6371 | Deletes a nalog = deletes all its source documents (double confirm) |
| `nalFreeze`, `nalAutoFreeze`, `nalListHTML` | 6385, 6387, 6388 | Freeze numbers into `firm.nalNo` (auto for dates ≤ lock); list + settings |
| `jEditor` | 6403 → 13460 (period) → **13472** (nalog no. `#j_no`) | Manual journal editor |
| `readJ` | 6411 → 13462 → **13474** | |
| ACT `newJ` / `addJ` / `rmJ` / `jFromSch` | 7255 / 7256 / 7257 / 7254 | `newJ` seeds rows 4400/1000 |
| ACT `saveJ` | 7258 → 12981 (balance/konto/partner checks) → 13463 → **13475** | |
| ACT `nalog`, `nalFixAll`, `nalEdit`, `nalEditOff`, `nalAddRow`, `nalRmNew`, `nalRmOrig`, `nalRmAdd`, `nalBackList`, `nalGo`, `nalogXlsx`, `nalogLed` | 7334–7347 | Viewer/editor |
| ACT `nalSave` | 7338 → **12457** (partner check on 12x/22x) | |
| ACT `nalogPdf` | 7346 → **13469** | Freezes number then prints |
| ACT `nalogEd` / `kpNalEd` | **12384** / **12452** | Open nalog in edit mode |
| ACT `nalDel` | **7983** (OA) | |
| ACT `nalCodes`, `saveNalCodes` | 7182, 7183 | `firm.nalCodes`, `banks[].nal` |
| ACT `ledCsv`, `ledPdf` | 7259, 7269 | Journal export |
| `ACT_NEED` | **5458** | `nalDel:'del'`; `nalEdit/nalSave/nalAddRow/nalRmOrig/nalRmAdd:'fix'` |

**Trial balance, cards, IOS**

| Name | Lines | Purpose |
|---|---|---|
| `CLS`, `BB_LV` | 6648, 6649 | Class names, level buttons |
| `bbRows(lvl,from,to,withClose,pf,byPart)` | 6650 → **13619** (stores `S._bbLast`) | Trial balance aggregation; opening = `kind==='open'` only |
| `bbHasPart` | 6654 | |
| `bbTable` | 6655 → 13620 → **13653** | 13620/13653 replace only the PDF analytic level (13653 falls back to 13620 on error) |
| `bbAnK`, `bbAnOk`, `BBO_CSS` | 13636, 13637, 13638–13652 | Kontos printed per partner in PDF (`firm.bbAnK`) |
| ACT `bbLvl`, `bbOpen`, `bbCard`, `bbPClr`, `bilCsv`, `bilPdf`, `zlPdf`, `bbKAll` | 7350, 7351→**12030**, 7353→**12032**, 7354, 7260, 7267, 8247 (OA), **12034** | 12030/12032 open a window instead of navigating |
| `kkData` | **6679** | Account card data |
| `kkTable` | 6682 → **12823** (full reassignment) | Account card table |
| `kkSod`, `kkCalc`, `kkRowNo`, `docRef` | 12816, 12820, 12821, 12812 | Helpers for 12823 |
| ACT `kkPdf`, `kkXlsx`, `kkGo`, `kkBackB` | 7973 (OA), 7974 (OA)→**12828**, 7975 (OA), 7355 | |
| `kcState`, `kcLines`, `kcSort`, `kcDue`, `kcCard`, `kcTable`, `kcPartners`, `kcDocInfo`, `kcPdfPart`, `kcPicker`, `kcOpen`, `kcSynHTML` | 6426–6480 | Partner cards (`kcSod` 12465). Note: ACT `kc*` at 10166–10169 belong to `VIEWS.kartoni` (Phase 10), not to these cards |
| ACT `kcBack`, `kcGroup`, `kcSynOn/Off`, `kcSynPdf`, `kcaPdf`, `kcAllPdf`, `kcCsv` | 7292–7298 | |
| `anRows` | 6644 → **12963** (filters `S.anF`) | Partner × konto (12*/22*) totals |
| `partnerCard`, `anF`, `_anAll` | 6645, 12962, 12974 | |
| ACT `anCsv`, `anCard`, `anaPdf`, `anAllPdf`, `anCardPdf`, `toKart`, `anFClr`, `anIosAll` | 7261, 7262, 7270, 7271, 7301, 7273, 12975 (OA), 12976 (OA) | |
| ACT `ios` | **7302** | IOS PDF |
| Reconciliation / balance confirmation | `recOpen` 12949 (OA), `REC_PROMPT` 12909, `recParse` 12919, `recMatch` 12925, `VIEWS.recon` 12933→**13729**, `recDocHTML` 13705→**13747**, `potHTML` 13736, ACT `recIosPdf` 13728, `potPdf` 13750, `recFree`/`rf*` 13753–13832, `pa*` 13834–13854 | Card reconciliation with partner (AI reads their card), IOS confirmation (чл. 483 ЗТД), compare two cards, bulk balance confirmations |
| `kpNoPLines`, `bkpNoP`, ACT `bkpFix` | 12445, 12432, **12433** | 12/22 lines without partner |

**Opening balance (почетна состојба)**

| Name | Lines | Purpose |
|---|---|---|
| `readOpen` | **6338** | DOM `[data-o]` → `S.draft.rows` + `#op_date` (change listener 6340 re-renders) |
| `importOpen` | 6342 (`function`, **dead** — hoisting), 10670 (`function`, wins) → **12209** (cancel wrapper) | `obSheet` (Excel/CSV) or `obAi`, then `obDropSums`; classes 4/5/7/8 excluded unless `S.obFull`; builds `S.openCtl` |
| `OB_PROMPT`, `obDig`, `obN`, `obMatch`, `obChunkText`, `obNum`, `obSheet` | 10619–10626 | Parsing / matching |
| `obAi` | 10646 (declaration, dead) → **12190** (full reassignment) → 12274 (`obtParse` PDF text) → 12280 (swaps `pdfToInput`→`_obFull`) → 12372 (`obtParse2`) → 12381 (`obNetZero`) → 12390 (951/961 → 950/960) → **17171** (final, `obRebuild` when `obFull`) | Calls run 17171 inward; 12190 = AI in parallel chunks `OB_PAR=4`, `OB_CH=6500`, `OB_TO=150000` (12187) |
| `obDropSums`, `obCtlHTML` | 10659; 10663 → 12382 → **17172** | |
| ACT `obCtlHide`, `obRes` | 10687, 10688 (OA) | `obRes` adds a balancing 950/960 row |
| `obLastK`, `obPart` | 12188, 12189 | |
| `OBT_AMT`, `obtNum`, `obtItems`, `obtLines`, `obtParse`, `obtVerify`, `obtParse2`, `window._obFull` | 12232–12279, 12350 | Column parsers for PDF text (pdf.js) |
| `obMakePartners` + ACT `obMkP` | 12212, **12215** | Create missing partners |
| `obBankRows`, `obAddBanks` + ACT `obBanks` | 12220, 12222, **12226** | 100x/103x → `firm.banks` |
| `obDiag`, `obSubtot`, `obNetZero`, `obRebuild` | 12283, 12329, 12378, 17158 | |
| `obResK`, `obResLines` | **12386**, **12387** | 951→950, 961→960 (not when `obFull`); also used by `openYear` (6751) |
| ACT `addOpen`, `rmOpen`, `openPdf` | 7327, 7328, 7333 | |
| ACT `saveOpen` | 7329 → 10690 (creates partners) → 12229 (adds banks) → 13246 (balance check) → **17173** (`obFull` year confirm; imported `close-Y`) | |
| ACT `obCancel`, `obDiagB`, `obGo`, `obSwap`, `obFind`, `obSubDel`, `obDocT` | 12208, 12294, 12295, 12312, 12313, 12336, 12337 | |
| ACT `obClearAll` | **12834** | Clears draft; admin can delete `open-Y` |
| ACT `bbImpDel` | 13250 → **17176** | Deletes `bbimp-Y` (+ imported `close-Y`) |
| ACT `transfer`, `doTransfer`; `openYear` | 7323, 7325; 6744 | Carry-forward (Phase 8) |

**Codebooks (шифрарници)**

| Name | Lines | Purpose |
|---|---|---|
| `impBtn` | **5452** | Renders `partneri0`/`artikli0` + "Увоз од Excel" (`BATCH_ACT.impGo` 5453 → `uvoz`) |
| `XT`, `xlNum`, `xlType`, `xlImport` | **6899–6910**, 6911, 6912, **6913** | Excel templates/import for firms, items, employees, partners (listener 6944) |
| `CB`, `cbRows`, `cbList`, `VIEWS['cb_'+k]` | **6947–6964**, 6965, 6966, 6973 | Codebooks stored in `codes` with `cb` field |
| ACT `cbNew`, `cbEdit`, `cbSave`, `cbDel`, `cbDelRow`, `cbSeedCity` | 7367, 7368, 7369, 7370→**14294**, **14291**, 7145 | `cbSeedCity` embeds a city seed list (code, name, postal code, municipality) |
| `simpleList` | 6988 → **16934** (admin multi-select) | Generic list/editor for partners, items, employees |
| ACT `newS`, `editS`, `saveS`, `delS`, `rowDelS`, `autoCodes`, `tplXlsx`, `slDel` | 7399, 7400, 7401, 7403, 7404, 7005, 7356, **16942** | |
| ACT `newAcc`, `editAcc`, `saveAcc`, `delAcc` | 7385–7388 | Konto overrides in `firm.accounts` |
| `TK_F`, `tkMatch`, `tkModal`, `tkRead`, `tkNext` + ACT `tkSave`/`tkSkip` | 13431–13448, **13450** / 13449 | New partner from ЦРМ "тековна состојба" (AI) |
| Item cleanup (brief) | `ART_UNIT0` 11240, `artRules`…`artAutoRun` 11242–11321, `matchItem` patch 11252, `VIEWS.artQ` 11276→**11338**; `noNameIt`/`VIEWS.artNames` 17359/**17360**, ACT `anSave`/`anImp` 17365/17366; `ART_ROLES`/`artRole`/`artRoleK`/`VIEWS.artKonta` 8442–**8445** | Duplicate merge (`aliases`), names for code-only items, item→konto roles |

### 2.2 Data shapes

**partners** — editor fields (6819): `code, name, edb, address, city, email, phone, contact, bank, ddv:bool, active:bool`. From `tkSave` (13450–13453): `embs, manager, nkd, activity, bankName, regDate, docs:[{…att,cat,date,at}], tekovna, konto:''`. Other creators add `foreign` (4364), `type:'customer'` (8409), `pos:true, note` (13067). Because `newS` (7399) seeds every draft with `rate:18, konto:'7400', ddv:true, type:'service'` and `saveS` keeps them, partners saved via `simpleList` also carry `rate/konto/type`. Plus `id, updated, by, byId` from `save`; code auto-assigned.

**items** — (6821) `code, barcode, name, mk:bool, type, unit, price, rate, konto (revenue), min, weight, oe, cross, fits, rawK, costPrice, costPct`; stock fields `sp{whId:retail}`, `cost`, `bom[]`, `labor` (Phase 7); `aliases[]` (artMerge 11268); supplier codes learned by `learnItemCodes` (4430). `xlImport` (6926) also writes an opening move `op-{id}-{W}-{Y}` `{wh,date,item,qty,value,type:'in',src,label,lines:[]}`.

**codes** — `{id, cb, …CB[cb].f}` (7369); e.g. `warehouse`/`store` rows carry `konto, kMarg, kVat` read by `rk()`/`stockK()` (3182); `currency` rows carry `rate, date` (used by `getFx`).

**journal**
- Manual (7258 + 13464/13476): `{id:uid, date, desc, lines:[{k,d,p,partner?}], pFrom?, pTo?, nalNo?, ref?}` — no `kind`, no per-line note.
- Opening: `{id:'open-'+Y, kind:'open', date, desc:'Почетна состојба Y', lines}` (7332; `openYear` 6751 same shape).
- Imported trial balance: `{id:'bbimp-'+Y, kind:'bbimp', date:Y-12-31, desc, lines}` (7332).
- Other kinds in `ledger` (3466): `amort, close, open, kamata, ddv, kauc, mpin, kr, pos`.
- **Any source document** can carry `ed:{[lineIdx]:{k0,d0,p0,k?,d?,p?,doc?,note?,partner?,dd?,dp?}}` and `edAdd:[{k,d,p,doc,note,partner,dd,dp}]` (written by `nalSaveRows` 3580–3597). The importer must apply these overlays.

**Ledger line** (3455–3456): `{k,d,p,partner?,note?,doc,wh,date,src,docId,label,kind,cur,fx}` + `li,oc,oid,_k0,_d0,_p0` on editable lines, `ai` on `edAdd` lines; `dd,dp` = FX amounts; `vb, vbx, vbt, vbr` = VAT-basis markers; bank lines add `nm, np, izn`. `src` ∈ Излез, Влез, Извод, Каса, Плати, Залиха, ПДД, Компензација, Поврат, Благајна, Налог, Почетна, Затворање, Амортизација, Камата, ДДВ, Кауција.

**Firm fields**: `lock` (3305, 7382, 17021); `accounts:{konto:{mk}|null}` (3278, 7330, 7387, 7388); `sch, vatIn, vatOut, vatImp, vatInKonto` (3169–3177, 5228, 12861); `nalCodes` (3479, 7183); `banks[]:{id,name,account,konto,cur?,nal?}` (7183, 12224); `nalNo:{key|'M|'+key:no}` (3484, 6385); `nalogMode, nalogPer, nalPayPer` (6401); `izv` (3473); `crMode` (3444); `bbAnK` (13682).
Global `appsettings/schemes` (5246): `{sch, vatIn, vatOut, vatImp, custom:[{name,rows:[{k,s,v,n}]}], sides, extra, names, hidden}`.

**Opening draft** (6321): `{kind:'open', date, full?, rows:[{k,name,partner,d,p,note,pname?,pcode?}]}`; `S.openCtl` (10682) `{n,nP,nNew,dropped,src,grand,D,P,bad,chk,res,byK}`; parsers return tuples `[k,name,partner,code,saldoD,saldoP]`.

### 2.3 Screens

| View | Lines (final **bold**) | Menu |
|---|---|---|
| `pocetna` | 6319, 12216, 12227, 12296, 12314, 12338, 12841, 13237, **13245** | Финансово › Почетна состојба |
| `nalozi` | **6392** (dispatches to `jEditor` / `nalPage`) | Финансово › Налози за книжење |
| `kartici` | 6627, 8621, 12453, 12554, 12959, **13751** | Финансово › Аналитички картици по комитент |
| `kkart` | **6686** | Финансово › Аналитичка картица по конто |
| `analitika` | 6415 → **12965** (replacement) | Финансово › Аналитика на партнери (ИОС) |
| `bilanc` | 6665, 12036, **13681** | Финансово › Бруто биланс |
| `bkAdv` | **12545** | Финансово › Плаќања без фактура (аванси) |
| `bbPart`, `kpNoP` | **12024**, **12447** | Windows (`winOpen`), not in NAV |
| `recon`, `recFree` | 12933 → **13729**; 13756 → … → **13827** | From partner cards |
| `sifrarnik` | **6984** | Шифрарник › Сите шифрарници |
| `partneri` (+`partneri0` 6819) | 6818 → **13455** | Шифрарник › Комитенти |
| `artikli` (+`artikli0` 6821) | **6820** (also patched by loop at 17374) | Шифрарник › Производи и артикли |
| `konto` | **6822** | Шифрарник › Контен план |
| `artNames`, `artQ`, `artKonta` | **17360**; 11276 → **11338**; **8445** | Шифрарник |
| `cb_*` | **6973** (generated) | via `sifrarnik` (also Плата submenu: `cb_city`, `cb_paysif`, `cb_position`) |
| `uslugiS`, `tarifi`, `terkovi` | **6974**; 6975 → **12844**; **6981** | via `sifrarnik` |
| `semi` | **5221** | Систем › Шеми за автоматско книжење |

### 2.4 Inconsistencies / bugs to fix deliberately

1. **Result accounts** 951/961 vs 950/960 vs 9500/9600 — see Phase 8 item 1 (affects opening import: `obResK` 12386, `obRes` 10688).
2. **`sch()` hides deliberate choices** (3177): a firm/global value equal to `SCH_OLD[k]` is treated as unset, so users cannot choose `advance='2270'` (→2220), `ddvPay='2300'` (→23008), `retailMarg='6690'` (→6694), `retailVat='6691'` (→6640), `pay_net='2400'` (→2401). Meanwhile `SCH0.pay_via` defaults to `2400`.
3. **Saving global schemes wipes every firm's overrides**: `schSaveAll`/`schReset` set `sch:{}, vatIn:null, vatOut:null, vatInKonto:''` on **every firm** (5247, 5249), yet `sch()` and the VAT proxies still give firm values priority. `vatImp` isn't cleared; `ACC()` ignores `vatImp`.
4. **`VIEWS.tarifi` 6975** lists 2300/1300/2301/1302 — kontos that `VAT_BAD` rejects; replaced at 12844.
5. **Duplicate declarations:** `function importOpen` 6342 vs 10670 (6342 dead; its CSV rules differ from `obSheet`); `obAi` 10646 never runs (reassigned at 12190).
6. **Partner-required rule differs:** `BKPK_RE` `12[0-8]|22[0-8]` (12409; save guard 12423, `nalSave` 12457, `saveJ` 12981) vs any `12…`/`22…` in `anRows`, `ios`, `openYear`, `partnerCard` (6644, 7302, 6747) — 129x/229x appear in IOS/carry-forward without being required.
7. Partner creation duplicated: `saveOpen` wrapper 10690 and `obMakePartners` 12212 (both store EDB only when 13 digits, else as `code`).
8. `saveOpen` wrapper 12229 calls `obAddBanks()` **after** the inner save nulled `S.draft`; works only because `render()` rebuilds the draft.
9. **Manual journals cannot be edited** — `saveJ` always creates a new uid; corrections go through `nalSaveRows`, which writes `ed`/`edAdd` into whatever source document (any collection). No per-line note in the editor.
10. **Nalog numbers are unstable until frozen**: manual/fiscal/transfer nalozi numbered from 1021 by ledger date order (3485, 3506); a back-dated doc renumbers everything after it unless frozen in `firm.nalNo` (freeze on PDF 7346, `nalFixAll`, auto up to `lock` 6387). Code overlap: `NAL_DEF.kasa`='1020' vs manual numbers 1021…; `bankNalCode` 6/66/7/77.
11. **Lock asymmetry**: anyone can lock (`lockYear` has no `ACT_NEED`), only admin can unlock and only one year back. `save(…,{force:true})` does **not** bypass the lock for `lockCol` collections (3305); only `opts.unlock` does.
12. **Trial balance**: only `kind==='open'` counts as opening (6651) — `bbimp` and `close` count as turnover; `bbimp-Y` is an ordinary "Налог" in `ledger()` (3466) and double-counts if the year also has real documents.
13. `delAcc` (7388) checks usage only in the current year's `ledger()`.
14. Account-override writes (`saveAcc` 7387, `delAcc` 7388, `saveOpen` 7330) bypass `save()` — no audit/role check.
15. Replacement (not wrapper) patches: `kkTable` 12823, `VIEWS.analitika` 12965 (6415 inlines its own `anRows` copy), `bbTable` 13653 (PDF analytic case), `VIEWS.tarifi` 12844.
16. `xlImport` (6926–6938): matching calls `x.name.toLowerCase()` (throws on items without name); blank Konto/Price overwrites with `REV_K[type]`/0; partner `ddv` defaults to true.
17. `newS` item defaults leak onto partners/employees (7399, 7401).
18. **SCH0 irregularities** (3174): `vbimp18p:'9990018'`, `vbimp10d/p:'99400'/'99900'`, `vbin*` = `vbout*` kontos, `whStock:'660'` (3-digit). All exist in KONTO_SRC but look like data-entry errors.
19. `readOpen`'s global change listener (6340) re-renders the whole screen per field change (workaround `_btnDown`, 800 ms). Don't port the pattern.

## Phase 3 — Sales & purchases

Invoice editor and print templates, credit notes, proforma, dispatch notes, supplier returns/credits, purchases with landed costs and import calculations, AI document reading (single, batch "масовно", PDF split, sales-invoice scan), duplicate detection, UBL import/export, Excel purchase import.

### 3.1 Functions & constants

**Constants**

| Name | Lines | Purpose |
|---|---|---|
| `RATES`, `VAT_*`, `ART32_TXT` | 3168–3172 | See Phase 5 |
| `SCH0` / `SCH_OLD` / `sch()` / `schOn` | 3174 / 3176 / 3177 / 3175 | customer 1200, supplier 2200, supplierFx 2210, advance 2220, revGoods 7410, revService 7400, r32in 1309, r32out 2309 … |
| `STOCK_K` / `COGS_K` / `REV_K`, `rk`/`stockK`/`retailOn` | 3178–3180, 3182 | Konto getters by item type / location |
| `DT` | **3201** | Doc types credit / service / invoice / proforma / dispatch (title, labels, view key) |
| `PDF_CSS` | **3204–3229** (injected 3230; fallback in `pdf()` 3247) | Print CSS |
| `INV_NOTE0`, `sig()` | 3256, 3257 | Default invoice footer note (`firm.invNote ?? INV_NOTE0`); generic signature row |
| `REV_RATE` | 3346 | Revenue keys with per-rate sub-kontos |
| `EXB`, `EXB_LBL`, `SIDE_SRC` | 3430, 3431, 3443 | Configurable "extra lines" per document card |
| `stornoOn`, `stF` | 3444 | `crMode` minus (red storno) vs flip |
| `isSvcInv` | 3868 | Invoice = "service" if every line is a service or not linked to an item |
| `PAYM`, `PARITY`, `PTERMS`, `addDays` | 4073–4076 | Header option lists |
| `COSTS` | **4333** | Landed-cost slots car (customs), t1, t2, sped, trans, dr, dev |
| `fq4`, `stVal` | 4336, 4337 | Stock line value = qty·price·(1−rab%)·(imp ? fx : 1) |
| `IMP_PROMPT`, `PUR_PROMPT`, `SALE_PROMPT`, `SCR_PROMPT` | 4350, 4665, 8379, 16201 | AI prompts (import docs, purchase invoice, issued sales invoice, supplier return) |
| `TESS_V/TESS_CORE`, `OCR_NOTE`, `scanErr` | 4593, 4596, 4687 | OCR / error messages |
| `FUEL_RX`, `isFuel` | 14350, 14351 | Fuel name regex (fuel VAT rule) |
| `EF_ST` | 15200 | e-invoice readiness states |
| `PX_COLS` | 17236 | Excel column regexes for purchase lines |

**Sales: editor, numbering, totals, posting**

| Name | Lines | Purpose |
|---|---|---|
| `calcLines(items,art32)` | **3329** | Totals per (rate, konto), r2 per line; art32 → rate 18, VAT 0; non-VAT firm → rate 0; default konto `'7400'` |
| `advDeduct` / `advUsed` | 3340 / 3345 | Advance-invoice deduction (pro rata per rate) / amount used |
| `revByRate` | 3347 | Revenue konto → `_18/_10/_5` sub-konto when configured |
| `invoiceEntries(inv)` | **3348** | D 1200; P revenue/advance; P `VAT_OUT`; advance reversal; credits flip D/P |
| `invTotal` / `purTotal` | 3603 / 3604 | |
| `docsOf(dt)`, `sInv` | 3869, 3870 | invoice/credit/service from `invoices`; proforma/dispatch from `docs` |
| `docList(m,dt)` | 4041 → **14311** | List screen for all outgoing types (patch adds 🗑 per row) |
| `nextNumber(dt)` | **4071** | `max(maxNum, count)+1` per type/year; service shares invoice sequence |
| `invHeader(d,dt,pInv)` | **4077** | Header tabs Основно / Дополнителни / Посебни (`data-if` fields) |
| `invEditor(m)` | 4140 → **14299** | Patch adds service mode (free-text services, datalist, "+ Услуга") |
| `qaPrice`, `qaMatches`, `qaRender`, `qaPick`, `qaAddNow` | 4161, 4169, 4171, 4173, 4174 | Quick-add (konto = `it.konto \|\| REV_K[type] \|\| '7400'`; export → rate 0) |
| `qaBar(d)` | 4162 → **14298** | Hidden in service mode |
| `bcOwner`, `itemByCode`, `beep` | 4166–4168 | Barcode helpers |
| `totBox(c,a32,d)` | **4183** | Totals box |
| `readInvForm()` | **4186** (listeners 4187–4207) | DOM → draft; art32 toggle sets all kontos to `'7460'` (4205) |
| `svcMode`, `svcTexts` | 14296, 14297 | Service-only firm; remembered service texts (`firm.svcTexts`) |
| `fuelRule`, `fuelRate`, `fuelMsgFor`, `fuelItems`, `fuelSeller`, `fuelBanner` | 14353–14368 | Fuel VAT rate from the law feed (fallback "10% until X, then 18%") |

**Print, QR, e-signature**

| Name | Lines | Purpose |
|---|---|---|
| `mkWords(n)` | **4210** | Amount in Macedonian words |
| `qrImg`, `invQRText` | 4225, 4226 | Payment QR |
| `invAlt(o)` | **4227** | Alternative print styles (`firm.invStyle`) |
| `docHTML(doc,kind)` | 4250 → 13302 (appends `legalFootTxt`) → **13479** (e-sign spacing) | Print of invoice / proforma / credit / dispatch / waybill |
| `legalFootTxt(f)` | **13299** | ЗДДВ чл. 53 / 53-б footnote |
| `esMode(f)`, `sigBlock(f)` | 13478, 13488 | e-sign mode; `sigBlock` is used only by `pkgCoverHTML`, not invoices |
| `pdf`, `pdfBlob`, `pdfWm`, `pdfFixColors` | 3245 → 14227 (final); 3239 → 12873 → 14226 → 14855 → **17391**; 3238; 3231 | html2pdf pipeline (fit, `/_blob` inlining, chunking long PDFs, own pagination) |

**Customer credit notes**

| Name | Lines | Purpose |
|---|---|---|
| `crOthers`, `crRest`, `crQty`, `crInfo` | 8726–8729 | Remaining creditable amount/qty |
| `crCheck(cr)` | **8731** | Same partner, date ≥ invoice, within remainder, return qty limits |
| `crGrossApply(d)` | 8741 | Spread a gross credit over VAT rates |
| `crScale`, `crMoves` | 8745, 8747 | COGS/stock reversal; return moves when `crKind==='ret'` |
| `crModeHTML` | 3445 | |

**Supplier returns / credits (`docs.type='supcr'`)**

| Name | Lines | Purpose |
|---|---|---|
| `scrList`, `scrCalc`, `scrEntries` | 8766, **8767**, **8768** | Whole-denar rounding per row; D supplier / P stock or konto / P `VAT_IN` (posted **live** in ledger 3464) |
| `scrPurQty`, `scrNextNo`, `scrNew`, `scrFromPur`, `scrEditor`, `scrPdfHTML` | 8771–8774, 8783, 8813 | |
| `scrDig`, `scrNn`, `scrFromScan`, `scrScanFile` | 16211–16225 | AI scan path |

**Purchases**

| Name | Lines | Purpose |
|---|---|---|
| `purchaseEntries(p,ddvFirm)` | **3354** | `purRound` → `purchaseEntries0` → merge by konto → `roundL` (whole denars) |
| `vatKset`, `roundL` | 3355, 3356 | Difference pushed to a non-VAT, non-partner line |
| `purchaseEntries0` | 3357 → **11993** | Core posting (groups, art32 r32in/r32out, `VAT_IN`/`VAT_IMP`, `vatNoDed`, cash, landed costs, stock re-konto, retail margin). Patch: `noDed` → no input VAT (travel agency) |
| `exAmt`, `docCard`, `docBasis`, `extraLines` | 3433–3441 | Configurable extra posting lines (`gsch.extra`) |
| `readIntoDraft(file)` | 4326 | AI read into the open draft |
| `costVat`, `costsOf` | 4334, 4335 | Landed costs (`dev` = amt × fx) |
| `allocAuto(p,mode)` / `allocCosts(p)` | **4338** / **4347** | Distribute costs by value, by qty (`trans.byQty`), by customs tariff names (`cn`/`multi`); manual `dep`/`cvat` override |
| `resolvePartner` | 4362 | Find/create partner (foreign flag) |
| `readImportDocs(files)` | **4365** | AI classifies import documents (invoice, ЕЦД, forwarding, transport) → `costs.car/trans/sped`, fx, stock (hard-codes 2210 / 6600) |
| `purRound`, `purPersist` | 4387, **4388** | Integer rounding; persist: allocate, round stock values, post, save, write `pur-` moves, learn codes, apply sale prices |
| `salePriceUpdates`, `applySalePrices`, `flushItemUpdates` | 4393, 4398, 4400 | New sale prices; for stores creates a `nivel` doc |
| `calcRows`, `calcHead`, `calcPdfHTML`, `pltPdfHTML`, `priemPdfHTML` | 4401–4419 | Calculation, ПЛТ, приемница prints |
| `createMissingItems` | 4424 | Auto-create items (code seq ≥1000, price = cost·(1+`defMargin`‖25%), konto 7400) |
| `learnItemCodes`, `bcResolve`, `ensureSupplier` | 4430, 4435, 4439 | |
| `purDups` | 4440 | Duplicates by number + date |
| `nextCalcNo`, `purCheckHTML`, `purHeader` | 4441, 4442, **4446** | |
| `ddvClosed`, `stType`, `stTypeK`, `purType` | 4501–4504 | `purType` = `ptype \|\| (stock\|imp ? 'stock' : 'cost')` |
| `purEditor(m)`, `readPurForm()` | **4505**, **4557** | |
| `purFxInfo`, `purFxCell` | 17325, 17326 | FX column in lists |
| `purDelFast(ids)` | 17348 | Fast delete for many lines |

**AI reading and OCR**

| Name | Lines | Purpose |
|---|---|---|
| `isPdf`, `stage`, `withTimeout` | 4577–4579 | |
| `pdfToInput(file)` | **4580** (temporarily swapped by `obAi` 12280 — not a permanent patch) | PDF text layer (≤30 pages) or JPEG renders |
| `loadScriptOnce`, `canSendImages` | 4594, 4595 | |
| `sampleDoc(prompt,inp,opts)` | 4597 → **12896** (`ownerCheck`) | AI JSON call with OCR fallback |
| `ocrPrep`, `ocrWorker`, `gunz`, `tessData`, `ocrMain`, `ocrBlobs` | 4598–4613 | Tesseract (worker first, then core); data from `ocr/*.js` or jsDelivr |
| `aiInput` / `aiInput0` | 4614 / 4615 | File → prompt extra + images (xlsx, xml/csv/txt, pdf, image) |
| `attach(file)`, `fileLink`, `blobOf` | 4619, 4624, 4625 | Upload to assets → `{id,name,type,size}` |
| `wireScanDrop`, `nextScan` | 4637, 4642 | |
| `matchItem` | 4643 → **11252** | barcode → supplier code → any supCode → name/alias → fuzzy (patch adds normalised/fuzzy matching) |
| `scanFile(file)` | 4649 → **13699** | Patch: `invSplit` first; >2 parts → batch |
| `purConsistent`, `fixRates`, `aiReadPurchase`, `fixLines`, `draftFromScan` | 4669, 4674, **4679**, 4688, **4695** | XML → `ublToScan`; else quick then default model tier; consistency checks; qty/price ×10/100/1000 fixes |
| `batchDup`, `batchCheck`, `batchRun` | 5354, 5355, 5357 → **13700** | 3–4 parallel workers (patch: `invSplitAll`) |
| `aiReadSale`, `fixSaleQty`, `outFindPartner`, `outDraft`, `outCheck`, `outEnsurePartner`, `outBx`, `outPersist`, `outUnpersist` | 8383–8414 | Scan issued sales invoices → review queue (`docs.type='outscan'`) |
| `outRun` | 8415 → **13701** | |
| `outRunDeep`, `outBatchHTML`, `outSaveOne` | 8423, 8424, 8428 | `outSaveOne` goes through `ACT.saveInv` |
| `pdfLibLoad`, `invSplit`, `invSplitAll` | 13684, 13685, 13698 | AI page grouping → one PDF per invoice (pdf-lib) |
| `ownDig`, `ownMatchFirm`, `ownerCheck` | 12876, 12877, 12880 | "Document belongs to another firm" guard |
| `aiCmp` / `aiCmpGo` | 14412 / 14416 | Admin test: quick vs detailed model on a real invoice |

**UBL, e-invoice, Excel**

| Name | Lines | Purpose |
|---|---|---|
| `ublXml(inv)` | **5117** | UBL 2.1 export |
| `xmlRows`, `ublToScan(txt)` | 5394, **5398** | UBL Invoice/CreditNote → purchase scan object |
| `efLoad`, `efCheck` | 15201, 15204 | e-invoice readiness (EDB 13 digits, EUJP-ID, certificate, test) |
| `IMP_T`, `impN`, `detectDec`, `impNum`, `impDate`, `impRead`(+0), `impAuto`, `impHeaderRow`, `impExec`, `impBtn` | 5381–5452 | Generic Excel/CSV/XML import (partners, items, invoices, purchases…) |
| `UVH`, `uvHub` | **17199–17217**, 17218 | Import hub for Материјално / Малопродажба |
| `pxHTML`, `pxReadHead`, `pxAuto`, `PX_LAT`, `pxNorm`, `pxN6` | 17240–17259 | Excel purchase-lines dialog |
| `pxBuild(D)` | 17264 → **17376** | Excel lines → purchase draft (creates items; patch renames "Артикл …" placeholders) |
| `xlEvalSheet` | 17338 | Evaluates spreadsheet formulas via `Function()` |

**ACT handlers**

| Handler | Lines | Notes |
|---|---|---|
| `cancel` | 7006 | Returns to masovno if a batch is open |
| `newInv` / `editDoc` / `toInvoice` | 7007 / 7008 / 7009 | Draft constructors |
| `addItem` / `rmItem` / `invTab` / `applyGdisc` / `advAll` | 7012–7016 | addItem konto: art32 ? '7460' : '7400' |
| **`saveInv`** | 7017 → 14307 (remember service texts) → 14359 (fuel VAT check/fix) → **14549** (mark freight tours invoiced) | Core 7017 validates, stock checks, branches proforma / dispatch / credit / invoice |
| `docView` | 7038 → **9486** | Adds proof-of-delivery button |
| `sendMail` / `sendMailGo` / `sendWa` / `shareDoc` / `invStylePrev` | 7040 / 7045 / 7058 / 7064 / 7070 | |
| `printDoc` / `docPdf` / `listPdf` | 7148 / 7149 / 7151 | |
| `delDoc` | 5061 (ET_ACT) | |
| `qaAdd`, `ublDl` | 7316, 7366 | |
| `addSvc`, `fuelItemsRate` | 14304, 14367 | |
| `crFrom` / `crCopy` | 8759 (OA) → **11992** / 8760 (OA) | 11992 copies `tourM`/`tbookId` |
| `newPur` / `editPur` / `newPurImp` | 7154 / 7155 / 7184 | |
| `addGroup`, `rmGroup`, `rmFile`, `addStock`, `rmStock`, `addSupplier`, `applyMargin`, `createMissingItems` | 7156–7165 | |
| **`savePur`** | 7166 → **14361** (fuel-rate warning) | `savePur_` 7170 validates and calls `purPersist` |
| `distCosts` / `distVat` / `distCn` / `distMulti` / `calcTot` / `calcPdf` / `pltPdf` / `priemPdf` | 7174–7181 | |
| `purTab` / `fxToDen` / `cnToCar` / `readAtt` / `groupsFromStock` | 7185–7188, 7190 | |
| `delPurRow` / `delPurSel` | 7189 → **17352** / 7192 → **17354** | `purDelFast` |
| `delPurDups` / `delPur` | 7195 / 7196 | `delPur` still the slow path |
| `purType` / `scanSkip` / `purRecvToday` / `purLateOk` | 7979 / 7981 / 7985 / 7985 (OA) | `purType` 'cost' sets konto '4100' |
| `scanCancel` | 7787 | |
| `batchOpen` / `batchRm` / `batchClear` / `batchSaveAll` / `impGo` | 5373–5376, 5453 (BATCH_ACT) | |
| `outScanB`, `outOpen`, `outRm`, `outDeep`, `outClear`, `outCancel`, `outSaveAll` | 8433–8439 (OA) | |
| `scrNewB` … `scrSave` / `scrDel` / `scrPdf`, `scrScanPick` | 8819–8839 (OA), 16232 | |
| `efGo` / `efSet` / `efOpen` / `efFix` | 15208 / 15211 / 15213 / 15214 | |
| `pxTpl`, `pxOpen`, `pxClose`, `pxPick`, `pxMapGo`, `uvToPx`, `uvGo` | 17237, 17239, 17239, 17249, 17262, 17318, 17223 | `pxOpen` default fx '61.5' |
| `ksClr`, `ksPren`, `ksInv`, `ksMerge`, `ksBook`, `ksET`, `ksDel` | 17293–17308 | Bulk calculation ops |
| `aiCmp`, `aiCmpGo` | 14412, 14416 | |

### 3.2 Data shapes

**Invoice** (`invoices`; credit notes also here with `credit:true`)
- Constructor `newInv` (7007): `{kind:'invoice', dt, number, date, pdate, due:'', partner:'', art32:false, items:[{name, unit:'ком', qty:1, price:0, disc:0, rate:18, konto:'7400'}]}`. `toInvoice` (7009) adds `fromDoc, fromType, fromNumber, fromDispatch`; `crFrom` (8759) adds `refInv, crKind:'price', export`; freight (14547) adds `frTours, frCur, frTot`; `outDraft` (8396) adds `scanned, files, _buyer, _total` (underscore fields stripped at 8428/8434).
- `readInvForm` (4186) by id: `number, date, pdate, due, partner, note, dAddr, loadPlace, vehicle, driver, refInv, wh, crKind (price|gross|ret), crGross, art32`; all `data-if` header fields (4077–4139): `oe, payer, days, refDoc, dispNo, archNo, expType (D|E), priceList, cur, fx, icd, decl, distrib, gdisc, payMethod, salePlace, city, workOrder, prio, attachNote, saldo, prod, prodCost, grp1, grp2, costType, placeFrom, placeTo, domestic, repro, parity, pay1–pay3, carrier, trailer, loadDate, unloadDate, advType (R|A)`; derived `export = expType==='E'`, `advance = advType==='A'`, `advances = {advInvId: baseAmount}`.
- Line `items[]`: `{name, itemId, unit, qty, price (net), disc %, rate, konto, code?}` — values stored as typed (strings).
- On save (7017, 7032–7033): `lines = invoiceEntries(inv)` snapshot; `dt` kept (deleted for credits); optional `fuelOk`, `tourM`, `tbookId`, link fields from Phase 10 (`hresId, woId, rresId, ordId, csitId, apptId, recurId, pnRet`).
- Stock moves via `postOut`: sales `inv-{id}-{ix}-{item}-sale`; credit returns `inv-{crId}-{ix}-{item}-return` (`type:'return'`).

**Purchase** (`purchases`)
- Constructor `newPur` (7154): `{kind:'purchase', number:'', date, partner:'', art32:false, groups:[{konto:'4000', rate:18, base:0, vat:0}], stock:[]}`; `newPurImp` (7184) adds `vid:'U', imp:true, supKonto:'2210', groups:[{konto:'6600', rate:0}]`.
- `readPurForm` (4557) `data-pf` fields: `calcNo, oe, terk, extraCost, rabReg, rabQty, rabSez, docDate, due, days, retNo, distrib, odobr, evKurs, evCur, saldo, memo, pay (bank|cash), vid (D|U), fxAmt, cur, fx, fxMark, ecd, supKonto, grp1, grp2, costType, driver, truck, trailer, withVat`; derived `imp = vid==='U'`, `cash = !imp && pay==='cash'`; `costs[slot] = {amt, doc, date, due, partner, fx (dev), byQty (trans), lines:[{base,rate,vat}×3]}`; `cnames[15]`; `wh, number, date, partner, art32, groups[], stock[]`.
- Other fields: `ptype (stock|cost), calcAuto, distMode (val|cn|multi), files, scanned, autoShift, lateOk, supplierName, supplierEdb, fuelOk, noDed, tarr, proj, lots`, transient `mergeFrom`.
- Persisted by `purPersist` (4388): `groups` → `{konto, rate, base, vat}` integer-rounded; `stock` → `{item, name, amount, code, barcode, qty, price, rab, cn, dep, cvat, sp, value}` (rows without `item` dropped); `lines = purchaseEntries(p, firm().ddv)`; moves `pur-{id}-{i}-{item}` `type:'in'`.
- `draftFromScan` (4695) kind → konto map: material 3100, service 4100, energy 4010, goods 6600, asset 0130, other 4400, default 4000.

**docs**
| type | Fields | Lines |
|---|---|---|
| `proforma` | invoice draft fields + `type`; `invoiced, invNumber` once converted | 7027–7036 |
| `dispatch` | same; moves `isp-{id}-{ix}`; print reads `forWh/forStore` (no editor sets them) | 7029–7030, 4298 |
| `supcr` | `kind ('ret'\|'disc'), date, number, auto, partner, refPur, wh, note, supNo, rows:[{item,name,qty,price,rate,konto}], files?, scanned?, _scan?, _newSup?`; moves `scr-{id}-{ix}-{item}` `type:'supret'` | 8773, 8835, 16213 |
| `outscan` | `{id, type:'outscan', name, deep, draft, updated}` — written with `col('docs').doc(id).set()`, **bypassing `save()`** | 8413 |
| `nivel` | `{number, date, wh, lines:[{item,qty,old,new}], note}` (from sale-price updates) | 4398 |

### 3.3 Screens

| View | Lines (final **bold**) | Menu |
|---|---|---|
| `izlez` | 4066 → 14371 (loop: fuel banner) → 16892 → **16897** | Материјално › Излез |
| `uslugi` | **4070** | Материјално › Услуги |
| `odobrenija` | **4069** | Материјално › Одобренија |
| `profakturi` / `ispratnici` | **4067** / **4068** | Материјално › Други документи |
| `vlez` | 4315 → 17276 → 17321 → 17327 → **17374** (loop over vlez/kalk/artikli) | Материјално › Влез |
| `povratDob` | 8777 → **16233** | Материјално › Повратници / одобренија од добавувачи |
| `efaktura` | **5130** | Материјално and Малопродажба › Е-Фактура |
| `efPrep` | **15215** (NAV insert 15199) | Канцеларија › 🧾 е-Фактура – подготовка |
| `skan` | 4628 → 14435 → **16235** | Материјално › Скенирање документ |
| `masovno` / `masovnoM` | **5361** / **5360** | Материјално / Малопродажба › Масовно внесување фактури |
| `kalk` | 5523 → 17282 → 17331 → **17374** | (via kalkG/kalkM) |
| `kalkG` / `kalkM` | 5522 (delegates to `VIEWS.kalk` at call time) → **17421** (loop) | Влезни калкулации |
| `kalkCalc` | **5611** | Калкулатор на цена |
| `uvoz` | 5413 → 17228 → 17231 → **17314** | Систем › Увоз од Excel / CSV / XML |
| `uvozMat` / `uvozMalo` | **17222** | 📥 Увоз од Excel / XML |
| `uslugiS` | **6974** | Service list (via Шифрарник) |

Loop patches not visible in a plain `VIEWS.x=` grep: 14371 (`izlez, artikli, m_izlez, fiskPer`), 17374 (`vlez, kalk, artikli`), 17421 (`prenosi, nalozi, kalkG, kalkM, bilanc`).

### 3.4 Inconsistencies / bugs to fix deliberately

1. **Three VAT override Proxies resolve differently** (3169–3171) — see Phase 5 item 1. Use one resolver.
2. **Advance konto contradicts itself**: `SCH0.advance='2220'`, `SCH_OLD.advance='2270'` ignored, but the invoice UI callout (4137) still says advances post to **2270**.
3. **Hard-coded kontos with the wrong chart meaning**: `'7460'` (export revenue) for art. 32-a sales lines (4205, 7012, 14304); `'4100'` (rail transport services) for art32 purchases (3361), AI kind 'service' (4696) and purType 'cost' (7979); `'7690'` (membership income) for supplier discounts (8768, 8823); kmap energy `'4010'` (office material), other `'4400'` (per diems), asset `'0130'`. `'7400'` repeated ~40× (3334, 4152, 4175, 4194, 4428, 7007, 7012, 8397, 17298 …) instead of `REV_K`/`sch()`; `'2210'`/`'6600'` hard-coded in import paths (4370, 4373, 4487, 4569, 7184, 7186).
4. Landed-cost VAT fallback `'1300'` (3369/3370) is in `VAT_BAD`. Import cost suppliers always post to `sch('supplier')` (3370), even foreign carriers. `scrEditor` note (8790/8803) always shows `sch('supplier')` while `scrEntries` uses `supplierFx` for imports.
5. **Rounding differs by document type**: invoices r2 per line (3329); purchases whole denars (4387, 3356); supcr `Math.round` per row (8767); COGS `Math.round` (8745, `postOut`). Art32 "transferred VAT" = `r2(base*.18)` in `totBox` (4184) but sum of per-line r2 in `docHTML` (4294/4304).
6. **Non-VAT firm prints VAT**: `calcLines` zeroes VAT when `firm.ddv===false`, but `docHTML` (4292/4302) and `ublXml` (5127/5129) compute line VAT from `it.rate`.
7. **`ublXml` (5117)**: credit notes emitted as `<Invoice>` with TypeCode 381 instead of `CreditNote`; `PayableAmount = c.total` ignores advances and art32; line amounts unrounded; unit always C62; CompanyID raw EDB.
8. **`ublToScan` (5398)** imports CreditNote as a positive purchase, always `art32:false`, all groups kind 'goods' (6600).
9. **`ownerCheck` false positives**: the `sampleDoc` patch (12896) triggers when the prompt contains `"buyerEdb"`; `SALE_PROMPT` contains it, so every scanned *sales* invoice is checked against the own firm as buyer. Multi-invoice results skip the check entirely.
10. **Three duplicate-purchase rules**: `purDups` number+date (4440, auto-deletes "older"); `batchDup` number && (partner || total±1) (5354); `savePur` number && (partner || total || date) (7166).
11. **Invoice currency is never applied**: `cur`/`fx` captured (4105) but totals, print ("ден.") and UBL ("MKD") treat amounts as MKD; ledger only tags lines (3453).
12. **Posting snapshot vs live**: invoices/purchases store `lines` (re-posted only by `schRepost` 5250); supcr/nivel/blg/pdd/komp/bank are live (see Cross-cutting C.3).
13. **Service invoices appear twice** (Излез and Услуги): `isSvcInv` (3868) treats free-text lines as services.
14. **Transient fields persisted**: `fuelOk`; `_scan`, `_newSup`, `auto` on supcr (8835); `calcAuto`, `autoShift`, `lateOk`, `scanned`; `outscan` bypasses `save()`.
15. **e-sign mode**: `legalFootTxt` says "no stamp", but `esMode` patch (13479) only resizes the signature — stamp still renders (4248, 4310). The art. 53 footnote is also appended to proforma and credit documents (13302).
16. Art32 rate differs by path (`outDraft` rate 0 at 8397; `newInv`/editor 18; purchases `+g.rate||18` at 3361) — masked by `calcLines`.
17. Small bugs: SELECT change handler (4207) calls `totBox(...)` without `d` (advance disappears from totals); duplicate `docDate` key in `draftFromScan`; `pxBuild` new-item rate `f0.ddv?18:0` vs 18 elsewhere; `delPur` (7196) not on `purDelFast`; `nextNumber` jumps on irregular numbers; proforma saved with `{force:true}` but dispatch not (7029–7030); `scanFile` split threshold (exactly 2 parts stays single).
18. **`saveInv` chain re-reads the form in every wrapper** and the fuel patch calls `render()` mid-chain — implement as one explicit pre-save pipeline.
19. `xlEvalSheet` (17338) evaluates formulas with `Function()` — replace with a real formula evaluator (or SheetJS cached values only).
20. Fuel VAT fallback "10% until X, else 18%" (14354) is a hidden legal assumption — make it reference data.

## Phase 4 — Bank & cash

Statement import (Excel/CSV, MT940, Halk XML / camt.053, Komercijalna KB `.300`, AI from PDF/image), statement numbering and balances, auto-match & rules, FX accounts and differences, own transfers and currency conversion, POS terminal, cash register (благајна) with receipt scanning, compensations.

### 4.1 Functions & constants

**Accounts, statement numbers, balances**

| Name | Lines (final **bold**) | Purpose |
|---|---|---|
| `banks()` | **3378** | `firm.banks`, else one fallback `{id:'main', konto:'1000'}` from `firm.bankName/bank` |
| `bankOf`, `bankKontos`, `acctOf`, `CURS`, `isFx` | 3379–3383 | Unknown id → `banks()[0]`; `acctOf(b)=b.acct\|\|'main'`; CURS MKD/EUR/USD/CHF/GBP |
| `bankEntries(b)` | 3384 → **12760** | Bank konto vs `b.konto` (default 1200 inflow / 2200 outflow); `split[]` (outflows only; remainder to `sch('pay_net')`); `settle` difference → 7810/4810. Patch: FX side of a conversion → `[]` |
| `saveBank(b)` | 4817 | `b.lines=bankEntries(b)` + `save('bank')` |
| `izvKey`, `izvId`, `izvNo`, `izvLabel`, `setIzvNos`, `ensureIzvNos` | 3469–3477 | Statement key `[acct:]date`; nalog id `izv-<acct>-<date>`; numbers per year max+1 (`firm.izv`) |
| `bankNalCode` | 3480 | Nalog code per account (`nal` or 6/66…, 7/77…) |
| `izvSugg` + ACT `izvFill` | 12392, **12400** | Interpolate missing statement numbers |
| `izvGaps`, `izvYearEnd` | 12597, 16882 | Closing≠next opening (`firm.izvSal`); last statement not on 31.12 |
| `izvRate`, `fxItem` | 4815, 4816 | FX rate per statement (`firm.izvRate`) → `cur`, `amountCur`, MKD `amount` |
| `bookSaldo` / `bookSaldoCur` | 4708 / 12653 | Ledger balance of bank konto (MKD / currency) |
| `izvSalHTML` | 4709 → **12655** | Statement vs book balance (FX version in patch) |
| `izvHead` | 4733 → **12396** | Header with totals |
| `bankTargets`, `fxCell` | 4739 (+ wrapper loop 12543), 4732 | |

**Import**

| Name | Lines | Purpose |
|---|---|---|
| `findHeader`, `parseAmount`, `parseDate` | 4747, 4745, 4746 | Tabular parsing |
| `importRows(rows)` | **4748** | Excel/CSV → bank docs (`osnov`, `bref`, `name`), statement no./balances from header rows; then `autoMatch` + `aiClassify` |
| `parseMT940` | 4763 → 12558 (strip year prefix, `:60F/:62F` balances, clean descriptions) → 12593 (cache `S._mtLast`) → **12720** (name from `?32/?33` or `/NAME/`) | |
| `importMT940` | 4776 → 12594 (`firm.izvSal`) → **12724** (re-parse, re-save names) | |
| `xNum`, `xDate`, `parseBankXml` | 12605, 12606, **12607** | Halk `RacunPrivredaIzvod` (`Zaglavlje/Stavke`, `OsnovPlacanja`, `Provizija`) and ISO 20022 camt.053 |
| `importBankXml` | 12627 → **12888** (`ownerCheck`) | Account by IBAN/number; gross≠net → extra foreign-bank fee row on **4460** |
| `KB_RE`, `parseKB` | 12669, **12670** | Komercijalna "KBFileFormat" `.300` |
| `importBankFile(file)` | 4784 → 12641 (XML / .xls-with-XML) → 12677 (KB) → **12889** (`ownerCheck`) | Dispatch by extension; AI fallback |
| `importBankImg(file)` | 4796 → **12900** | AI reading of PDF/image statements (`izvRate`, `izvTot`, `izvSal`, archives file) |
| `BANKS_MK`, `bankCodeOf`, `bankByText`, `bkAnalyze`, `bkScore` | **12709–12715**, 12716, 12717, 12727, 12741 | Bank registry (Halk 270, Комерцијална 300, …), detection, file analysis for `bankFmt` |
| `bKey`, `dupIds`, `impMsg`, `izvToast`, `_impAsk` | 4811, 4812, 4813 → **12661**, 4810, 12660 | Duplicates; "same statement imported again?" prompt |

**Matching, classification, rules**

| Name | Lines | Purpose |
|---|---|---|
| `autoMatch` | 4818 → 12500 (`bmRun`) → 12590 (`bmRunFx`) → 12646 (`osnovK` rules) → 12666 (await `_impAsk`) → 12775 (VAT via bank) → **13073** (POS) | Outermost runs first. Base: FX near-match (4%), MKD exact amount, `BANK_FEE`→4460, `payMatch` (salaries), invoice/purchase hit, `firm.rules` |
| `bmSeg`, `bmKey`, `bmNums`, `bmEq`, `bmSubset`, `bmRun` | 12471–12484 | Invoice number extraction; number → exact amount → subset sum (≤14 open items); `refs[]` for multi-invoice payments |
| `bmRunFx` | 12578 | FX matching in currency (`inv.fx`), sets `settle` |
| `bmOpenFor`, `bmLink`, `bkUnl`, `VIEWS.bkPick` | 12508, 12510, 12507, 12692 | Manual linking (`bmRun/bmOpenFor/bankTargets` wrapped by loop 12542–12543 to use real open amounts) |
| `aiClassify(quiet)` | 4856 → **12442** (then `bkpLinkAll`) | AI konto suggestion (`b.ai`) |
| `counterparty`, `bankCpName`, `bkName`, `bkEffK`, `bkRefPartner`, `bkJunk`, `BKPK_RE` | 4855, 12408–12417 | Partner helpers |
| `bankFindPartner(b)` | 12418 | Finds partner, else **creates one** via raw `_bkSave0` |
| `bkpNoP`, `bkpLinkAll`, `kpNoPLines`, `bkInvNo`, `kcSod` | 12432, 12441, 12445, 12464, 12465 | |
| `paidFor(type,id)` | 3602 → 12481 (`refs[]`) → **12538** (virtual FIFO advances unless `S._noVirt`) | Sums bank `ref`+`settle`, credits, supcr, journal `ref.amt`, blg `ref`, komp rows |
| `bkVirt`, `_bvC` | 12529, 12528 | Unlinked partner payments applied FIFO to open docs → `ADV` list (`VIEWS.bkAdv`) |
| `BK_LAT`, `bkLat`, `bkCore`, `bkOwn`, `bkOwnK` | 12561–12567 | Own-account transfer → transit **1039** (FX/conversion) or **1009** |
| `trResid` + ACT `trClose` | 12570, **12572** | Transit residue → journal `kind:'kr'` to 4810/7810 |
| `CONV_RE`, `convFxKonto`, `isConv`, `convPair` | 12754, 12755, 12757, 12769 | Currency purchase/sale: MKD side to FX bank konto (default **1030**), FX side neutral |
| `BANK_FEE` + ACT `feeFix` | 12404 (`var`), **12406** | Fees → 4460 |
| VAT via bank | 12775 | УЈП + ДДВ: out → `sch('ddvPay')\|\|'23008'`, in → `sch('ddvClaim')\|\|'1308'` |
| `posKDef`, `POS_NAME`, `posPid`, `posEnsure`, `POS_RE`, `posIs`, `posSaldo`, `posBox` + ACT `posFee` | 13064–13076, **13078** | POS card inflows → `firm.posK` (default 1200001) + "POS терминал" partner; fee journal `kind:'pos'` 4460 |
| `mbOpen` + ACT `mbNew`/`mbSave` | 13266, **13289**/**13290** | Manual bank row (`manual:true`) |
| `pnCfg`, `pnRun` (+ save wrapper 13307) | 13305, 13308 | Payment-confirmation e-mail → docs `type:'paynote'` (name clash: `pn*` also = travel orders / pay notes) |
| `bkSameRef`, `bkRefKey` | 12691, 12690 | |

**Exchange rates**

| Name | Lines | Purpose |
|---|---|---|
| `FX_DATE0='2026-09-30'`, `FX_DEF`, `FX_NAME` | 6490–6492 | Default mid rates (20 currencies; EUR 61.5) |
| `fxRows`, `getFx(cur,date)`, `fxSrc`, `fxStore` | 6493, **6494**, 6498, 6506 | Firm `currency` codebook → global `appsettings/fx` → `FX_DEF` |
| `VIEWS.kursna` + ACT `fxNew/fxEdit/fxCancel/fxAddCur/fxSave/fxDel/fxXlsx` | **6499**, 7961–7968 (OA) | |

**Cash register (благајна)**

| Name | Lines | Purpose |
|---|---|---|
| `BLG_CAT`, `BLG_CTRY`, `BLG_CUR`, `BLG_FX0`, `BLG_MKRATE={fuel:10}` | 6509–6512, 6536 | Expense categories with candidate kontos, countries, country→currency, fallback rates |
| `blgRegs`, `blgReg`, `blgKonto`, `blgFx (=getFx)` | 6513–6516 | Registers `firm.blg` else 1020 MKD (+1051/1052 EUR if present) |
| `blgCalc` | 6517 | MKD amount and VAT (deductible only for `out`, country MK, VAT firm, rate in `VAT_IN`); **whole denars** |
| `blgEntries` | **6518** | In: register / `x.konto` (default 1000). Out: expense + `VAT_IN` / register. `dd/dp` FX amounts |
| `blgNextNo`, `blgNew`, `blgDocs`, `blgDup` | 6521–6524 | У-nnn / И-nnn per register and year |
| `BLG_PROMPT`, `rcNum`, `rcFromText`, `rcRate`, `rcDoc`, `blgScanFiles` | 6525–6539 | AI/OCR receipt scanning (2 workers) |
| `blgRowHTML`, `blgBatchHTML`, `blgEditorHTML`, `blgLedger`, `blgSetHTML` | 6546–6590 | |
| `VIEWS.blagajna` + ACT `blgReg … blgXlsx` | **6569**, 7937–7952 (OA) | |
| `saleEntries(s)` | 3392 | Cash sales (`sales`): `sch('kasaCash')`=1020 vs revenue + `VAT_OUT` |

**Compensations**

| Name | Lines | Purpose |
|---|---|---|
| `kompList`, `kompNextNo` (К-nnn/yyyy), `kompOpen`, `kompUsed`, `kompTot`, `kompEntries`, `kompNew`, `kompEditor`, `kompPdfHTML` | 8917–8925, 8932, 8945 | Bilateral / multilateral; receivables P `sch('customer')`, payables D `sch('supplier')` |
| ACT `kompNewB`, `kompOpenB`, `kompBack`, `kompAddP`, `kompAuto`, `kompRm`, `kompSave`, `kompDel`, `kompPdf` | 8953–8972 (OA) | |

**Other ACT handlers**: literal — `autoMatch` 7197, `numIzv` 7198, `autoAll` 7199, `delBank` 7200 (no confirmation), `undoImp` 7201, `toggleBanks` 7202, `addBankAcct` 7203, `rmBankAcct` 7207, `delDups` 7208, `unlinkBank` 7209, `flipBank` 7210, `addRule` 7211, `rmRule` 7212, `blgPdf` 7275, `transfer` 7323; `bkPick` 12699, `bkPickTake` 12700, `bkPickSave` 12701 (OA); later: `bkpFix` 12433, `kpNoPShow` 12451, `kpNalEd` 12452, `bkUnlShow` 12521, `bkDel` 16921 (admin bulk delete). Change listeners (not ACT) ≈4835–4846: `data-bk` link/konto + learned rules, `data-bacc`, `data-izvr` (rate → `amount=amountCur*rate`), `data-izvt`, `data-izvs`, `data-izv`.

### 4.2 Data shapes

**bank** (`S.data.bank`; 4748–4809, 12627–12636, 13290, 12484–12510, 12758, 13072): `id, acct ('main' default), date, amount (MKD, signed + inflow), desc, lines[] (bankEntries snapshot), imp (import batch id), updated/by/byId`; optional `name, purpose, osnov, bref, valDate, manual`; FX: `cur, amountCur`; booking: `konto` (empty = 1200/2200 by sign), `partner`, `ref{type:'invoice'|'purchase', id, label}`, `refs[{type,id,label,amt}]`, `settle`, `split[{k,a,n}]`, `payRef` (payroll month); flags `ai, own, conv, pos`. **Note:** the ledger recomputes bank lines (`bankEntries`) — stored `lines` are not authoritative.

**Firm fields**: `banks[{id,name,account,konto,cur,nal}]` (+ legacy `bank`, `bankName`), `izv{key:no}`, `izvRate{key:rate}`, `izvTot{key:{d,p}}`, `izvSal{key:{o,c,no}}`, `rules[{match,konto,learned}]`, `osnovK{'<osnov>|in/out':konto}`, `posK`, `posP`, `autoNotify{pay,sum,to}`, `blg[{id,name,konto,cur}]`, `accounts`, `nalCodes`, `lock`.

**docs**
| type | Fields | Lines |
|---|---|---|
| `blg` | `kind ('in'\|'out'), reg, date, number (У-/И-nnn), docNo, merchant, vatId, country, cur, amt (currency), fx, rate, vat, cat, konto, partner, note, payK, pay, liters, files[], ref?{type:'invoice',id}, pnRef?, rcRef?, tbRef?, proj?`. Draft uses `kind:'blgdoc', k:<in\|out>` | 6522, 7941, 7945 |
| `komp` | `kind ('bi'\|'multi'), date, number, note, parties[], rows[{side:'rec'\|'pay', ref{type,id}, docNo, date, open, amt, partner, konto}]`; rec must equal pay | 8925, 8965 |
| `paynote` | `bank, inv, partner, amt, sent, to, at, date` | 13312 |

Journal kinds created here: `kr` (transit FX difference, 12573), `pos` (POS fee, 13078). **sales** (cash/fiscal day reports) — see Phase 7. Global: `appsettings/fx {rows[{cur,rate,date}],updated}`, `appsettings/bankfmt`.

### 4.3 Screens

| View | Lines (final **bold**) | Menu |
|---|---|---|
| `banka` | 4711 → 12401, 12407, 12443, 12503, 12522, 12553, 12575, 12600, 12650, 12706, 12751, 12761, 12764, 13082, 13296, **13319** (16 wrappers) | Финансово › Изводи (денарски) |
| `devizni` | **4888** (`m=>VIEWS.banka(m)`, late-bound → gets all wrappers) | Финансово › Девизни изводи |
| `bankFmt` | **12742** | Финансово › Банки и формати на изводи |
| `bkAdv` | **12545** | Финансово › Плаќања без фактура (аванси) |
| `bkUnl`, `bkPick`, `kpNoP` | **12513**, **12692**, **12447** | Windows |
| `kursna` | **6499** | Шифрарник › Курсна листа (сите фирми) |
| `blagajna` | **6569** | Финансово › Благајна (1020) |
| `kompenzacii` | **8926** | Финансово › Компензации |
| `banke` | **6983** | Alias → `banka` with banks panel |

### 4.4 Inconsistencies / bugs to fix deliberately

1. **MT940 parsing patched three times**: 12558 uses the *first* `:60F/:62F` of the whole file for every statement (multi-statement files get identical balances); 12720 maps names to items by a running index across statements (skipped lines shift names); 12724 re-parses and re-saves names keyed by `date|amount` (ambiguous).
2. **Fee konto**: fees → 4460 everywhere (4828, `feeFix`, 12636, POS), but the rule UI defaults to `kontoOpts('4400')` (4711); `feeFix` exists to clean 2200/4400 bookings.
3. **Supplier konto on matched purchases**: `bmRun`, `bmRunFx`, `mbSave` use `imp ? supKonto||'2210' : '2200'`, base `autoMatch` (4851) always '2200'.
4. **Hard-coded rates**: EUR 61.5 in `FX_DEF` (6491), `BLG_FX0` (6512), 4948, 7095, `EUR()` 10461 (reads `S.fx`, not `getFx`), 11076, 14989, 15001, 15868, 17239. `BLG_FX0` disagrees with `FX_DEF` (USD 57 vs 54.2519, GBP 72 vs 71.762, CHF 65 vs 65.0175, ALL 0.62 vs 0.628, RSD 0.525 vs 0.5234, TRY 1.6 vs 1.1069) and is used at 11888 instead of `getFx`.
5. **Order-dependent bank save wrappers** (Cross-cutting C.1): POS → conversion → own transfer → partner; each fires only if `!obj.konto`. `bankFindPartner` silently creates partners; `convPair` scans all bank rows after every bank save.
6. **`autoMatch` has 7 layers**, each toasting and rendering; behaviour depends on hidden flags `S._noVirt`, `_bvC`, `_impAsk`.
7. **`paidFor` has hidden state** (12538): virtual advance allocation unless `S._noVirt` — open amounts differ between callers.
8. `bmRun`/`bmLink` can over-allocate: with one picked document the ref takes the whole payment even if larger than the open amount.
9. `rmBankAcct` (7207) orphans bank rows; `bankOf` falls back to `banks()[0]` so they silently re-book to another konto.
10. Default FX konto `'1030'` and transit `1039/1009` hard-coded (12755, 12770).
11. `sch('ddvPay')||'23008'` — the fallback is dead (`sch` already returns SCH0).
12. `ensureIzvNos` uses the file's number only for single-date files; `parseKB` overwrites `st.no` on every line.
13. `delBank` (7200) deletes without confirmation.
14. `blgCalc` rounds to whole denars (`Math.round`) while bank uses `r2`; cash draft `kind:'blgdoc'`/`k` renamed on save.
15. Name clashes: `pnCfg/pnRun` (payment notices) vs `pn*` travel orders vs `pnSave` pay notes (Phases 6/10).

## Phase 5 — VAT

ДДВ-04 computation and form, VAT books (КИФ/КПФ), VAT posting and period close, VAT tariffs/accounts, travel-agency margin VAT, inspector table, bulk period close.

### 5.1 Functions & constants

| Name | Lines (final **bold**) | Purpose |
|---|---|---|
| `RATES=[18,10,5,0]` | **3168** | |
| `VAT_OUT0` / `VAT_OUT` (Proxy) | **3169** | 18→230018, 10→230010, 5→23005; override `firm.vatOut[r]` → `gsch.vatOut[r]` → default, each checked with `vOk` |
| `VAT_BAD`, `vOk` | **3169** | Forbidden summary kontos 2300, 230, 1300, 130, 23000, 13000, 2301, 2302, 1301, 1302 |
| `VAT_IMP0` / `VAT_IMP` (Proxy) | **3170** | 18→13001811, 10→13001818, 5→130000511; firm → gsch → default, **no `vOk`** |
| `VAT_IN0` / `VAT_IN` (Proxy) | **3171** | 18→130018, 10→130010, 5→13005; `firm.vatIn[r]` → `firm.vatInKonto` (one konto for all rates) → `gsch.vatIn` → default |
| `ART32_TXT` | **3172** | Reverse-charge text (чл. 32-а) |
| `SCH0` VAT keys | **3174** | `ddvPay` 23008, `ddvClaim` 1308, `r32in` 1309, `r32out` 2309, `kasaCash` 1020, `vatNoDed`, `vb{in,out,imp}{18,10,5}{d,p}` off-balance base kontos (994…/999…) |
| `vatKset` | 3355 | All VAT kontos |
| `periodOf(d,per)` | 3605 | 'YYYY-MM' or 'YYYY-Тq' |
| `ddvFor(period,per)` | 3606 → **11963** | Output VAT (invoices incl. advance deduction, export, 0%, art32), input VAT (blg, supcr negative, purchases + `costsOf`, import `impB/impV`, art32). Patch: temporarily removes `tourM` invoices / `noDed` purchases from `S.data`, adds travel margin (`tuMarginFor`) to out[18] |
| `vatKmap`, `vatBases`, `docBases`, `vbLines` | 3513, 3514, 3518, 3523 | Off-balance VAT-base lines (994/999) added by `ledger` |
| `ddvCloseLines(od,do_)` | **3524** | Closes VAT konto balances; net → `sch('ddvPay')` / `sch('ddvClaim')` |
| `ddvPostHTML`, `vbCheckHTML`, `vatBasesHTML` | 3528, 3532, 3535 | Posting card; ДДВ-04 vs booked 994 bases; `vatBasesHTML` has no caller |
| `nextPer`, `prevPeriod`, `periodDue` | 3745–3747 | Due date = 25th of next month |
| `oldVatDocs`, `oldVatHTML` | 3871, 3872 | Docs still using `VAT_BAD` kontos |
| `ddvClosed(date)` | **4501** | A journal `kind:'ddv'` exists for the period → `save`/`delBlock` guard |
| `vatCol` | 3312 | Collections guarded after VAT close: invoices, purchases, sales, docs blg/supcr |
| `DDV04` | **5888–5904** | Field list 01–31 |
| `ddv04(sel,per)` | **5905** | `ddvFor` → fields, whole denars |
| `perRange`, `fi` | 5915, 5916 | |
| `DDV_ROWS1` / `DDV_ROWS2` | **5917** / **5918** | Official form layout |
| `ddvFormHTML(sel)` | **5919** | Official form / PDF |
| `AL_DDV_LIMIT=2000000` | 8478 | Registration-threshold warning (revenue 74–76) |
| `dkRange`, `dkOut`, `dkIn`, `DK_COLS`, `dkSum`, `dkCheck`, `dkTable` | 8876–8898 | Output/input VAT books; `dkCheck` reconciles with `ddvFor` |
| `tuMarginFor` | 11961 | Travel-agency margin VAT (чл. 38 ЗДДВ) |
| `DT_DEF`, `DT_SH`, `DT_MON`, `dtState`, `dtRows`, `dtTable`, `dtYearsAvail`, `dtSaveCols`, `dtPdfInner` | 16803–16823 | Inspector table (VAT by month/period, several years) |
| `apPeriodFor`, `apClose`, `apCloseRun`, `apCloseHTML`, `apClRows`, `apClPick`, `apClF`, `apClDdvHTML`, `apClFresh`, `apClBookOne`, `apClForms` | 16361–16439 | Bulk monthly/quarterly close across firms (Phase 9 autopilot) |
| `FUEL_RX`… `fuelRate` | 14350–14368 | Fuel VAT rate rule (Phase 3) |

ACT: literal — `distVat` 7175, `ddvCsv` 7263, `ddvForm` 7312, `ddvPost` 7313, `ddvUnpost` 7315, `ddvPdf` 7317, `ddvBookPdf` 7318, `ddvSel` 7349; OA — `dkT` 8909, `dkPdf` 8910, `dkCsv` 8912; `tuT` 11987, `tuPdf` 11988, `tuVatPost` 11989; `apClGo` 16412, `apClDdv` 16413, `apClMsg` 16414, `apClAll` 16441, `apClPrint` 16442, `apClBookAll` 16444; `dtColsAll/dtColsDef` 16826, `dtPdf` 16827, `dtXlsx` 16828, `dtPkg` 16831; later `trSave` **12855** (`ACT_NEED` 'settings').

### 5.2 Data shapes

- **VAT posting journal** (7314, 16435): `{id:'ddv-'+period, kind:'ddv', date:<period end>, period, desc:'ДДВ-04 …', lines:[{k,d,p,note}], auto?:'autopilot', by, byId, updated}` — lines from `ddvCloseLines`.
- **Firm fields**: `ddv` (VAT-registered), `per:'quarter'|'month'` (changed by wrapper 16456), `vatOut{18,10,5}`, `vatIn{…}`, `vatImp{…}`, `vatInKonto`, `sch{r32out,r32in,ddvPay,ddvClaim,vb…}` (written by `trSave` 12861), `vatFrom` (registration date; dossier only, not used by `ddvFor`), `lock`.
- **Global** `appsettings/schemes` (`S.gsch`): `{vatOut, vatIn, vatImp, sch, updated, by}` (12860).
- **Fields read from documents**: invoices `items, art32, credit, advance, export, pend, tourM`; purchases `groups[{rate,base,vat}], art32, imp, noDed, pend, cash, costs`; sales `groups`; docs blg `rate, vat`; supcr via `scrCalc`; ledger lines `vb, vbx, vbt, vbr`.

### 5.3 Screens

| View | Lines (final **bold**) | Menu |
|---|---|---|
| `ddv` | 5969 → 13126 (defaults to the period due) → 16456 (month/quarter switch) → **16836** (inspector-table button) | Финансово › ДДВ · ДДВ-04 |
| `ddvKnigi` | **8901** | Финансово › Книги за ДДВ (влезни / излезни фактури) |
| `tarifi` | 6975 → **12844** | via Шифрарник (Даночни тарифи) |
| `ddvTab` | **16812** | Button from `ddv` |
| `turaIzv` (margin VAT tab) | **11966** | Phase 10 |

### 5.4 Inconsistencies / bugs to fix deliberately

1. **Three different VAT resolvers**: `VAT_IMP` has no `vOk` (summary kontos like 1300 accepted); `VAT_IN` alone has the single-konto `vatInKonto` fallback, which outranks the global per-rate map. Port as one validated resolver.
2. **Import VAT kontos** `VAT_IMP0` 13001811 / 13001818 / 130000511 follow no pattern (10% ends "18"; 5% has 9 digits).
3. **`ddvPay` 23008 (SCH0) vs 2300 (SCH_OLD)**: `sch()` silently ignores a stored '2300', yet `trSave` (12855) only validates 3–10 digits — a user can save values that are then ignored.
4. **Off-balance bases**: `vbin18d/p` = `vbout18d/p` = 994018/999018 (also 10/5); only line flag `vbt` separates input from output. `vbimp*` irregular (99408, 9990018, 99400, 99402).
5. **ДДВ-04 fields never filled**: 09, 10, 12–15, 23, 24, 30 always 0; field 08 takes all 0% sales (merges exempt-without-deduction into 08). The screen note still tells users to move exports to field 07 by hand although `ddvFor` separates `exportBase`.
6. **`ddvFor` patch (11963)** swaps `S.data.invoices/purchases` while running; travel margin always at 18%; the VAT books (`dkOut`) don't handle `tourM`, so books and ДДВ-04 disagree; margin uses the *current* cost ratio, so later costs change closed periods.
7. **Duplicate posting paths**: `ACT.ddvPost` (7313) uses `save(…,{force:true})`; `apClBookOne` (16433) writes `firms/{id}/journal` directly (skips wrappers, permissions, audit).
8. **`ddvClosed` follows current `firm.per`**: changing month↔quarter (16456) misaligns already closed periods; ids mix `2026-Т1` and `2026-01`.
9. `VIEWS.ddv` recomputes `ddvFor` for every period of the year (plus again in `vbCheckHTML`) on every render — compute once per period server-side.
10. VAT-via-bank heuristic (12775) is regex-based, drops the partner, MKD only.
11. `AL_DDV_LIMIT` 2,000,000 hard-coded (8478) and repeated as text in `VIEWS.ddv` (5976).
12. `VIEWS.tarifi` 6975 shows kontos that `VAT_BAD` rejects (replaced at 12844).

## Phase 6 — Payroll & HR

Employees, payroll runs (v2), payslips (PDF + e-mail), MPIN (MPI3 `.txt`, cp1251) and MPIN-acceptance inbox from УЈП, payment orders, employment contracts, HR register, disciplinary documents, rent/bonus/services from individuals (ПДД), payroll across all firms.

Watch first: the **`pnSave` collision** (item 4.4) and **`docs/mpin-{month}` id collision** (item 4.11).

### 6.1 Functions & constants

**Calculation core**

| Name | Lines (final **bold**) | Purpose |
|---|---|---|
| `SCH0` pay_* keys | **3174** | `pay_gross` 4210, `pay_via` 2400, `pay_net` 2401, `pay_contrib` 2349, `pay_ded` 2492, `pay_pio` 2341, `pay_zdr` 2342, `pay_dop` 2343, `pay_vrab` 2344, `pay_tax` 2340, `pay_e*` '-' |
| `SCH_OLD` pay_* | **3176** | Old accounts 4200/2400/2410–2413/2420/4201/42020–42023 — treated as "unset" by `sch()` |
| `payrollCalc` (v1) | **3393** | Hard-coded PIO 18.8, ZDR 7.5, VRAB 1.2, DOP 0.5, tax 10%. Only caller is `payrollEntries` |
| `payrollEntries` (v1) | **3398** | 4200/2400/2410–2413/2420 over `p.employees[].gross` — **no callers (dead)** |
| `PAY_BL` | 3432 | Basis labels for payroll expense lines |
| `HTYPES`, `HT_ADD` | **5988**, 5989 | Hour types with % (Prekuvremena/Night 135, Holiday/Sunday 150, maternity 0); additional-hour regex |
| `fixRegular`, `monthHours` | 5990, 5991 | Regular hours = H − absences; Mon–Fri × 8 (ignores holidays) |
| `PAY_DEF` | **5992–5995** | Statutory parameters from 2026-01 / 2026-03 / 2026-07: avg 69141, minBase 34571, maxBase 1106256, exempt 10932, minGross/minNet, **pio 19.9**, zdr 7.5, dop 0.5, **vrab 0.1**, tax 10 |
| `PAY_KEYS`, `payRows`, `paramsFor`, `pr` | 5996, 5997, 5998, 5999 | `PAY_DEF` merged with global `settings/pay` overrides (`S.payUser`) |
| `grossFromNet` | **6000** | Net → gross; **fallback PIO 18.8 / vrab 1.2** |
| `empCalc(e,P)` | **6001–6012** | Per employee: rows (gr, ex, contributions, min-base top-up `dPio…`, tax, ded, net), totals; seniority 0.5%/year; pro-rated min gross (v486). **Fallback 18.8 / 1.2** |
| `payrollEntries2(p)` | **6013–6017** | Journal lines for v2 (sch keys, `pay_via` pair, `pay_e*` split, UJP-style rounding) |
| `orthEaster`, `BAJRAM`, `mkHolidays`, `monthSplit` | 6020, **6021**, 6022, 6026 | Orthodox Easter; Ramazan Bajram **2025–2032 only**; holidays with Sunday→Monday shift |
| `stazFor`, `stazYMD` | 6028, 14803 | Seniority (ignores `stazY` when `start` exists) |
| `payTotals`, `payMatch`, `leaveStats`, `g4n` | 6029, 6030, 6042, 6063 | Totals; match bank amount → net/contrib/tax konto; leave days (default 20) |

**Payroll UI and outputs**

| Name | Lines | Purpose |
|---|---|---|
| `payDraft` | 6156 → **14826** | `kind:'payroll2'` draft; patch applies `hNorm` and prorates holidays |
| `PCAT`, `PXTRA`, `catOf`, `workHoursBetween` | 6163–6166 | Line categories reg/dop/bol/odm/kor/sin |
| `payMonthsList`, `payMonths`, `payBaseSum` | 6167, 6168, 6175 | |
| `payContent` | 6176 → **14409** (`payRateWarn`) | Month screen |
| `payAddPanel`, `payEmpPanel` | 6206, 6208 | |
| `PSIF0`, `PSIF`, `paySifInfo`, `plInfo`, `payLineDlg` | **6223–6256**, 6257–6260 | Line codes 001–603 (+ `codes` cb:'paysif') |
| `m4Rows` | 6279 | М4 annual form |
| `payOpenMonth`, `payIOHours` | 6283, 6303 (listeners 6284–6302: F4 save, Ins/Del/Enter) | |
| `slipHTML` | 6304 → 14805 (replacement) → 14832 (wrapper) → **14837** (replacement) | Payslip; only 14837 is live |
| `payDoneModal` | 8258 → **14822** | Post-save modal (search) |
| `pdGroups`, `pdGk`, `pdGrpHTML` | 8310–8312 | Group slips by OE/city for e-mail |
| `slipPdfs`, `slipMail`, `slipMailRes` | 14865, 14871, 14877 | PDF batches ≤ ~480 KB, Gmail send |
| `payRateWarn` | 14407 | Warns for months ≥ 2027-01 without a 2027 parameter row |
| `PN_TYPES`, `pnOf`, `pnOpen`, `pnMonth` | 15235–15238 | Pay-change notes (`firm.payNotes`) |
| **`pnSave(L)`** | **15239** — collides with travel-order `pnSave` 9241 | `saveFirmPatch({payNotes:L})` |
| `pnCard`, `pnModal`, `pnBlock`, `pnRemind` | 15240, 15262, 15268, 15269 | Notes card; block/remind before computing |
| `PXL_COLS`, `plxN`, `PXL_LINE`, `plxMonth` | **14737–14739**, 14740, 14741, 14742 | Payroll import from Excel |
| `pbBuild`, `pbTot`, `pbStatus`, `PB_ST`, `pbScan`, `VIEWS.payBatch`, `pbEmpRows` | 15282–15329 | Payroll across all firms |
| `mpinDir`, `pbMpinZip`, `mpinArchive` | 15335, 15336, 15350 | MPIN zip export; archive to `docs/mpin-{mo}` |
| `offSigPrep`, `offImgSrc` | 14828, 14829 | Accountant's signature on the slip |

**MPIN**

| Name | Lines | Purpose |
|---|---|---|
| `CP1251`, `toCp1251` | **6118**, 6119 | windows-1251 encoder |
| `MPIN_SAMPLE` | **6120** | Hard-coded template with EDB **4082015515270** |
| `mpinTpl`, `mpinParse` | 6121, 6122 | `firm.mpinTpl` or `MPIN_SAMPLE` (if firm EDB ends with it); parse an MPI3 `.txt` as template |
| `mpinTxt(p)` | 6125 → **14734** | Builds MPI3 `.txt` (wrapper fills `mpOps`/`mpZan`, `opsMiss`) |
| `mpinOfficial`, `mpinParamDiff` | 6139, 6140 | `PAY_DEF` row for the month; diff vs `p.params` |
| `mpinExport` | 6141 → **15356** (archives) | Download |
| `mpinTplImport`, `mpinRows` | 6150, 6154 | Template import; rows for Excel / payment orders |
| `MPIN_OPS`, `MPIN_FZO`, `MPIN_SKOPJE` | **14718**, **14719**, **14720** | Municipality (85), FZO unit (30), Skopje municipalities (18) |
| `mpN`, `mpOpsFrom`, `mpFzoFrom`, `mpOpsN`/`mpFzoN`, `mpinEmpCodes` | 14721–14724, 14733 | Infer codes from city/address |
| `edbD`, `mpinFirmOf`, `mpinNum`, `mpinLastDay`, `mpinLinesFor`, `mpinGet`, `mpinSetIn`, `mpinS` | 14046–14064 | UJP acceptance inbox helpers |
| `mpinNorm` | 14050 → **14154** | Normalise AI-read declaration |
| `MPIN_ASK` | **14055** | AI prompt |
| `mpinRead` | 14056 → **14156** (replacement) | Reads acceptance PDF (image fallback `mpinImgs` 14151) |
| `mpinAdd` | 14065 → **14112** | |
| `mpinRowState`, `mpinWhat` | 14071 → **14163**; 14073 → **14114** | |
| `mpinAckOf`, `mpinAdm`, `mpinIdxLoad`, `mpinIdxOf`, `mpinOld`, `mpinReplace`, `mpinGrid`, `mpinOkM`, `mpinAfter`, `MPIN_F` | 14096–14166 | Index (`appmpin`), replacement of a month, grid |

**Payment orders (PP30/PP50/PP10)** — `PP_T`, `PP_NACIN`, `PP_SIF`, `PP_TAX` (15750–15758; PP_TAX covers VAT, profit tax, property tax — **no payroll contributions**), `ppDig`, `ppIban` (mod-97; mandatory from `ppIbanOn` 2026-11-01), `ppAccTxt`, `ppBankName`, `ppAmt`, `ppFirmPayer`, `ppMuni`, `ppNew`, `ppTaxNew`, `ppSuggest`, `PP_LAY`, `ppCal`, `ppSlip`, `ppPrint`, `ppDocs`, `ppEdit`, `ppRender` (15759–15803), `VIEWS.ppNal` **15837**. Legacy payroll orders: ACT `payOrders` **7795** (reads `firm.ppAcc`, never written).

**Employees / HR**

| Name | Lines | Purpose |
|---|---|---|
| `EMP_PROMPT`, `readEmployeeDocs` | 6044, 6047 | AI reads contract/M1/ID → employee (fallback rates 18.8 / 1.2 at 6050) |
| `CT_TYPES`, `addMonthsEnd`, `DURS`, `durSel`, `ctDefaults` | 6059–6064 | |
| `contractHTML` | 6066 → 15539 → 15581 → **15605** | Employment contract (duties annex, clients annex, doc code / draft watermark) |
| `extHTML`, `extWarn` | 6086, 6093 | Annex / extension |
| `hrDocs`, `nextHrNo`, `hrRegister` | 6096–6098 | HR register (`docs.type='hr'`) |
| `ctWarnings` | 6110 → **15549** | |
| `ctRender` | 7755 → 15550 → **16134** | Contract editor |
| `CT_POS`, `CT_SP`, `ctDutyList`, `CT_OBL`, `ctPosKey`, `ctClients`, `zzPosOf` | **15517–15523**, 15524, 15538, **15572–15577**, 15578, 15579, 15582 | Positions with duties, special clauses, obligations |
| `ctSpArts` | 15527 → **15580** | |
| `docCode`, `docHead`, `ctCode`, `docReg` | 15585, 15587, 15593, 15595 | Document codes in global `appsettings/doccodes` |
| `DI_VIOL`, `DI_KIND`, `DI_GR`, `diAddM`, `diEmp`, `diRep`, `diDoc`, `diCode`, `diHTML`, `diWarn`, `diRender` | 15617–15660 | Disciplinary measures / termination |

**ПДД (rent, bonuses, services from individuals)** — `PDD_T0` **8314–8316** (two types, hard-coded 4143/22052/23502 and 4490/22053/**2350**), `pddTypes`, `pddT`, `pddCalcG`, `pddCalc`, `pddTot`, `pddEntries` (live in ledger), `pddList`, `pddPeople`, `pddNew`, `pddTypesHTML`, `pddEditor`, `pddPdfHTML` (8317–8354).

**ACT handlers** (last line = effective)
- `savePay2` 7242 → 14410 (rate warning) → **15271** (pay-notes block). `payLockM` 7110 → **15272**. `ppMake` (payroll proposal) 7134 → **15270**. `mpinXml` 7794 and `mpinXlsx` 7790 → wrapped in a loop at **15273**. `plxImp` 14750 → **15274**; `plxTpl` 14743. `payOrders` 7795. `payParams` 7736, `ppAdd` 7741 (parameter row, unrelated to payment orders), `payParSave` 7742, `payParamsApply` 7745.
- ACT literal: `payNewM` 7107, `payOpenM` 7108, `payDelM` 7109, `payPrevM` 7111, `paySifGo` 7112, `payItems` 7113, `payCalcAll` 7114, `payFind` 7115, `payOpenFound` 7117, `payBack` 7118, `payAddEmp` 7119 … `payLineCancel` 7133, `pgK` 7137, `pgXlsx` 7138, `pgPdf` 7141, `m4Xlsx` 7142, `m4Pdf` 7143, `paySifSeed` 7144, `payEmp` 7245, `payRm` 7246, `payLineAdd` 7247, `payLineRm` 7248, `payOpen` 7249, `paySlipPdf` 7250, `paySlipsPdf` 7251, `payRecPdf` 7252.
- Slips/e-mail: `pdNav`/`pdPdf` 8270, `pdPrintAll` 8273, `pdMailAll` 8277, `pdMailGo` 8286 (OA); `pdMailRetry` 14879, `pdOeEd` 14886, `pdOeSet` 14894, `pdOeBack` 14895, `pdOeSave` 14896.
- Pay notes (OA): `pnNew` 15249, `pnEdit` 15250, `pnCancel` 15251, `pnSaveGo` 15252, `pnDone` 15255, `pnUndo` 15256, `pnDel` 15257.
- Batch: `pbScan` 15300, `pbGo` 15301, `pbDel` 15310, `pbExcel` 15314, `pbOpen` 15315 (OA); `pbView` 15331, `pbMpinAll` 15345, `pbMpinOne` 15347.
- MPIN inbox: `mpinClr` 14085, `mpinGo` 14086 → **14117**, `mpinDel` 14125, `mpinRef` 14143, `mpinRe` 14165, `mpinEd` 14167, `mpinEdOk` 14170, `mpinOpenF` 14172.
- Employees: `addEmpNow` 7751, `activateEmp` 7752, `activateAll` 7753, `goPay` 7789. Contracts: `empContract` 7754, `extPdf` 7779, `extSave` 7780, `empExtend` 7783, `hrPdf` 7784, `ctPdf` 7785 → **16124**, `ctSave` 7786 → **15596** (`docReg`), `ctWordT` 16125. Disciplinary: `empDisc` 15683, `diPdf`/`diWord` 15685/15686 → **16116**, `diSave` 15687, `diApply` 15688. ПДД (OA 8359–8375): `pddNewB … pddTypesSave`. Payment orders (OA 15826–15832): `ppNewB`/`ppTax`, `ppSug`, `ppOpen`, `ppSave`, `ppPr`, `ppPrSel`, `ppDel`.

### 6.2 Data shapes

**employees** (6813, 6053, 7786, 15688): `id, no, name, embg, position, oe, city, address, email, netBase, coef, start, stazPrev, stazY, end, contract ('определено'|'неопределено'), bankAcc, bank, mpOps (3.4ц municipality), mpZan (3.4б FZO), mpC26 (0050/0047), hNorm, leaveDays, m1Date, lekDate, bzrDate, active, files[], ct{type, no, signDate, place, start, end, reason, position, posKey, duties, workPlace, hours, probation, gross, net, leave, notice, rep, repRole, sp{}, ncMonths, ncComp, obl, firstStart, hist[]}, endReason, endDocNo`.

**payroll v2** (id `pay-YYYY-MM`; 6156–6160, 7242, 15284): `v:2, month, date (last day), params{avg, minBase, maxBase, exempt, minGross, minNet, pio, zdr, dop, vrab, tax, hours, pfrom}, lines[] ({k,d,p,note} journal snapshot), locked, mpin{no, date, status, gross, total, due, folio, file, docId, at} (14091), fromXlsx, auto, autoMode, autoAt (batch), emps[{empId, no, name, embg, netBase, coef, stazY, grossBase?, hNorm?, short, union, noTax, adv, inout ('full'|'in'|'out'), ioDate, lines[{type, hours, pct, amt, cat (reg|dop|bol|odm|kor|sin), code?, payer?, mpin?}]}]`.

**payroll v1** (implied by 3398): `{employees[{gross}], exempt}` — no writer remains; migrate or reject on import.

**docs**
| type / id | Fields | Lines |
|---|---|---|
| `hr` (`hr-{kind}-{empId}-{no}`) | `kind` (contract / annex / odluka / `di-{warn\|mera\|otkaz\|spog\|quit\|istek…}`), `no, date, empId, empName, ctype, start, end, position, refNo, transform, code, title, snap` | 6098 |
| `pdd` | `date, number, note, rows[{tid, mode ('n'\|gross), amt, embg, name, acct, pid}]` | 8328 |
| `pp` | `kind (pp30\|pp50\|pp10), payer…, purpose, amount, recip, recipAcc, recipBank, refDebit, refCredit, uplSm, prihod, code, nacin, valDate, iban, purId` | 15767 |
| `mpinack` (`mpinack-{mo}`) | acceptance | 14093 |
| `arch` id `mpin-{mo}` | written by **both** 14089 (UJP PDF) and 15353 (MPI3 txt) | |
| journal `mpin-{mo}` | `kind:'mpin'` (posted from acceptance when no payroll exists) | 14092 |

**Firm fields**: `mpinTpl` (6152), `payNotes[]` `{id, mo, type, emp, empId, text, done, doneAt, doneBy, doneMo}`, `payGrpMail` (8296), `hrPrefix` (6109), `pddTypes`, `ppAcc` (read 7798, never written), `opstina, embs, edb, signer, signerRole, lock`.
**Global**: `settings/pay {rows}` (parameter overrides for **all** firms, 7744/7870), `appmpin/{fid}_{mo}` (14122), `appsettings/doccodes` (15595).

### 6.3 Screens

| View | Lines (final **bold**) | Menu |
|---|---|---|
| `plati` | 6265 → 14097 → 14147 → 14778 → 14800 → 14830 → **15259** | Финансово › Плата › Пресметка на плата |
| `vraboteni` | 6813 → 14726 (MPIN code selects) → **15691** (⚖ disciplinary) | Плата › Матични податоци за вработени |
| `payPredlog` | 6266 → **15260** | Плата › Внеси предлог податоци |
| `payGod` | **6274** | Плата › Годишен извештај |
| `payM4` | **6280** | Плата › М4 Образец |
| `pdd` | **8329** | Плата › Закупнина, бонуси и услуги (книжење) |
| `dogovori` | **6099** | Плата › Евиденција на договори |
| `cb_city`, `cb_paysif`, `cb_position` | **6973** (generated) | Плата submenu codebooks |
| `mpinIn` | 14074 → **14142** | 📥 МПИН од УЈП (inserted 14101 under Плата and 14102 under Фирми) |
| `payBatch` | **15316** | 👥 Плати – сите фирми (NAV 15280) |
| `ppNal` | **15837** | Финансово › 💳 Платни налози (NAV 15836) |

### 6.4 Inconsistencies / bugs to fix deliberately

1. **PIO 18.8% vs 19.9% (and vrab 1.2% vs 0.1%)**: `grossFromNet` (6000), `empCalc` (6003), `readEmployeeDocs` (6050) and the payroll table header (7253) fall back to **18.8 / 1.2**; `PAY_DEF` (5993–5995) and `MPIN_SAMPLE` (6120) use **19.9 / 0.1**; v1 `payrollCalc` (3394) hard-codes 18.8/7.5/1.2/0.5. Any `params` missing a key silently uses the old rates. Make parameters required (no fallbacks), sourced from a dated table.
2. **Payroll v1 is dead** (3393–3403) and uses `SCH_OLD` accounts — drop.
3. **`sch()` guard (3177)**: a deliberate `pay_net='2400'` is ignored (→ 2401) while `SCH0.pay_via` defaults to 2400.
4. **`pnSave` name collision**: `async function pnSave(d,quiet)` (9241, travel orders) and `async function pnSave(L)` (15239, pay notes) are both top-level declarations — **15239 wins everywhere**. Travel-order saves (9346, 9366, 9416, 9419, 9420, 9423, 9430, 9433, 9440) call `saveFirmPatch({payNotes:<travel order>})`, **overwrite the firm's pay notes**, never write `pnal/{id}`, and return `undefined`. Both features also share `S.pnEd` and the `pn*` ACT prefix (`ACT_NEED.pnDel` 9336 was meant for travel orders; `ACT.pnDel` is now the pay-note delete 15257). Rename (`travelOrderSave`, `payNoteSave`) and check whether production data contains travel orders inside `payNotes`.
5. **`slipHTML`**: 14805 replaces, 14832 wraps, 14837 replaces again — only 14837 is live.
6. **`MPIN_SAMPLE` (6120) holds a real-looking EDB** and `mpinTpl` auto-applies it to a firm whose EDB ends with it. Move to a test fixture.
7. `mpinExport` archive wrapper (15356) archives even when export was aborted (base returns `undefined` on every path).
8. **MPI3 header mixes sources** (6132): rates from `mpinOfficial` (PAY_DEF only, ignores `settings/pay` overrides); hours `l0[3]` = `P.hours` (168/184…) while the sample has 176 — verify against УЈП; `mpinParamDiff` doesn't compare hours.
9. MPIN codes: template beats employee (`c5 = tp.c5 || E.mpZan`, 6129) but `opsMiss` (14734) checks `E.mpOps` — warning and output can disagree.
10. **Payroll parameter overrides are global** (`settings/pay`), not per firm.
11. **`docs/mpin-{mo}` id collision**: `mpinGo` (14089, full set) and `mpinArchive` (15351–15355) write the same id; `mpinReplace` (14116) then treats the archived txt as an old acceptance.
12. **Possible double booking**: UJP-MPIN inbox posts `journal/mpin-{mo}` when no payroll doc exists (14092); a v2 payroll saved later posts its own `lines`. No cross-check.
13. **Percentages differ between screens**: overtime 150% in `PXL_LINE` (14741) vs 135% in `HTYPES`/`PSIF0` 101; night 135% full line (HTYPES) vs 35% add-on (PSIF0 102); maternity 0% (HTYPES) vs 100% FZO (PSIF0 301).
14. Hour-line handlers: `payLineAdd` (7247) adds a line without `cat`; `payLineRm` (7248) and `pbBuild` 'prev' (15283) use `params.hours` instead of `e.hNorm`; `payLineDel` condition (7130) effectively always true; `monthHours` ignores holidays while `monthSplit` handles them.
15. `hrPdf` (7784) calls `extHTML(e, d.snap.c, …)` for di docs whose `snap` has no `.c` → throws; `VIEWS.dogovori` labels di docs as "Одлука – продолжување".
16. `ctSave` (7786) can save an empty contract number → id `hr-contract-{empId}-` collides later.
17. `docReg` (15595) read-modify-writes one global doc (race, unbounded growth).
18. **Batch path bypasses `save()`**: `pbGo`/`pbDel` (15307/15312) write `firms/{id}/payroll` directly — no lock check, no audit; `mpinGo` (14091) likewise.
19. Payment orders: `payOrders` reads never-written `firm.ppAcc` and labels contributions "ПП53"; `PP_TAX` has no payroll rows.
20. ПДД hard-codes accounts (23502 vs 2350) instead of `sch()`; payroll PIT uses 2340.
21. Small: `BAJRAM` only 2025–2032; dead `const f=…?1:1` in `payDraft` (6159) and `month+'-31'` string bound; unused `c` in `readEmployeeDocs`; `payRateWarn` hard-coded 2027-01; default `leaveDays` 20 repeated at 6053, 6065, 7751, 7786.

## Phase 7 — Stock & retail

Locations, weighted-average stock, moves, stock lists, item cards, trade books (ЕТ / ЕТМ / МЕТГ), КДФИ, levelling (нивелација), promotions, transfers warehouse→store, calculations, retail output, POS, fiscal reports with FIFO/LIFO issue planning, DFI control, production & BOM, barcodes.

Watch first: **`stockAt` signature clash** (item 4.1) and **`prRead` collision** (item 4.2) — both silently break features today.

### 7.1 Functions & constants

**Locations and weighted average**

| Name | Lines (final **bold**) | Purpose |
|---|---|---|
| `SCH0`/`SCH_OLD`/`sch` stock keys | 3174/3176/3177 | stock 6600, material 3100, product 6300, cogs 7010, cogsP 7000, retailStock 6630, **retailMarg 6694**, retailVat 6640, whStock `'660'`, whMarg 6690, retailMethod/whSaleMethod false |
| `STOCK_K` / `COGS_K` | 3178 / 3179 | Getters per item type |
| `retailOn`, `locRow`, `rk(w,key)`, `stockK(w,it)` | **3182** | Retail-price accounting per location; per-location kontos from `codes` rows (`konto, kMarg, kVat`) |
| `locs()` | **3405** | Virtual `main` warehouse + `codes` rows `cb==='warehouse'\|'store'` |
| `whOf`, `locName`, `locOpts`, `locSel`, `kindOf` | 3406–3409, **5166** | `kindOf` is a `const` declared after first use (works by call timing) |
| `stock(itemId,wh)` | **3410** | Σ qty/value over `moves` (skips `pend`); `avg=value/qty`, fallback `item.cost` |
| `postOut(it,qty,date,type,src,label,debitK,wh,extra)` | **3415** | Outbound at average cost (fallback last purchase price; `rawK` items at `costPrice/costPct`); retail mode: D debitK, D Marg, D Vat / P Stock at retail value |
| `clearMoves(src)` | **3425** | Deletes moves `src===x` or `src` starting `x-` |
| `stockAt` | 4914 `(id,date,wh)` (dead) / **13858** `(itemId,wh,date,before)` (hoisted winner) | See item 4.1 |
| `trk`, `retailP`, `priceAt` | 4912, 4913, **4988** | Stock items; retail price `it.sp[wh]` or price·(1+rate); price on a date rebuilt from `nivel` docs |
| `unitCost(it)` | **5629** | Recursive BOM cost + `labor` (no cycle guard) |
| `reaverage()` + ACT `runUprosek` | **5101**, 7365 | Re-runs weighted average by date per item/location; fixes `transfer-in` and production (hard-coded 6300/6000/4900) |

**Stock lists, cards, trade books, КДФИ**

| Name | Lines | Purpose |
|---|---|---|
| `LAGER` | **4918–4923** | Columns for g_lager / g_lagerk / m_lager / m_lagerp (needs `inQ,outQ,inV,outV`) |
| `lagerData`, `lagerTable`, `lagerSum`, `lagerView` | 4924, 4927, 4930, 4964 | Stock list at a date |
| `lagImpHTML`, `lagParse`, `lagImport`, `lagAoa`, `lagSave` | 4935–4960 | Excel import (`in`; `pop` → `mout` draft; `price` → `nivel` draft) / export |
| ACT `lagerXlsx`, `lagImpOpen/Close/Pick`, `lagTpl`, `lagImpGo` | 7918–7926 (OA) | |
| ACT `lagerPdf`, `stockPdf`, `stockCsv`, `card`, `cardsPdf` | 7360, 7304, 7221, 7220, 7305 | |
| ACT `lgDel` | **17006** | Admin bulk delete of moves + prenos/nivel/purchase lines |
| `kartData`, `kartTable`, `kartView` + ACT `kartPdf`/`kartAllPdf` | 4973, 4979, 4981; 7361/7362 | Item card at cost or retail |
| `trgData`, `trgTable`, `trgView` | 4990, 5001, 5005 | ЕТ (wholesale, cost) / ЕТМ (retail value + Z + nivel) |
| `inFirst`, `moveDoc(m)` | 5013, 5014 | `move.src` prefix → document |
| `etData`, `etTable` | **5022**, 5034 | Official ЕТ form per store (moves, nivel, `sales.days[]`) |
| `metgData`, `metgHTML` | **5043**, 5045 | МЕТГ quantity card per item/warehouse |
| `ET_ACT` | **5055–5073** (extended 5227, 5348; merged 7740) | Mostly archive/backup handlers; only `etPdf` 5071, `metgPdf` 5072, `metgAllPdf` 5073 belong here |
| ACT `trgPdf` | 7363 | |
| `kdfiDay` / `kdfiRows` | 5077 / 5080 (dead) → **11470** / **11469** (hoisted winners; read `sales.days[]`) | КДФИ day rows |
| `KH`, `kv`, `kRow`, `kSum`, `kdfiTable`, `kdfiOfficial` + ACT `kdfiPdf` | 5081–5087; 7364 | Official КДФИ-01 layout |

**Levelling, promotions, transfers, calculations, retail output, POS**

| Name | Lines | Purpose |
|---|---|---|
| `nivRowDiff`, `nivelHTML` (listener `[data-nv]` 5149) | 5151, 5155 | |
| `nivNextNo` | 5798 (count+1; same formula inlined at 4399, 7374, 13213, 13215) | |
| `nivItemBy` | 13185 | |
| ACT `saveNivel` | 7373 (dead) → 13211 (replacement) → 17180 (wrapper: progress, `akTo`) → **17188** (correction when `editId`) | |
| ACT `nivelPdf`, `nivTpl`, `nivImp`, `nivAdd`, `nivMk`, `nivEdit`, `nivDel`, `nivCancel`, `nvApply`, `nvClear` | 7377, 13186, 13188, 13194, 13221, 13228, 13230, 13234, 17445, 17448 | |
| `akDay`, `akSt`, `akCost`, `akEditor`, `akNewPrice`, `akDocHTML`, `akMakeNiv` | 5799–5834 | Promotions (create `nivel` docs, update `item.sp[wh]`) |
| ACT `akNew`, `akEdit`, `akAll`, `akcSave`, `akStart`, `akEnd`, `akDel`, `akPdf` | 7899–7913 (OA) | (`akRole/akBulk/akSave` 8468–8470 are raw-material roles — different feature) |
| `prNo`, `prPseudo`, `prTotals`, `prTable`, `prNextNo`, `prNew`, `prAvg`, `prAddCalc` | 5547–5552, 5555, 5577 | Transfers warehouse → store |
| `prRead` | 5553 (transfer form reader) — **overridden by 7703** (AOP rules editor) | See item 4.2 |
| `PR_ACT` | **5579–5610** (merged 7740) | `prNewBtn`, `prFromCalc`, `prCancel`, `prRm`, `prAllStock`, `prKeep`, `prMargin`, `prPdf`, `prPlt`, `prDel` |
| ACT `prSave` | 5595 (PR_ACT) → **17396** | Parallel save per item |
| `prnKonta`, `prnLines`, `prnMissing` + ACT `prnPost` | 17413, 17414, 17416; 17417 | Transfer GL: D 6630 / P stockK(from) / P 6690 / P 6640; back-posts old transfers |
| `kalkState`, `kalkFilter`, `ksSel`, `ksNeed` | 5167, 5168, 17281, 17292 | |
| ACT `ksClr`, `ksPren`, `ksInv`, `ksMerge`, `ksBook`, `ksET`, `ksDel`, `kalkPdf`, `kalkPlt`, `kalkListPdf` | 17293–17308; 7287–7289 | |
| `MOUT`, `moKonto`, `moStores`, `moNextNo`, `moOwn`, `moAvail`, `moLineVal`, `moEditor`, `MO_COL`, `moCols`, `moImport`, `moTplDl`, `moFindItem`, `moSaveDoc`, `moPdfHTML` | **5699**–5789 | Retail output: sale, inv, ret, otp (write-off), pop (stock count) |
| ACT `moNew`, `moInv`, `moEdit`, `moDel`, `moAdd`, `moRm`, `moImp`, `moTpl`, `moSave`, `moPdf` | 7879–7888 (OA) | |
| `posSell` | 5838 (declaration) → **9940** (discount / loyalty / coupon wrapper) | Writes `sales` day doc `z-{wh-}date`, `postOut` `type:'sale'` src `pos-…`; explodes BOM when a product is short |
| ACT `posAdd`, `posRm`, `posSell`, `posFile` | 7227–7230 | |

**Fiscal reports and DFI control**

| Name | Lines | Purpose |
|---|---|---|
| `FISK_PROMPT`, `FISK_G0`, `fkN`, `fkNormDate` | **11342–11345** | Group map А 18, Б 5, В 0, Г 10; locale-aware number parser |
| `fkRows`, `fkCheck`, `fkRows2` | 11346, 11351, 11393 | |
| `fiskEntries(z)` | 11354 → 13070 (POS partner on card line) → **13093** (`fisk.sc` scheme) | |
| `fkAlloc`, `fkIssuePlan`, `fkIssueHTML` | **11399**, 11407, 11436 | Choose goods to issue for the turnover (FIFO / LIFO / proportional) |
| `fkSpread`, `fkDayRates`, `fkMetgDays` | 11461–11463 | Spread a periodic report over days |
| `fkFix`, `fkCanvasOf`, `fkPdfCanvases`, `fkTiles`, `FK_TILE_NOTE`, `fkImg`, `FK_LAT`, `fkFromText`, `fkApplyText`, `FK_SIMPLE` | 12991–13034 | OCR / AI reading of long receipts |
| `FK_SC`, `fkScDef`, `fkCashK`, `fkNoVatEvid` | **13090**, 13091, 13092, 13115 | Schemes `trgNoVat`, `usl`, `trg` |
| ACT `fkRead` | 11377 → 12995 → 13028 → 13035 → **13116** | |
| ACT `fkPost` | 11384 → 11448 (replacement) → 12996 → 13071 → **13101** | |
| ACT `fkManual` | 11446 → **13048** (replacement) | |
| ACT `fkClear` / `fkIssue` / `fkTab` | 11376 / 11454 / 11533 | |
| `dfiDays`, `dfiControl`, `dDiffD` | 11475, **11479**, 11498 | Missing Z, Z gaps/duplicates, cash limit, undeposited cash, card receivables (1009) |
| `fkDevices`, `FK_BRANDS`, `devHTML` + ACT `devAdd/devEdit/devCancel/devSave/devDel` | 11499, 11500, 11511; 11534–11538 | Fiscal devices |
| `dfiHTML` | 11501 → **13131** | |
| `dfiStart` | 13130 | Control starts at first fiscal report |
| `ACT.metgDemo`, `ACT.prodDemo` | 13155, 16959 | Admin demo data (`demo:true`) |

**Production, BOM, lots, barcodes**

| Name | Lines | Purpose |
|---|---|---|
| `readBom`, `runProd` | 5644, **5669** | `prod-out` D 6000 / P stock; labour D 6000 / P 4900; `prod-in` D 6300 / P 6000 (hard-coded) |
| ACT `addBom` 7222 → **13901**, `rmBom` 7223, `saveBom` 7224 → **13902**, `runProd` 7225, `delProd` 7226, `bomAI` 13860 | | AI-suggested BOM |
| `rnItems`, `VIEWS.rasNorm` + ACT `rnPost`/`rnDel` | 13868, **13870**; 13890/13896 | Write-off without BOM (`docs.type='rasnorm'`) |
| `pnbPlan` + ACT `pnbRun` | 13922; 13933 | Materials as % of sale price |
| `pcOpts`, `pcFind`, `pcLbl`, `pcAddLines`, `pcImport` + ACT `pcOn`, `pcOff`, `pcRm`, `pcRun`, `pcQuickAdd`, `pcAdd` (13959 → **13992**) | 13947–13980 | Custom materials per work order |
| ACT `prodTab`, `go` wrapper | 13942, 13943 | |
| `mrpCalc`, `mrpDemand`, `lotIns`, `lotBal` (FEFO, all locations) | 9994, 9999, 10024, 10026 | See Phase 10 |
| `EAN_L/G/R/P`, `eanCheck`, `eanValid`, `eanSVG`, `eanPNG`, `eanNextInternal` + ACT `bkGen`…`bkClr` | 9186–9200; 9216–9220 | EAN-13 and labels (`bk*` prefix clash with backup/bank) |

### 7.2 Data shapes

**moves** (`save('moves',…)`: 3423, 4390, 5675, 5787, 17403): `{id, date, item, qty, value, type, src, label, wh, lines[{k,d,p,…}], pend?, partner?}` — item field is **`item`** (not `itemId`); `qty`/`value` **signed** (negative = out); **no price** (`avg = value/qty`). Ids: `src+'-'+itemId+'-'+type` (postOut), `pur-{id}-{i}-{item}`, `{src}-in`. Types: `in, sale, transfer, transfer-in, prod-out, prod-in, mat-out, return, writeoff, popis, popis-in, supret, dispatch, use`. `src` prefixes: `pur-`, `inv-{id}-{i}`, `isp-`, `prn-`, `pos-`, `mo-{docId}-{ix}`, `prod-`, `rn-`, `mv-`, `scr-`, `op-`. `inn` is computed, not stored. Client-role moves get `pend:true` (3301) and are never approved by the approval path (3302 excludes moves).

**production** (5677, 13892, 13935, 13963): `{id:'prod-…'|'rn-…', date, product, qty, mat, lab, unit, noBom?, pct?, custom?}`; its move is `id+'-in'`.

**items** (stock fields): `type, price (net), rate, sp{whId: retail incl. VAT}, cost, costPrice, costPct, rawK, bom[{item,qty}], labor, unit, min, code, barcode, konto, mk (Macedonian product, КДФИ), active`.

**Locations**: `codes` rows `cb:'warehouse'|'store'` `{id, code, name, konto, kMarg, kVat}` + virtual `main` (not a firm field).

**docs**
| type | Fields | Lines |
|---|---|---|
| `nivel` | `number, date, wh, lines[{item, qty, old, new, qtyImp?}], note?, akTo?, akBack?, akc?, corrBy?, corrAt?, demo?` | 7375, 13214, 13216, 17191, 5835 |
| `prenos` | `id:src, number, date, from, to, src:'prn-…', lines[{item, qty, nabU, sp}]` | 17407 |
| `mout` | `t, wh, date, number, lines[{item,qty,price?,rate?,val} \| {item,sys,cnt,diff,sp}], partner?, konto, konto2, note, fisk?, method?, zref?` | 5772, 11456 |
| `akcija` | `name, wh, from, to, pct, rnd, lines[{item,old,new}], status ('plan'\|'active'\|'done'), number, date, nivStart?, nivEnd?` | 7905 |
| `rasnorm` | `date, from, to, mode, pct, total, prod, pq, wh, items[]` | 13893 |

**sales** (daily Z / fiscal reports; 5840, 11450, 13100): `{id:'z-{wh-}date'|'zf-{wh-}date'|'mo-{docId}', date, wh, groups[{rate,konto,base,vat}], total, count, mk{rate:{g,v}}, lines, card, cardKonto, nonVat, days[{date,total,z,g{},v{},est}], fisk{device, z, cash, card, storno, from, to, periodic, sc, cashK, rev, nonVat}, files, moNo, mout}`.

**Firm fields**: `fiskOpt{wh, konto, cardK, sc, cashK, meth, offDays, cashMax, depDays}`, `fiskDev[]{serial,…}`, `lotDays`, `pcost{oh,basis}`, `prodRawK`, `sch{…}`, `lock`.

### 7.3 Screens

| View | Lines (final **bold**) | Menu |
|---|---|---|
| `g_lager`, `g_lagerk`, `m_lager`, `m_lagerp` | 4971 (loop) → **16998** (admin-select loop) | Материјално › Лагер листа / скратена; Малопродажба › Лагер листа / проширена |
| `g_kartica` / `m_kartica` | **4986** | Материјална картица / Картица на производ |
| `g_trgv` | **5010** | Трговска книга на големо (ЕТ) |
| `m_trg` | 5010 (ЕТМ) → 5039 (`etData` form, replaces) → **13181** | Малопродажба › Евиденција во трговијата на мало (МЕТГ) |
| `g_trg` | **5050** | Други прегледи › Количинска евиденција по артикл |
| `kdfi` | 5099 → **13143** | КДФИ-01 |
| `uprosek` | **5113** | Упросечување |
| `nivel` | 5137 → 13196 → 17193 → **17433** | Нивелација |
| `kalk`, `kalkG`, `kalkM`, `kalkCalc` | see Phase 3 | Влезни калкулации / Калкулатор на цена |
| `prenosi` | 5556 → **17419** | Пренос во продавница / Пренос од магацин |
| `zaliha` | **4890** | Приемници и издатници |
| `poobjekti` | **5156** | Резултат по објекти |
| `kasa` | 5680 → **9937** | Каса |
| `m_izlez` | **5706** | Излез (продажба, повратница, отпис, попис) |
| `m_akcii` | **5802** | Акции и попусти |
| `fiskPer` | 11355 → 11411 (replacement) → 11528 → 13043 → 13084 → 13103 → 13110 → 13119 → 13132 → **13151** | 📠 Фискални извештаи (рачна каса) |
| `normativ` | 5632 → 13866 → 13903 → 13906 → **13914** | 🏭 Производство |
| `prod` | 5647 → 13898 → 13918 → 13924 → 13939 → 13945 → 13949 → 13970 → **13986** | 🏭 Производство |
| `rasNorm` | **13870** (added to menu by `setTimeout` 13897) | 🏭 Производство |
| `mrp` / `prodCost` / `lotovi` | **10000** / **10015** / **10027** | 🏭 Производство (Phase 10) |
| `barkodi`, `artQ` | **9201**, 11276 → **11338** | Шифрарник |

NAV: 16983–16985 moves `normativ, prod, mrp, prodCost, lotovi` into a "🏭 Производство" submenu in Материјално and copies it into Малопродажба.

### 7.4 Inconsistencies / bugs to fix deliberately

1. **`stockAt` signature clash (critical)**: the effective function (13858) takes `(itemId, wh, date, before)`, but every caller except 13871 uses the old order `(id, date, wh)`: 4395, 4926, 5139, 5153, 5555, 5563, 5577, 5591, 5597, 5704, 5810, 5834, 7929, 11400, 11436, 13172, 13174, 13199, 13203, 13212, 17189, 17399. The date lands in `wh`, every move is skipped → qty 0, avg = `item.cost`. 13858 also lacks `inQ/outQ/inV/outV`, so LAGER columns are undefined. Affects lager lists, levelling quantities, transfer stock checks, `moAvail`, `fkAlloc`, promotions. Port as one `stockAt({item, wh, date, inclusive})` excluding `pend`, returning in/out totals.
2. **`prRead` collision**: `function prRead` 5553 (transfer form reader) is overridden by `function prRead` 7703 (AOP rules editor). All transfer calls (5573–5578, 5590–5595, `prSave` 17396, change listener) read nothing — date, locations, quantities and prices typed into a transfer are never read into the draft. Also `prAdd/prReset/prTpl` (7726–7730) are AOP handlers and `akSave/akRole` (8468–8470) are not promotions — rename namespaces.
3. `kdfiDay`/`kdfiRows` redeclared (5077/5080 dead; 11469/11470 live).
4. **Margin account drift**: `sch('retailMarg')` → 6694 (a firm value 6690 is ignored as `SCH_OLD`), but `prnKonta` (17413) reads `firm.sch` directly with default **6690**, `fiskEntries` trgNoVat hard-codes 6690/6630 (13097), ledger nivel posting (3461) uses `prnKonta`. Sales hit 6694, transfers/levellings 6690.
5. **Transfer posting asymmetry**: `prnLines` posts D 6630 (retail incl. VAT) / P stockK(from) / P 6690 / P 6640 for any store regardless of `retailMethod`; `postOut` uses retail kontos only when `retailOn(wh)` (default false) → with defaults 6630 never clears. Transfer-out move has no lines; warehouse→warehouse with different kontos posts nothing; `prnLines` applies VAT only if `firm.ddv` (old `prSave` 5599 always did).
6. **FIFO/LIFO is cosmetic**: `fkAlloc` (11399) uses FIFO/LIFO only to choose which items to issue (sized by retail `priceAt`); `fkIssue` values them through `postOut` at weighted average. Decide on one costing policy.
7. **`trgNoVat` scheme** books D 6690 / P 6630 for the whole retail total (13097), creates no item moves, hides "2. Излез на стока" (13103): 6630 falls while lager quantities stay; no COGS.
8. **Hard-coded production kontos** 6000/6300/4900 (and 4000 in `rnPost`) in `runProd` 5674, `pnbRun`, `pcRun`, `rnPost`, `reaverage` 5108 — `sch('product')`/`COGS_K` ignored.
9. **Count+1 numbering** for `nivel` (5798, 7374, 13213, 13215) and `akcija` (7905) collides after deletes; `saveNivel` 13211 waits 300 ms between two numbered saves.
10. **ЕТ/ЕТМ/МЕТГ naming mix-up**: `m_trg` was ЕТМ (5010), replaced by the ЕТ form (5039) titled "…на мало (МЕТГ)"; МЕТГ is really the wholesale quantity card (`g_trg`, `metgData`). `trgView(true)` now reachable only via `ACT.trgPdf`.
11. **Item reference field drift**: moves/docs `item`, POS cart and invoices `itemId`; `lgDel` checks both (17016).
12. `lgDel` (17006) with a location filter leaves the paired transfer move at the other location.
13. Old `stockAt` 4914 did not skip `pend` while `stock()` does; `unitCost` no cycle guard; `lotBal` ignores location; `whStock:'660'` (3-digit typo); `ET_ACT` mixes archive/backup with trade-book PDFs; fiscal side effects live in `save` wrappers (13072, 13100).

## Phase 8 — Year-end

Covers fixed assets & depreciation, close/open year, AOP statements (ЦРМ forms 35–38), ДБ / ДБ-ВП, ЦРСМ XML export/import, NPO and sole-trader variants, and the phase gate (`zcFindings`).

### 8.1 Functions & constants

**Fixed assets**

| Name | Lines (final **bold**) | Purpose |
|---|---|---|
| `DEP_PRESETS` | **3183** | `[konto, label, rate%]`: 0120 / 0130 / 0140 / 0150 (0130 listed twice) |
| `VIEWS.os` | **5850** | Asset register, search by inv. no / barcode / QR, `runDep` button |
| `depFor(year)` | **5861** | Straight-line monthly depreciation (from month after `date`, capped at cost) → `{rows:[{id,year,acc,konto}],total}` |
| `OS_DOCT`, `osNextInv`, `osDocs` | **8625**, **8626**, **8627** | Asset document types, next 4-digit inventory no., `docs` with `type:'arch'&&asset===id` |
| `osDays`, `osExpList`, `osBadge` | **8628–8630** | Expiry checks (registration, insurance, technical, `doc.validTo`; ≤30 days) |
| `osEditorHTML`, `osLabelsHTML`, `osUpload`, `osPhotoUp`, `osViewHTML`, `osCardHTML` | **8631**, **8656**, **8657**, **8662**, **8665**, **8676** | Editor, QR labels (`'OS\|code\|name'`), uploads, view modal, PDF card |
| ACT `newAsset` `editAsset` `saveAsset` `delAsset` `osLabel` `osLabelsAll` `osDocDel` `runDep` | **7231–7238** (ACT literal) | CRUD; `runDep` posts journal `dep-YYYY` |
| ACT `osPdf` | **7310** | Register PDF |
| ACT `osView` `osEditFromView` `osCardPdf` `osPhDel` | **8681–8685** (OA) | |

**Close / open year**

| Name | Lines | Purpose |
|---|---|---|
| `VIEWS.mbyllja` | 6694; wrapper **11176** (adds ZS_PH bar) | Close screen with pre-checks; tax from ДБ when `dbAdj[Y]` non-empty |
| `closeYear()` | **6732** | 4/7 → 8000 → 8200; tax 8100/2330; net → 951/961; saves journal `close-Y` |
| `openYear(Yf)` | **6744** | Carries classes 0,1,2,3,6,9 (12/22 by partner) → `open-(Y+1)` via `obResLines` |
| `VIEWS.prenos` | 6757; wrapper **11176** | Carry-forward screen |
| `obResK` / `obResLines` | **12386** / **12387** | 951→950, 961→960, nets 950/960 (skipped when `S.obFull`) |
| `obAi` wrapper (951/961 remap on import) | **12390** | Same remap for imported opening rows |
| ACT `closeYear` | 7379; wrapper **11233** (`zcGate`) | |
| ACT `undoClose` | **7380** | Deletes `close-Y` — no confirmation, no gate |
| ACT `openYear` / `doTransfer` | **7381** / **7325** | Both call `openYear` |
| ACT `lockYear` | **7382** | Direct `firms/{id}.lock = Y-12-31` (no audit) |
| ACT `goYear` | 7326, **7788** | Year switch |
| ACT `firmUnlock` | **17021** | Admin: lock back to (Y-1)-12-31 |
| ACT `npoClose` / `npoUnclose` | **10486** / **10491** | NPO close |
| `obRebuild(rows)` | **17158** (+ obAi wrapper 17171, obCtlHTML 17172, ACT.saveOpen wrapper 17173, ACT.bbImpDel wrapper 17176) | Trial balance imported *after* close: rebuilds 4/7 and saves `close-Y` with `imported:true` |

**Simple statements (old path)**

| Name | Lines | Purpose |
|---|---|---|
| `POS_BS` / `POS_IS` | **3626–3638** / **3639–3651** | `[code, name, prefixes\|null, sign]` |
| `statements()` | **3652** | IS from ledger excl. `close`; BS from full ledger (adds profit to P1 if not closed) |
| `VIEWS.vjetore` | 6772; wrapper **11176** | "Годишна сметка (стар XML)" |
| `gsXml()` | **6791** | Old `<GodisnaSmetka>` XML from `f.aop[code]` |
| ACT `gsPdf` / `gsXml` / `gsCsv` | **7307** / **7383** / **7384** | |

**AOP engine (ЦРМ forms 36 Биланс на успех / 37 Биланс на состојба)**

| Name | Lines | Purpose |
|---|---|---|
| `ZS_DEF` | **7411–7617** | Default AOP rules (bu 201…, bs 001–112); mapped at 7617 to `{r,aop,n,k,s,f}` |
| `ZS_FIX` | **7618** | Forced formulas bs001/036/063/081/111 (unless `custom`) |
| `zsRules()` | **7619** | `firm.zsRules` else ZS_DEF; applies ZS_FIX, appends missing rows, caches in non-enumerable `_fx` |
| `zsCompute(year)` | 7620 (base) → 10939/**10940** (manual `zsMan` wrapper) → **17099** (final: "АОП без дени" rounding) | `{V:{'bu201':…,'bs063':…},closed,st,manual?,rounded?}` |
| `ZS_MENU` | **7638** (+ splice/push 10880, 11064, 11101, 11139) | Legacy menu; `VIEWS[id]=zsView(id)` at 7711 |
| `zsTabs` / `zsHead` / `zsYearsNote` | 7639 / 7640 / 7641 | `zsTabs` → `zsPhBar` |
| `zsTable(rep)` | **7642** | Current + previous year |
| `zsPdfTable(rep,t)` | 7644 (dead), 10722 (dead), **10745** (hoisted winner → `zsCrmHTML(rep)`, ignores `t`) | |
| `zsV`, `spData`, `deData` | **7645**, **7652**, **7655** | Value lookup; revenue by activity (`f.actMap`); old statistics list (only `dePdf`/`deCsv` 7720/7721 and bank package 8151) |
| `dbData()` | 7646 (dead, old 9-item ДБ), **10829** (hoisted winner, УЈП 6-2020 АОП 01–70) | |
| `DB_ND` | **7651** | Legacy non-deductible keys (dead code + `DB_MIG`) |
| `saveFirmPatch(patch)` | **7661** | `Object.assign(firm)` + `firms/{id}.update` |
| `zsView(id)` | **7662** | Factory for zs_bu/bs/skr/db/vp/de/sp/aop/pr (zs_db branch has dead `if(0)`) |
| `prRow` / `prRead` / `prImport` | 7702 / **7703** / 7704 | AOP rule editor (note `prRead` name collides with transfers `prRead` 5553 — see Phase 7) |
| ACT Object.assign block | **7712–7730** | `zsPdf` 7713 (superseded), `zsCsv`, `zsSkrPdf`, `dbSave` 7717 / `dbPdf` 7718 / `vpPdf` 7719 (superseded), `dePdf`, `deCsv`, `spSave`, `spPdf`, `aopCsv`, `aopXml`, `prAdd`, `zprDel`, `zprSave`, `prReset`, `prTpl` |
| `zsOffHTML(rep)` / `zsCrmHTML(rep)` | **10696** / **10727** | Official paper form / ЦРМ e-submission layout |
| ACT `zsPdf` | 7713, 10723, **10743** (`data-f="prav"` → `zsOffHTML`, else `zsCrmHTML`) | |
| ACT `zsPrev` | 10724, **10744** | Preview toggle |

**ДБ / ДБ-ВП / ТП / НПО**

| Name | Lines | Purpose |
|---|---|---|
| `DB_F` | **10748–10827** | ДБ (УЈП 6-2020) rows |
| `DB_MIG` | **10828** | Old keys → AOP (`dnevn→04, rep→15, …, akont→57`) |
| `dbEdb`, `dbFormHTML` | **10843**, **10844** | EDB with "МК" prefix; print form |
| `ZS_VIEW_DB` (var) | **10866** | `zs_db` screen (onchange writes DB directly) |
| ACT `dbSave` / `dbPdf` / `dbPrev` | **10875** / **10876** / **10877** | |
| `vpData` / `vpFormHTML` | **17105** / **17109** | ДБ-ВП (1% on gross income 3–6 M) |
| `VIEWS.zs_vp` | 7711 (zsView), **17138** (full replacement) | |
| ACT `vpSave` / `vpPrev` / `vpPdf` | **17152** / **17153** / **17154** | |
| `DLD_ND`, `tpData`, `VIEWS.zsTP`, `tpBookHTML` | **10496**, **10497**, **10499**, **10512** | Sole trader: Образец Б + ДЛД-ДБ, books КП/КТ/КО/КПС |
| ACT `tpBook` / `tpSave` / `tpPdf` | **10516–10520** | |
| `NPO_ACC`, `NPO_SCH`, `NPO_BS`, `NPO_PR`, `NPO_CO` | **10412–10420**, **10421**, **10423–10435**, **10436–10443**, **10444–10449** | NPO chart (Сл. весник 117/05), posting scheme, forms, company→NPO AOP map |
| `npoMode(f)` | **10450** | `'npo'` if `f.accounts['730']` exists |
| `npoCompute` / `npoDb` / `npoTable` / `VIEWS.zsNPO` | **10451** / **10460** / **10462** / **10463** | |
| ACT `npT` `npoPlan` `npoClose` `npoUnclose` `npoPdf` `npoIzj` | **10484–10493** | |

**Entity type, deadlines, phases**

| Name | Lines | Purpose |
|---|---|---|
| `LF_OPTS`, `LF_ENT`, `lfGuess` | 10401, 10402, 10403 | Legal form → entity |
| `ENT`, `entGuess`, `entOf`, `ENT_N` | **10405**, 10406, **10407**, 10408 | co / tp / sd / npo |
| `ENT_V` | **10409** (+10936, 11064, 11108, 11150) | View → allowed entity types; `viewOn` wrapper **10410** |
| `VIEWS.zsRok` | 10523; wrapper **11176** | What / where / when to file |
| `ZS_PH`, `ZS_SUBN`, `zsPhDone`, `zsPhBar` | **11157–11167**, **11168**, **11169**, **11171** | Phase bar 0–8 + "Алатки" |

**Control, notes, manual amounts**

| Name | Lines | Purpose |
|---|---|---|
| `ZK_SIDE`, `zkExpect`, `zkMapped`, `zkData` | **10881**, **10882**, **10884**, **10885** | Sign logic per class, unmapped accounts, AOP cross-checks |
| `VIEWS.zsKontrola` | 10893 → 11070 (ЦРМ rules card) → **11236** (inserts `zcHTML`) | |
| ACT `zkCard` | **10903** | |
| `BEL`, `belAuto`, `belHTML`, `VIEWS.zsBel` | **10905–10918**, **10919**, **10924**, **10929** | Explanatory notes (prev. year from `belSnap`) |
| ACT `belSave` / `belReset` / `belPdf` | **10932** / 10933 / **10934** | |
| `zmHasLedger`, `zmBox`, `zmEditTable`, `zmSave`, `zmImport` | **10944**, **10945**, **10950**, **10952**, **10953** | Prior-year amounts from another program (Excel/CSV/PDF via AI) |
| ACT `zmEdit` / `zmClear` | **10968** / 10969 | |
| zs_bu / zs_bs `zmBox` wrapper | **10971–10972** | |

**ЦРМ e-annual account**

| Name | Lines | Purpose |
|---|---|---|
| `DE38`, `DE38_AUTO`, `deAuto`, `deVals` | **10976–10979**, **10981–10985**, **10986**, **10990** | Form 38 (AOP 601–724) |
| `NKD35`, `nkd5`, `NKD21`, `nkd21Aop` | **10992**, **10993**, **10995**, **10996** | Form 35: AOP = 4000 + NACE Rev 2.1 class index |
| `f35Rows`, `f35HTML` | **10997**, **11049**; `zs_sp` wrapper **11051** | |
| `crmRules(year)` | **11001** | ЦРМ rules 2000–2349, 2600–2712 → `[no, text, 'warn'?]` |
| `crmXml(year,opt)` | **11022** | `<AnnualAccount>` Operation 450, forms 35–38, AATypeID 122, DocTypeID 110 |
| `VIEWS.zs_de` | 7711 (superseded), **11044** | Form 38 editor |
| `VIEWS.zsXml` | 11053; wrapper **17039** (import box) | |
| ACT `crmXmlDl` | 11066; wrapper **11234** (`zcGate`) | |
| ACT `deSave` / `deReset` | **11067** / **11068** | |
| `crmXmlImport(file)` | **17027** | Accepted ЦРМ XML → `zsMan`, `deMan`, `f35Raw`, `crmPeriod`, `nkdAop` |
| ACT `crmXClr` | **17043** | Removes imported amounts |

**Filing procedure, archive, dossier, phase gate**

| Name | Lines | Purpose |
|---|---|---|
| `zpCapture`, `zpSize`, `ZP_ARCH` | **11075**, **11076**, **11077** | Capture PDF output |
| `zpArchive` | 11078 (dead), **11118** (hoisted winner; via `zyAdd` role `bel`) | Saves notes PDF, `belSnap`, `zsArch` |
| `VIEWS.zsProc` | 11089 (dead) → 11140 wrapper (dead) → **11178** (plain reassignment) → 11237 wrapper → **17093** wrapper (npDist) | |
| ACT `zpArch` `zpGo` `zpBelPdf` `zpDbPdf` | **11103–11106** | |
| `ZY_ROLES`, `zyNeed`, `zyDoc`, `zyAdd`, `zyGenerate`, `zyCard`, `VIEWS.zsDos` | **11111**, 11112, 11113, 11114, 11122, 11127, **11132** | Per-year dossier |
| ACT `zyGen` | 11148; wrapper **11235** | |
| ACT `zySelClr` `zySelY` `zyToPkg` | **11152–11155** | |
| `zcFindings(Y)` | 11196; wrapper **16884** (adds `izvYearEnd`) | Blocking findings before close |
| `zcOpen` / `zcGate` / `zcHTML` | **11221** / **11222** / 11223 + wrapper **17092** | |
| ACT `zcGo` | 11228; wrapper **17096** | |
| ACT `zcAck` / `zcUnack` | **11229** / **11230** | `firm.zsAck` |
| `izvYearEnd(Y)` | **16882** | Last bank statement of the year must be dated 31.12 |
| `npLines` `npModal` `npSrcHTML` `npImport` `npTot` | **17047**, 17048, 17059, 17068, 17075 | Distribute 12/22 balances without partner |
| ACT `npDist` `npAdd` `npRm` `npAll` `npSave` | **17077–17083** | |

### 8.2 Data shapes

**`assets`** (saveAsset 7233, osPhotoUp 8662): `{id, name, konto, rate, date, cost, invNo, serial, barcode, supplier, invDoc, location, vehicle, plate, regExp, insExp, techExp, fuelNorm, capKg, odo, oilEvery, oilLastKm, tyreEvery, tyreLastKm, photos:[{id,name,type}]}`. Rent-a-car adds `rent` and fleet price fields (Phase 10); transport adds `trailer`. `vehicleOnly` is read by `zcFindings` but never written. Attached documents live in `docs` as `{type:'arch', asset:id, sub, title, number, validTo, date, partnerName, files:[{id,name,type,size}]}` (8657).

**Journal documents created here** (collection `journal`):

| id | kind | Where | Shape |
|---|---|---|---|
| `dep-YYYY` | `amort` | 7239 | date Y-12-31; lines `[{k:'4300',d},{k:'0190',p}]`; `detail: depFor().rows` |
| `close-YYYY` | `close` | 6742 | `{date:Y-12-31, desc, lines, profit, tax, net, nondeductible}` — accounts 8000/8200/8100/2330/951/961 |
| `close-YYYY` (NPO) | `close` | 10489 | `{…, profit:sur, tax, npo:true}` — **no `net`**; 800/810 + (co: 2330/951/961, npo: 245/970/092) |
| `close-YYYY` (imported) | `close` | 17171 | `{imported:true, lines, profit, tax, net}` with 800 |
| `open-(Y+1)` | `open` | 6750 | date (Y+1)-01-01; lines `{k,d,p,partner?}` after `obResLines` |
| `bbimp-YYYY` | `bbimp` | 7332 | Imported full-year trial balance (read by `MONTHS`/`INV0` tokens) |

**Firm fields** (mostly via `saveFirmPatch`): `zsRules [{r,aop,n,k,s,f,custom?}]` (7728); `zsMan {year:{'bs001':int,…}}` (10952, 10969, 17035, 17043); `dbAdj {year:{'03'..'70':num}}` (10871 direct write, 10875); `vpAdj {year:{'01','07',nace,naceN,desc,inv,form,gdvp}}` (17152); `dldAdj {year:{amort,rep,kazni,car,pers,don,dnev,other,red,ak,tax}}` (10518); `deMan {year:{601:int}}` (11067, 17035); `f35Raw {year:{aop:int}}` (17035); `f35Man` (read 10997, never written); `nkdAop {'46.900':4xxx}` (11051, 17036); `actMap {konto:nkd}` (7722); `zsNotes {year:{belId:text,_saved}}` (10932); `belSnap`, `zsArch` (11120); `zsAck {year:{key:{note,by,at}}}` (11229); `crmPeriod`, `lock`, `ent`, `lf`, `accounts`, `sch`, `aop`.

**Tuple formats (for seed JSON)**
- `ZS_DEF` row: `[report 'bu'|'bs', aop '201', name, konta, sign 1|-1, formula]`. `konta` = comma-separated account prefixes, `!` excludes (`"73,74,!745"`), summed by `sumPref` (3601). `formula`: `''` (use konta), `"202+203+206"` (sum of AOPs in same report), `P:`/`N:` positive/negative part, special tokens `TAX` (bu252 = close.tax only when closed), `+PROFIT`, `+BU255` (bs077), `INV0`/`INV1`, `EMP`, `MONTHS`. bu214–216 are split from payroll v2 when 4201/4202/4211/4212 are empty.
- `DB_F` row: header `['h', roman, title]`; data `[aop '01'..'70', '', label, type?]` with type `'auto'` (01, 02, 40, 41, 49, 50, 51, 56, 59), `'akont'` (57), `'inc'` (65) or input. Rate 10%, integers; `V['57']` defaults to debits on 2330 excluding `src:'Почетна'`.
- `DE38`: `[aop, label]`; `DE38_AUTO`: `{aop:[accountRegex, nameRegex]}`.
- `NPO_BS` / `NPO_PR`: `[id, aop, name, konta?, sign, formula]` (header when `konta` undefined; tokens `+SUR`, `+DEF`, `SURG`, `DEFG`, `TAX`).
- `BEL`: `[id, title, [[rep,aop,label]]|null]`; `ZS_PH`: `[id, label, [views]]`; `ZY_ROLES`: `[role, label, 1 generated|2 official|0 other]`; `POS_*`: `[code, name, prefixes|null, sign]`.

### 8.3 Screens

| View | Lines (final) | Menu |
|---|---|---|
| `os` | **5850** | NAV "Основни средства" → Регистар и амортизација |
| `zsProc` | 11178 + 11237 + **17093** | Финансово › Завршна сметка › 📋 Завршна сметка – по фази (also home tile 11558) |
| `zsDos` | **11132** | Завршна сметка › 📁 Досие – годишни сметки по години |
| `zsNPO` | **10463** | Завршна сметка › Годишна сметка – непрофитни организации |
| `zsTP` | **10499** | Завршна сметка › Годишна сметка – ТП / самостојна дејност |
| `zsRok` | 10523 / **11176** | Завршна сметка › 📅 Што, каде и кога се поднесува |
| `zsKontrola` | 10893 → 11070 → **11236** | ZS_PH 1 "Контрола" |
| `zs_db` | 7711 → `ZS_VIEW_DB` **10866** | ZS_PH 2 "Даночен биланс" |
| `zs_vp` | **17138** | ZS_PH 2 sub-tab |
| `mbyllja` | 6694 / **11176** | ZS_PH 3 "Затворање" (not in NAV) |
| `zs_bs`, `zs_bu` | 7711 → **10972** | ZS_PH 4 "Биланси и обрасци" |
| `zs_de`, `zs_sp`, `zs_skr` | **11044**, 7711→**11051**, **7711** | ZS_PH 4 |
| `zsBel` | **10929** | ZS_PH 5 "Белешки" |
| `zsXml` | 11053 → **17039** | ZS_PH 6 "XML и поднесување" |
| `prenos` | 6757 / **11176** | ZS_PH 8 "Нова година" |
| `zs_aop`, `zs_pr`, `vjetore` | **7711**, **7711**, 6772/**11176** | ZS_PH "⚙ Алатки" |

`ENT_V` (10409) hides views by entity type (`zs_db` co only, `zsNPO` npo only). `NAV_MINI` (3668) still carries a stale `'Крај на година'` label.

### 8.4 Inconsistencies / bugs to fix deliberately

1. **Result accounts disagree.** `closeYear` posts **951/961** (6740) and the mbyllja text says 951/961 (6716); the `prenos` text says **9500/9600** (6762); `VIEWS.terkovi` help text (6981) says "8100/**2340** данок; 8200 → 9500/9600" while code posts tax to **2330**; `openYear` remaps to **950/960** via `obResK` (12386); ZS_DEF bs075/076 read 950/960 and bs077/078 read 951/961 (7579–7582); NPO co-mode uses 951/961, npo-mode 970/092 (not remapped). KONTO_SRC has all of 950, 951, 9500, 960, 961, 9600 (lines 3033–3045). Pick one convention.
2. **`obResK` depends on UI state** — skipped whenever `S.obFull` ("full trial balance" checkbox, 13244) is on, so `openYear` can silently keep 951/961.
3. **Closing account codes differ by path:** `closeYear` uses 8000/8200/8100; `obRebuild` (17158) and NPO close use 800/810.
4. **Hoisting dead code:** `dbData` 7646 (callers use `V['49']`/`V['56']`, only valid in 10829), `zsPdfTable` 7644/10722 (10745 ignores its title), `zpArchive` 11078 (11118 writes a different docs record).
5. **`VIEWS.zsProc` chain broken:** the plain reassignment at 11178 discards 11089 and the "6. Досие" wrapper 11140.
6. **ACT redefinitions:** `zsPdf` ×3 (7713/10723/**10743**), `zsPrev` ×2, `dbSave`/`dbPdf` (7717/7718 vs 10875/10876; the bank-package job at 8150 temporarily swaps `ACT.dbSave`), `vpPdf` (7719 vs 17154).
7. **`zsCompute` wrapper side effects** (chain 17099 → 10940 → 7620): with 1–20 `zsMan` keys the rounding pass recomputes formula rows and overwrites manual totals; a ±3 denar A/P difference is silently added to the largest liability AOP (`r.rounded`); bs077 (`+BU255`) is rounded from unrounded BU255 and can break ЦРМ rule 2024 (`077<=255`).
8. **Tax before close:** bu252 = `close.tax` only when closed, so BU255 = pre-tax profit before close and the `zkData` check "bu252 = ДБ 56" (10890) fails. Tax rounding differs: `Math.round(V56)` with ДБ vs `r2(base*.10)` without.
9. **Depreciation mapping:** `runDep` credits everything to `0190`, which ZS_DEF maps to bs012 (buildings) regardless of asset konto; DEP_PRESETS konta (0120/0130/0140/0150) don't match ZS_DEF prefixes (014 = biological assets); `0130` appears twice; no disposal/write-off; `vehicleOnly` ignored by `depFor`.
10. **Two "simple" statement engines:** POS_IS treats `73` as expense, ZS_DEF bu202 treats `73,74,!745` as revenue; `vjetore`/`gsXml` still reachable beside `crmXml`.
11. Bank package "de" (8151) prints the old `deData` list, not form 38.
12. **Two entity discriminators:** `npoMode` = "chart contains 730" (10450) vs `entOf` (`f.ent`/`lf`/name guess). `mbyllja`/`closeYear` are not entity-gated.
13. **Not persisted / bypassing save:** `zsTP` onchange (10510) only mutates memory; `ZS_VIEW_DB` onchange (10871) writes `S.db` directly and swallows errors; `f35Man` read but never written.
14. `crmXmlImport` replaces `zsMan[Y]` wholesale (17035); `crmXClr` (17043) wipes manual amounts too.
15. **Gates inconsistent:** `closeYear`, `crmXmlDl`, `zyGen` gated by `zcGate`; `undoClose` (no confirm), `openYear`, `doTransfer` are not; `lockYear` writes with no audit (firmUnlock does audit).
16. NPO `close-Y` has no `net`, but `zsProc`/`zsKontrola` render `cl.net` (10899, 11183).
17. `zsRules` caches on a non-enumerable `_fx` of the firm array — works only because `saveFirmPatch` replaces the array.

## Phase 9 — Office

Firm dossier and archive, packages/ZIP and Gmail sending (signature, mail history), client portal and inbox (klient role), tasks, text/form templates and Word templates, notifications and monthly close, dunning, recurring invoices and accounting-service contracts, autopilot, inspection readiness, law robot, AML, GDPR (ЗЗЛП), company formation, firm registration from scan, firm picker, firm import, users/roles/audit, backups, error log, payment orders, loans, document codes.

Watch first: **security is UI-only** and **every user can read every password hash and client plain-text initial passwords** (item 4.1–4.2); **backups skip almost all office-wide data** (item 4.9).

### 9.1 Functions & constants

**Dossier, contacts, archive**

| Name | Lines (final **bold**) | Purpose |
|---|---|---|
| `DOS_CAT` / `DOS_FRESH` | **7989** / **7991** | Dossier categories (`sub`); categories that must be recent (e.g. ЦРМ тековна состојба) |
| `dosList`, `dosAddM`, `dosAgeDays`, `dosAgeTxt`, `dosAgeB`, `dosNewest`, `dosArc`, `dosExp`, `dosBadge` | 7992–8002 | `docs` `type==='arch' && dos`; age/expiry badges |
| `dosCompress`, `dosImgsToPdf`, `dosForm` | 8003, 8004, 8010 | Shrink images; camera pages → one PDF; edit form |
| `VIEWS.dosie` | 8028 → 12788 → **12808** | Dossier screen |
| `dosFilesOf`, `dosIds`, `dosDesc` | 8054–8056 | |
| ACT `dosNew/dosAi/dosEditB/dosRmPage/dosRmFile/dosDel/dosDown/dosShare` | 8059–8112 (OA; `ACT_NEED` 8057) | |
| ACT `dosSave` / `dosCancel` | 8073 → **12786** / 8070 → **12787** | Return to archive |
| ACT `dosMail` | 8085 → 12087 → 12120 → 12139 → 12159 → **12176** | Mail dialog (wrapped 5×) |
| ACT `dosMailGo` / `dosWa` | 8090 → **12091** / 8100 → 12098 → **12121** | Gmail send / WhatsApp |
| `fcList`, `fcSave`, `fcChips`, `fcWire`, `fcRefresh`, `dmLast`, `dwLast` | 12106–12119, 12086, 12097 | Saved contacts (`firm.contacts`) |
| `archiveFile(file,meta)` | **6597** | Upload → `save('docs',{type:'arch',…meta,files})` |
| `archRows` | 6600 → **13137** (adds fiscal Z files) | Archive rows from purchases, invoices, arch docs, assets, employees |
| `VIEWS.arhiva` | 6606 → **12783** | |
| `AR_MAP`, `VIEWS.arNewNav`, ACT `arNew` | 12780, **12781**, 12782 | |
| ACT `arUpload` | 5056 (ET_ACT) → **12790** | |
| ACT `arView`/`arDown`/`arOpen`, `arDel`/`arXlsx` | 7277/7285/7291; 5058/5059 (ET_ACT) | |

**Packages, ZIP, Gmail, signature, mail history**

| Name | Lines | Purpose |
|---|---|---|
| `CRC_T`, `crc32`, `zipStore` | 8119–8121 | Multi-file stored ZIP |
| `CRC_T1`, `crc32one`, `zipOne`, `DL_OK`, `dlWrap` | 7845–7853 | **Second** ZIP implementation (wrap disallowed download types into .zip) |
| `dataYears`, `pkgYearsList`, `pkgPerTxt`, `pkgEmails`, `pkgYS`, `pkgCellOk`, `withS`, `pkgDdvPers`, `PKG_LBL`, `pkgLblFix` | 8128–8137 | `withS` temporarily swaps global `S` |
| `PKG_REP`, `PKG_PRE` | **8138–8156**, **8157** (+ "ujp" preset via 16578/16580) | Report list for bank/institution packages; presets |
| `pkgDosHTML`, `pkgState`, `pkgOutHTML` | 8158, 8165, 8189 | |
| `pkgCoverHTML` | 8166 → 13489 (signature block) → **14785** (replacement — drops 13489) | Cover letter |
| `VIEWS.paket` | 8169 → 13673 → 14791 → 14831 → 16580 → **16838** | |
| ACT `pkgYrs/pkgBuild/pkgRm/pkgOne/pkgZip/pkgWa`; `pkgPre` → **16578**, `pkgMailGo` → **16581**, `pkgMail` → **16582**; `kpAll/kpNone` 13679 | 8195–8230 (OA) | |
| `gmailSendParts(to,subj,body,files,mode,prog)` | 8249 → 12134 (signature) → **12156** (inline images) | `S.mcp.callTool('Gmail','send_message'\|'create_draft')`; ~1.4 MB parts, halves on "too large" |
| `MS_DISC`, `msCfg` (12125 → **12165**), `msSave` (12127 → **12166**), `msSigText`, `msCore`, `msSign`, `msHtml` (12131 → 12152 → **13634**), `msEditorHTML` (12136 → 12158 → **12167**), `msImgB64` (12148 → **14225**), `msInline` (12149 → **13633**), `msWireUp`, `msRewire`, `msLogoSrc` | 12124–13634 | Mail signature + confidentiality note (office-wide in `appsettings/office.mailSig`) |
| `VIEWS.mailPotpis` | **12179** | |
| `S.mcp` proxy, `mhKind`, `mhLog`, `mhRows`, `VIEWS.mailhist` | 13411–13412, 13414–13417, **13421** | Logs every Gmail `send_message` as `docs.type='maillog'` |

**Client portal, client users, inbox routing**

| Name | Lines | Purpose |
|---|---|---|
| `KL_PROF`, `KL_SEC`, `KL_BASEC` | **9027**, **9029–9047**, 9049 | Business profiles; portal sections `[id,name,icon,view,profiles,desc]`; default sections docs/send/kdfi/metg |
| `klCfg` (`firm.kl`), `klSections`, `klRec`, `isKlient`, `klAllowed`, `klNav` | 9048–9054 | `isKlient` = role klient or `S.asClient` preview; `klAllowed` checked only in `render` (3706) |
| `VIEWS.klHome` | 9055 → **10400** | |
| `VIEWS.klExit`, `klSend`, `klPortal`, `klProfili` | **9064**, **9066**, **9074**, **9170** | |
| `VIEWS.klInbox` | 9072 → **14035** | |
| `klPending`, `klPendHTML`, `klMovesOf` | 9095, 9100, 9103 | Records with `pend:true` awaiting approval |
| `KL_INSP`, `klInspDef`, `klNoteHTML`, `klNoteQRText`, `klNoteQR`, `klImgLoad`, `klNoteForm` | 9104–9128 | Inspection notice for client shops (`appsettings/notice`) |
| ACT `klOnlyBase/klAddRec/klPrevOn/klUserNew/klPrevOff/klMsg`, `klDone` (→ **14005**) | 9085–9091 (OA) | |
| ACT `klImgRm` 9138, `klOpen` 9140, `klAppr` 9141, `klRej` 9143, `klNotePdf` 9145 | (`ACT_NEED` 9137) | Approve / reject client documents |
| `KL_BASE`, `klNextNo`, `KL_ALN/UP/LO/DG`, `klRnd`, `klStrongPw`, `klSimplePw = klStrongPw`, `KL_TR`, `KL_STOP`, `klUserName`, `klUserOf`, `klAutoUser`, `klAutoAll`, `klResetPw`, `klCredHTML`, `klCredTableHTML` | 9149–9169 | Auto client users (`name.xxxx`, password `Xxxx-xxxx-xxxx`, stores **`pw0` plaintext**) |
| ACT `klRenameNum` 9174; `klAutoAllB/klPwReset/klCredAll/klCredOne` 9179–9182 | | |
| `_ainbSub`, `ainbStart`, `ainbOpenN`, `ainbRender` (13997 → 14012 → **14019**), `ainbSync`, `msgTop` | 13995–14015 | Live office inbox from `appinbox` |
| ACT `ainbT/ainbGo/ainbDone` | 14002–14004 | |
| `alBell` | 8607 → **14020** | |
| `IR_K`, `irFile`, `irRoute` (14024 → 14043 → **14104**), `irClassify` (14029 → **14044** replacement), `irArch`, ACT `irGo` 14030 | 14022–14044 | Route a client file to purchase / sale / bank / fiscal / payroll / employee / cash / stock / travel / dossier |

**Tasks, text templates, official forms, Word templates**

| Name | Lines | Purpose |
|---|---|---|
| `OFFICE_V`, `INST`, `TTYPE`, `TST`, `OF()`, `uName`, `oSave`, `oDel`, `isTeren`, `stPill`, `taskFirm` | 3874–3884 | `oSave/oDel` write **global** collections `office_*` |
| `VIEWS.kanc` / `VIEWS.mojzad` | **3886** / **3918** | Task board / my tasks (field role `teren`) |
| `taskForm`, `readTask`, `taskModal`, `taskFilesHTML`, `taskHist`, `taskSet`, `upFiles` | 3895–3915 | `taskSet` appends `hist[]`, `auditLog` |
| ACT `tNew/tOpen/tSave/tDel/tSt/tDocView/tDocPdf`, `mzSt/mzTake/mzDone/mzProb` | 7073–7085 | `mz*` have no `ACT_NEED` |
| `TPL0`, `FORM_BG`, `FORMS0` | **3935–3941**, **3942**, **3943** | Built-in request templates (6); background JPEGs (4, 560 KB); official forms (3) |
| `fSrcVal`, `formVals`, `formHTML`, `formPanel`, `formRead`, `formSaveEmbg`, `allTpl`, `PH`, `phVals`, `askFields`, `fillTpl`, `reqHTML` | 3944–3970 | `formRead` stores typed values in `localStorage frm_*`; `allTpl`: user templates override built-ins by id |
| `VIEWS.baranja` | 3974 → **15094** | |
| `genSrc`, `genPanel`, `genDoc`, `freeEditor`, `genRead`, `genLive`, `tplEditor` | 3979–3996 | |
| ACT `tplNew/tplEdit/tplSave/tplDel`, `genOpen/genClose/genPdf/frIns/genTask` | 7086–7094 | |
| `TPL_W`, `TPL_CHUNK=300000`, `tplNorm`, `tplOwn`, `tplKinds`, `TPL_COMMON`, `tplVars`, `tplVal`, `tplUnzip`, `tplFillXml`, `tplFill`, `tplScan`, `tplHtml`, `tplCfg`, `tplBin`, `tplActive`, `tplRun`, `tplOsn`, `tplInject`, `tplUpload`, `tplSrcKind`, `tplSrcList`, `tplFCtx`, `tplFieldsRender` | 16001–16186 | Word (.docx) templates in `apptpl` (base64 chunks), merged with document context |
| Hooks into other modules | 16111 (`zzOut`), 16112 (`zzIzj`), 16113 (`zzDpa`), 16114 (`amlDoc`), 16115 (`diPdf/diWord`), 16123 (`ncWord/ncDocPdf`), 16124 (`ctPdf`), 16126 (`kdPdf`), 16133/16134 (render/ctRender) | |
| `VIEWS.tpl` + ACT `tplOff/tplUse/tplDl/tplVers/tplFields/tplFSrc/tplFRun/tplTest` | **16136**, 16162–16171 | |

**Notifications, monthly close, dunning**

| Name | Lines | Purpose |
|---|---|---|
| `AL_DDV_LIMIT`, `alLoad`, `alWith`, `AL_DESC`, `AL_CATS`, `alFirmPatch`, `supWarn` | 8478–8485 | `alWith` temporarily swaps `S.data`/`S.fid` to evaluate another firm |
| `alCompute(f)` | 8494 → **15278** (pay-change notices) | Checks: statements, purchases, sales, VAT threshold/post, payroll, cash, negative stock, expiring docs, unpaid invoices |
| `alRunAll`, `alMatrixHTML`, `VIEWS.izvestuvanja`, `alLS`, `alSummaryText`, `alSpeak`, `alMail`, `alStartup`, `alPopup`, `alSettingsHTML`, `alFirmBadge` | 8544–8606 | |
| ACT `alRefresh/alLvl/alAck/alGo`, `alOpenList/alVoice/alMailNow` | 8565–8568, 8599–8601 | |
| `zatMonthEnd`, `zatTasks`, `zatPrio`, `zatRun`, `VIEWS.zatvoranje`; ACT `zatRefresh`/`zatLock` | 8687–8713; 17452/17453 | Monthly close across firms |
| `OP_LV`, `opDue`, `opDays`, `opData` (13329 → 13375 → **16894**), `opText` (13333 → **13377**), `opPdfHTML` (13335 → **13382** replacement), `opLog`, `opG`, `opLvAuto`, `opRate`/`opCost` | 13326–13382 | Dunning (3 levels, late interest) |
| `VIEWS.opomeni` | 13337 → 13404 → 13429 → **16898** | |
| ACT `opAllT…opMailAll` 13345–13360 (OA), `opWaAll` 13364, `opSet` 13403, `opGoSel` 16895, `opSelClr` 16896 | | |

**Recurring invoices, accounting-service contracts, office profile**

| Name | Lines | Purpose |
|---|---|---|
| `recurs`, `recNext`, `recDue` | 10172–10174 | `docs.type='recur'` |
| `VIEWS.periodicni` | 10175 → 13536 → 13542 → 13550 → 13569 → 13583 → **13597** | |
| `lastWD`, `recNext2`, `recFirstL`, `recItemName`, `recCfg` (`firm.recAuto`), `recNote`, `recIssue` (13493 → **13594**), `recMail`, `recResHTML`, `rbModal` (13511 → **13552**), `recAutoCheck` (13531 → **13575**), `recPrevTxt`, `recDefItem`, `recDefLine`, `recIdx`, `recFirmsDue` | 13483–13598 | Auto-issue on firm open, bulk setup, e-mail |
| ACT `recNew` (10184 → **13581**), `recEdit`, `recX`, `recLAdd`, `recLRm`, `recSave`, `recRun` (→ **13507**), `recResX`, `recMailNow`, `recBulk` (13510 → **13582**), `rbAll/rbNone/rbSave` (→ **13595**), `recGoFirm` 13599 | | |
| `KD_SVC`, `kdVat`, `kdAmt`, `kdWords`, `kdogs`, `KD_ST`, `kdOffLoad` (`appsettings/office` → `S.kdOff`), `kdNextNo` (`appsettings/kdogNo`, `СУ-001/2026`), `kdNew` | 10326–10334 | Accounting-service contract |
| `kdHTML` | 10335 → **15608** | |
| `VIEWS.kdogovori` | 10355 → 13577 → 13602 → 13608 → 13616 → **15514** | |
| `kdIndex` | 10383 → 13555 → 13589 → **15597** (`docReg`) | Summary to `firm.kdog` |
| `kdArchive` | 10384 → **13614** | |
| ACT `kdNewB/kdOpen/kdBack/kdPick/kdOffSign/kdCliSign/kdOffSave/kdDel`, `kdSaveB` (→ **13613**), `kdPdf` (→ **16126**), `kdRecSync`, `offFirmSet`, `kdToDos`, `kdWordT` | 10388–10397, 13567–13615, 16127 | |
| `offFirm`, `kdRecPlan` (13556 → **13590**), `kdRecSync` (13560 → **13596**), `kdPeekNo`, `kdDraftArch`, `kdOffImg`, `offBrand`, `offHead`, `offImgSrc`, `offSigSrc`, `kdDpaAnnex`, `kdCode` | 13554–15594 | Office firm = `officeFirm` flag or EDB match |

**Autopilot, inspection readiness, law robot**

| Name | Lines | Purpose |
|---|---|---|
| `AP_TYPES`, `AP_CASH_LIMIT=61500`, `apCanAuto`, `apAuto`, `apExtra`, `apRisk`, `apRun`, `apSend`, `apHash`, `apWhat` | 16238–16311 | Morning check of all firms, messages to clients; sent log `office_apsent` |
| `VIEWS.autop` | 16316 → 16453 → 16567 (inspection tab) → **16663** (law tab) | (NAV unshift 16352) |
| `apPeriodFor`, `apClose`, `apCloseRun`, `apCloseHTML`, `apCl*` | 16361–16439 | Period close + bulk VAT posting (Phase 5) |
| ACT `apGo/apTab/apFilt/apFirmOpen/apSendOne/apSkip`, `apClGo…apClBookAll` | 16343–16349, 16412–16444 | |
| `INSP_G`, `inspCtx`, `inspCodes`, `INSP_ACT`, `iOk/iBad/iWarn`, `inspCashDays`, `inspCashPays`, `INSP`, `inspManState`, `inspCheck`, `INSP_IC`, `inspTable`, `inspMissing`, `inspSet`, `inspAllHTML`, `inspAllRun`, `ujpKontos`, `inspAttach`, `INSP_NKD_PROMPT`, `inspCodesFromFile` | 16462–16670 | 40 checks for УЈП / ДПИ / ДИТ |
| `VIEWS.insp` | 16537 → 16587 → **16676** | |
| `LAW_INST`, `LAW_IMP`, `lawOn`, `lawStart` (`applaw`), `lawSeen`, `lawNew`, `lawFirms`, `lawBadge` (14321 → **14392**), `robotSVG` | 14313–14376 | Law-change feed |
| `VIEWS.zakoni` | 14323 → 14373 → **14394** | |
| ACT `lawInst/lawSeenAll/lawDel/lawAsk` | 14338–14341 | |
| `LR_LAWS`, `LR_INT`, `lrDays`, `lrInt`, `lrSize`, `LR_FINE_REG`, `lrAcc`, `lrMatch`, `lrCtx`, `lrPrevRev`, `lrPurVat`, `RE_*`, `LR_RULES`, `lrCheck`, `LR_IC`, `lrTable`, `lrAllHTML`, `lrAllRun` | 16595–16660 | Preliminary tax review (ЗДДВ, ЗДД, ЗПДД) |
| `VIEWS.lawrep` | 16649 → **16800** | |
| `UJP_U`, `UJP_AREAS`, `ujpAreaRules`, `VIEWS.ujpZakoni` | 16772–**16787** | |

**AML, GDPR**

| Name | Lines | Purpose |
|---|---|---|
| `AML_IND`, `AML_NKD`, `AML_LV`, `amlOn`, `amlEur`, `amlGet`/`amlPut` (`appaml/{fid}`), `amlNewco`, `amlAuto`, `amlRisk`, `amlNext`, `amlPct`, `amlKycDoc`, `amlDeclDoc`, `amlProgDoc`, `amlOdlDoc`, `amlRiskDoc`, `amlOut`, `amlScan`, `amlRow`, `amlEdRender` | 15851–15936 | Client risk assessment, KYC documents |
| `VIEWS.aml`; ACT `amlGo…amlRepSt`, `amlDoc` (15962 → **16114**), `amlTab` | **15976**; 15955–15998 | |
| `ZZ_SUB_DEF`, `ZZ_CHK`, `zzOff`, `zzSubs`, `zzClients`, `zzSaveOff`, `zzUjp`, `zzHTML`, `zzWordFix`, `zzF`, `zzPerson`, `zzIzjOf`, `zzIsOwner`, `zzColl`, `zzKd`, `zzPosOf` | 15364–15582 | Personal-data processing agreements, confidentiality statements |
| `zzDpa` (15380 → **16113**), `zzIzj` (15416 → **16112**), `zzOut` (15438 → 15611 → **16111**) | | |
| `VIEWS.zzlp`; ACT `zzDoc…zzIzjView` | **15490**; 15450–15479 | |

**Formation, registration from scan, firm picker, firm import**

| Name | Lines | Purpose |
|---|---|---|
| `NC_ST`, `NC_CHECK`, `NF`, `VIEWS.osnovanje` | 4001–**4004** | Company formation |
| `ncCheck` (4008 → **14992**), `ncEditor` (4013 → 15082 → 15196 → **15743**), `ncRead` (4032 → 14990 → **15191**), `ncHTML` | | |
| `NC_CAP`, `ncItems`, `ncCapSum`, `ncE`, `ncM`, `ncCapCard`, `ncDocs` (15009 → 15096 replacement → **15741**), `ncDocHTML`, `ncDocx`, `ncDocsCard`, `ncIdBox`, `NC_ID_PROMPT`, `NC_LAT`, `ncLat`, `NC_BANKS`, `NC_BDOCS`, `ncBankDocs`, `ncBankCard`, `OSN_ZTD`, `osnData`, `osnDocs` | 14985–15741 | Capital, founder ID scans, documents per ЦРСМ practice, bank account opening |
| ACT `ncNew…ncCreateFirm` 7095–7104; `ncWord` 15071 → 15747 → **16123**; `ncDocPdf` 15073 → **16123** | | |
| `FS_PROMPT`, `FS_LF`, `FS_CAT`, `fsDig`, `fsNorm`, `fsDup`, `fsPdf`; `VIEWS.firmiResh` 10540 → **12065** | 10534–10573 | New firm from scanned registration decision |
| `firmPicker` | 3712 → **14192** (replacement) → 14251 → **14278** | 400+ firms: list / tiles / groups / status, A–Ш filter, recent |
| `fpRecent`, `fpRemember`, `FP_AZ`, `fpLetter`, `fpShort`, `FP_VIEWS`, `fpView`, `fpGrpKey`, `fpDdvDue`, `fpStatus`, `fpAlt` (14241 → **14263**), `fpPhone`, `fpDdvNo`, `fpPerson` | 14186–14262 | |
| ACT `fpFlt/fpAz/fpSort/fpMore/fpVw/fpGby/fpPrint/fpXlsx` (→ **14286**); `pickFirm` 7734 → **14188** | | |
| `FIMP_MAP`, `fimpField`, `fimpDigits`, `fimpFind`, `fimpRead`, `fimpHTML`, `VIEWS.firmiImp`, ACT `fimpCancel/fimpGo` | 8843–8868 | Firm import from another program's Excel |
| `FTABS`, `firmFormVals`, `readFirmForm`, `firmForm`, `VIEWS.firmi` (6887 → 10614 → 12061 → 12074 → **13587**), `FR_F`, `frList`, `frPdfHTML`, ACT `frPdf/frXlsx` 12080/12081 | 6830–6887, 12068–12081 | Firm registration form; firm list report (`fr*` here ≠ freight `fr*`) |
| `FIMG`, `duToBlobUrl`, `firmSlim`, `firmSlimAll` | 14218–14222 | Move firm logo/sign/stamp data-URLs into assets |

**Users, roles, audit, backups, errors**

| Name | Lines | Purpose |
|---|---|---|
| `ROLES`, `RP`, `can`, `ACT_NEED`, `firmAllowed` | **5455–5459** | See Cross-cutting C.2 |
| `sha`, `rnd`, `tryRestore`, `afterLogin`, `loginView`, `auditLog`, `userForm` | 5460–5474 | Session token `sha(u.hash+'\|'+exp)` |
| `VIEWS.korisnici` | 5484 → 15481 (ЗЗЛП) → **16888** | |
| `VIEWS.aktivnost` | **5495** | Activity log |
| `AUTH_ACT` | **5498–5511** (merged 7740) | `logout, uNew, uEdit, uCancel, uSave, uDel, uMyPass` |
| `PW_IT=150000`, `pwHash`, `pwEq`, `pwCheck` | 14401–14405 | PBKDF2-SHA256, salt `'wc\|'+salt`, format `p2$150000$<hex>`; legacy `sha(salt+'\|'+pw)` upgraded on login; clears `pw0` |
| `miAdm`, `miCanClaim`, `miOwnerLoad`, `miRange`, `miMonths`, `miLoad`, `miCalc`, `miSorted`, `miBind`, `VIEWS.mojIzv`, ACT `miClaim/miGo/miSort/miRefresh/miXls/miOpen` | 14899–14966 | Owner-only "my report" (activity per client) |
| `BKP_KEEP=30`, `bkpLoadFirm`, `bkpList`, `bkpRun`, `bkpFetch`, `bkpRestoreFirm`, `VIEWS.sistem`, `bkRestHTML`, ACT `bkNow/bkZip/bkRestoreOpen/bkRestClose/bkRestoreGo`, `backupJson` (5060, ET_ACT) | 8976–9017 | Daily backups (see Phase 11) |
| `APP_VER`, `ERR_SEEN`, `errLog`, `VIEWS.greski`, ACT `errFix/errDelFixed/errCopy/errTest` | 17458–17486 | Error register (`apperrors`) |

**Payment orders, loans, document codes** — `PP_*`/`pp*` 15750–15837 (see Phase 6; `ppIban` 15760 = account + `'2220'+'00'`, mod 97, `MK`+(98−r)+account); loans `LN_RE`, `lnKontoDir`, `lnBankKind`, `lnList`, `lnLedRows`, `lnBankRows`, `lnState`, `lnParty`, `lnDoc`, `lnNextNo`, `lnEditor`, `lnSaveDoc` (16678–16743), `VIEWS.pozajmici` 16720 → 16854 → 16876 → **16878**, `LN_K={given:'1620',received:'2620'}` (16841), `lnKonto`, `lnMisK`, `lnRebook`, `lnPName`, `lnAutoRun`; ACT `lnNew…lnWord` 16745–16755, `lnSave` 16751 → **16847**, `lnRebookAll/lnAutoNow/lnCreateSel/lnPickAll/lnIgnore` 16851–16874; `docCode` 15585 (48-bit FNV-like `XXXX-XXXX-XXXX`), `docReg` 15595, ACT `docVerify` 15598.

### 9.2 Data shapes

**docs (per firm)**
| type | Fields | Lines |
|---|---|---|
| `arch` | `dos?, sub, title, number, date, validTo, note, partnerName, arcAt, files[{id,name,type,size}], fromInbox?, asset?, zsYear?, acct?`; without `dos` = plain archive item | 6597, 8073 |
| `inbox` | `at, date, note, files[], from, done, office?, doneBy, doneAt` | 9070, 14004 |
| `maillog` | `at, date, to[], partner, subject, kind, files[], channel, uid` | 13415 |
| `recur` | `every:'month', day (number or 'L'), next, dueDays, items[], active, note ('Фактура за {месец}'), partner, end?, last, lastNo` | 10184 |
| `kdog` | `feeMode, number, date, place, start, dur, end, svc[], fee, feeEmp, empFree, feeYear, feeHour, payDay, docDay, notice, rep, repRole, note, offSig, cliSig, arch, noDpa` | 10334 |
| `pp` | see Phase 6 | 15767 |
| `loan` | `konto, dir ('given'\|'received'), no, date, rate, inst, bankIds[], partner/pName, amount` | 16745 |
| any | client-submitted `pend:true, pendBy, pendAt`; on approval `apprBy, apprAt, fromClient` | 3301–3302 |

**Office objects** (global, via `oSave`): task (`office_tasks`) `{id, title, status ∈ TST, prio, firmId, newcoId, due, inst, type, assignee, desc, docs[{name, html}], hist[{at,by,st,note}], received, created, doneAt}`; tpl (`office_tpl`) `{id:'t…', name, inst, to, title, body}` (built-in `FORMS0` add `form, fields[{k,src,t}]`); newco (`office_newco`) `{id:'n…', name, form:'ДООЕЛ', status ∈ NC_ST, capType, capMode, eurRate:'61.5', items[], founders[{kind:'ФЛ'|'ПЛ', share, cit, name, surname, embg, idno, idType, address, …, docs}], managers[], check{}}`.

**Users** (`appusers/{id}`): `{id, name, username, role, firms:['*'|fid…], salt, hash, pw0, pwChanged, active, created, lastLogin, kp:{out,in} (klient), auto (klient), amlOfficer?}`. Session `wc_sess` in local/sessionStorage: `{uid, exp, tok: sha(hash+'|'+exp)}` (30 days with "remember me", else 12 h).

**Firm fields**: `contacts[]`, `kl{on{sec:bool}, prof, profSet}`, `kdog{id,no,date,fee,st,dpa}`, `recAuto{on,mail}`, `recItem`, `recRunAt`, `officeFirm`, `opRate`, `opCost`, `payDays`, `alOff{cat}`, `alAck{id:date}`, `insp{id:{d|na}}`, `inspProf`, `lnIgnore`, `signerEmbg`, `email`, `phone`, `signer`, `fuelSeller`, `logo`, `sign`, `stamp`, `lock`. Global paths: Cross-cutting C.5.

### 9.3 Screens

| View | Lines (final **bold**) | Menu |
|---|---|---|
| `dosie` | 8028 → 12788 → **12808** | Фирми / Архива › 🗂 Досие на фирмата |
| `arhiva`, `arNewNav` | 6606 → **12783**; **12781** | Архива |
| `paket` | 8169 … **16838** | Фирми / Архива › Пакет документи за банка / институција |
| `mailPotpis` | **12179** | Систем › ✏ Потпис и напомена за е-пошта |
| `mailhist` | **13421** | Материјално › 📜 Историја на праќања (13428) |
| `klHome`, `klSend`, `klExit`, `klPortal`, `klProfili` | 9055 → **10400**, **9066**, **9064**, **9074**, **9170** | Фирми › 👥 Портал за клиенти / 🔑 Профили на клиенти; client menu `klNav` |
| `klInbox` | 9072 → **14035** | Фирми › 📥 Пристигнато од клиенти |
| `kanc`, `mojzad` | **3886**, **3918** | Канцеларија |
| `baranja` | 3974 → **15094** | Канцеларија › Барања и обрасци |
| `osnovanje` | **4004** | Канцеларија › Основање фирми |
| `tpl` | **16136** | Канцеларија › 📄 Шаблони (16198) |
| `izvestuvanja`, `zatvoranje` | **8552**, **8713** | Фирми |
| `opomeni` | 13337 → 13404 → 13429 → **16898** | Материјално › ⏰ Неплатени фактури и опомени (16988) |
| `periodicni` | … **13597** | Дејности › 🔁 Периодични фактури |
| `kdogovori` | … **15514** | Фирми › ✍ Договор за сметководствени услуги |
| `autop` | … **16663** | Канцеларија › 🤖 Автопилот |
| `insp`, `zakoni`, `lawrep`, `ujpZakoni` | **16676**, **14394**, **16800**, **16787** | Фирми |
| `aml`, `zzlp`, `efPrep` | **15976**, **15490**, **15215** | Канцеларија |
| `firmi`, `firmiImp`, `firmiResh` | **13587**, **8865**, **12065** | Фирми / Систем |
| `korisnici`, `aktivnost`, `sistem`, `greski` | **16888**, **5495**, **8992**, **17472** | Систем |
| `ppNal`, `pozajmici` | **15837**, **16878** | Финансово |
| `mojIzv`, `klDash` | **14940**, 11588 → **11642** | Анализи |
| `home` | 3788 → 11558 → 13600 → 14010 → 14347 → 14370 → 14398 → 15846 → **16354** | Контролна табла |

### 9.4 Inconsistencies / bugs to fix deliberately

1. **Client-role restrictions are UI-only.** `RP.klient=['write']` (5456); the dispatcher (7804) blocks only prefixes `del|nal|sch|close|transfer|zat|bk|newFirm|editFirm|saveFirm|fx|tpl|u[A-Z]|kl[PD]` and names containing Del/Lock/Repost. A client can trigger `klAppr/klRej/klOpen` (approve and post own pending documents), `opMail*`, `recRun`, `rbSave`, `kdRecSync`, `irGo`, `apSendOne`, `inspOk`, `lnSave`, `ppSave`, `ainbDone/ainbGo`… `klAllowed` is only enforced in `render` (3706). Rebuild: server-side `can()` per action and firm (PLAN.md).
2. **All password data is readable by every user**: every session subscribes to the whole `appusers` (7865), including clients; records contain `hash`, `salt` and client `pw0` in plain text (5509, 9163, 9167; shown in `klCredTableHTML`). The session token `sha(u.hash+'|'+exp)` (5470) can be forged by anyone who can read a hash. First-admin bootstrap: anyone can create the admin when `appusers` is empty (5468). **Import must not carry `pw0`**; force reset for client users.
3. "Owner" decided on the client: `zzIsOwner` (15446) treats any admin as owner while `appsettings/owner` is unset; `miClaim` (14902) is first-come; `miAdm` true when `!S.authOn`.
4. `firmAllowed` never applied at the data layer: all `firms` subscribed (7871); `appinbox` mirrors every firm's client notes globally (13994).
5. GDPR: `formRead` keeps typed form values (incl. ЕМБГ) in `localStorage frm_*` (3958); `formSaveEmbg` silently writes `signerEmbg` into the firm (3960).
6. `docCode` (15585) is a 48-bit non-cryptographic hash — document "authenticity" codes can be forged; `docReg` read-modify-writes one growing global doc.
7. **`appsettings/office` overwritten whole** (`set(S.kdOff)`) from 12 writers (10381 … 16341) — concurrent edits clobber each other.
8. `kdNextNo` (10333) increments without a transaction; falls back to `kdogs().length+1` → duplicate contract numbers.
9. **Backups are incomplete**: `bkpRun` (8979) saves per-firm collections + `appsettings/schemes`, `appsettings/fx`, `settings/pay` only — missing `appusers`, `office_*`, `pnal`, `appsettings/office|tpl|doccodes|kdogNo|notice|bankfmt|owner`, `apptpl`, `appaml`, `appinbox`, `appaudit`, `applaw`, `office_apsent`; firm `logo/sign/stamp` stripped.
10. **Global state swapping**: `alWith` (8481), `withS` (8134), `lrCheck` (16645), `ddvFor` patch (11963) change `S.data`/`S.fid`/`S.year` temporarily — unsafe with async work.
11. `mhLog` (13412) files mail history under the currently open firm even when the e-mail concerns another firm; drafts not logged.
12. **NAV order bug**: 13428 inserts `mailhist` after `'opomeni'`, which only exists after 16988 → `mailhist` lands at the end of Материјално. `insp` uses a fixed index `Math.min(3,…)` (16569) and `lawrep`/`ujpZakoni` chain off it.
13. Dead wrappers dropped by later replacements: `pkgCoverHTML` 13489 (by 14785), `irClassify` 14029 (by 14044), `ncDocs` 15009 (by 15096), `opPdfHTML` 13335 (by 13382), `recDocHTML` 13705 (by 13747), `firmPicker` 3712 (by 14192).
14. `ACT.dosMail` wrapped 5×, each poking the DOM after render; `gmailSendParts` 12156 signs the body itself when there are no files but defers to 12134 otherwise.
15. ACT error-wrapping loop (17469) only covers handlers existing at that point; `APP_VER='v299'` (17458) stale.
16. Duplication: two ZIP/CRC implementations (8119, 7847); several Cyrillic→Latin tables (`WM_TR` 3236, `KL_TR` 9156, `BK_LAT` 12561, `NC_LAT` 15141) and Latin→Cyrillic (`LAT2CYR` 7834, `ART_L2C` 11241, `FK_LAT` 13014, `PX_LAT` 17256); two template systems; `klSimplePw = klStrongPw` (9155).
17. **Prefix clashes** that will confuse a mechanical port: `ap*` appointments (10125–10150) vs autopilot (16238+); `rec*` recurring invoices vs reconciliation (12909+, 13704+); `bk*` backup vs barcodes (9216) vs bank (12433, 12699); `fr*` firm report (12068–12081) vs freight (14441+); `kd*` contracts vs client dashboard (11562+); `pn*` travel orders vs payment notices vs pay notes.
18. Hard-coded values: EUR 61.5 (7095, 14989, 15001, 15868, 10461, 6491); `AP_CASH_LIMIT=61500` (16239); IBAN date `'2026-11-01'` (15761); `AL_DDV_LIMIT` (8478); `LR_INT=0.0003` (16596); `PP_TAX` accounts marked "проверете" (15753); `LN_K` defined at 16841 but used at 16745 (works only after load).
19. Small: `miClaim` confirm text in Albanian (14902); dead loop in `gmailSendParts` (8256); `firmiResh` reachable only through a redirect; `mz*` task actions have no `ACT_NEED`; `applaw` has no in-app writer (external robot).

## Phase 10 — Industry modules

Hotel, restaurant, auto service, rent-a-car, travel agency, transport (travel orders + freight for third parties), construction, appointments, trading extras (orders, purchase orders, replenishment, loyalty), production planning; module toggles (`mods`).

Watch first: travel orders don't persist (**`pnSave` collision**, item 4.1) and **construction and coupons share `S.cpEd`** (item 4.2).

### 10.1 Functions & constants

**Shared helpers** (9489–9509)

| Name | Lines | Purpose |
|---|---|---|
| `BZ_T` | **9490** (+ pushes 10194, 10325, 11844) | `docs` types exempt from client "pending" marking in `save()` (3301): hroom, hres, cveh, wo, rres + ord, po, lcard, coupon, rtable, rord, cproj, csit, cdiary, appt, cnote, recur, kdog, tarr, tbook |
| `bzD(t)` | 9491 | `S.data.docs` by type |
| `bzPad`, `ymd`, `addD`, `dDiff`, `ageAt`, `nowLoc` | 9492–9496, 9508 | Date helpers (noon local time) |
| `net4(gross,rate)`, `passK(k)` | 9497, 9498 | Gross→net (4 dp); konto starting `2` = pass-through (excluded from VAT turnover at 3610, 8879) |
| `bzNextNo`, `bzPartner`, `bzInvDraft`, `bzInvOf`, `bzSel`, `BZ_NAT`, `bzNatN`, `bzSoft` | 9499–9507 | Numbering `Р-001/2026`; find/create partner; invoice draft with link field; link lookup |

**Hotel** (config `firm.hot`)

| Name | Lines | Purpose |
|---|---|---|
| `HT()` | **9511** | `{tax:40, freeAge, halfAge, rate:5, revK:'7400', taxK:'2399', payer}` + `firm.hot` |
| `htRooms`, `htRes`, `HT_ST`, `htNights`, `htTaxUnits`, `htCalc`, `htOcc`, `htNew` | 9512–9519 | Tourist tax by age; nights × price + charges + tax − advance |
| `htListHTML`, `htEditor` (rd 9564), `htFolioHTML`, `htGuestRows`, `htStat` | 9534, 9535, 9569, 9619, 11808 | Folio PDF, guest book, ДЗС statistics |
| ACT (OA 9575) `htNewB … htSaveB 9585, htIn 9587, htOut 9589, htInv 9591, htFisc 9596, htCancel, htFolio, htClean`; (OA 9613) `htRoomNew/Ed/X/Save 9615, htCfgSave 9616`; `htKT` 9631, `htKPdf` 9631 → **11818** | | `htInv`: nights `net4(price,rate)` on `revK`, tourist tax rate 0 on `taxK` |

**Restaurant** — `rtables`, `rords`, `roOf`, `roTot` (9959–9962), `roEditor` 9968, `roSave` 9975; ACT (OA 9976) `rtNew/X/Save, roOpenT, roBack, roAdd (retailP), roQ, roNote, roSend, roPre, roPay 9986, roClose`, `kjReady` 9991.

**Auto service** (config `firm.auto`) — `AU()` 9634 `{hr:1000, km:15000, mon:12}`; `plN`, `pnN` (part-number normaliser), `cvehs/cveh`, `wos`, `WO_ST`, `woSt` (9635–9640); `woCalc` 9641 (net + VAT); `vehLbl`, `woNew` 9643, `woEditor` 9650, `woFindItem` 9673, `woPdfHTML` 9674; `partNums` 9711, `MK_AL` 9712, `fNorm`, `mkAl`, `fitsVeh` 9715; `potRows` 9731. ACT (OA 9681) `woNewB … woSaveB 9689, woInv 9690, woPdf`; (OA 9704, 9729, 9741) `cvNew/Edit/X/Sel, cvSave 9706, dlSel, dlToWo, potDone, potMail, autoCfgSave`.

**Rent-a-car** (config `firm.rent`)

| Name | Lines | Purpose |
|---|---|---|
| `RC()` | **9749** | `{rate:18, revK:'7400', depK:'2222', fuel8:600, grace:2, minAge:21, minLic:2, sPct:0, sFrom:'06-15', sTo:'09-15', terms}` |
| `rcFleet` | 9750 | `assets` with `(vehicle\|\|plate) && rent` |
| `rcRes`, `RC_ST`, `rcSt`, `rcDT`, `rcDays`, `rcInSeason`, `rcRent`, `rcOcc`, `rcNew`, `rcClash` | 9751–9764 | Grace hours, seasonal markup, weekly price from 7 days |
| `rcCalc` | 9758 → **11661** (agreed `pDay`) | |
| `rcEditor` | 9777 → **11664** (scan, nationality, EMBG, documents, countries, green card, `pDay`) | |
| `rcPdfHTML` | 9801 (dead) / **11727** `(r,copy)` (hoisted winner) | Rental contract |
| `RC_CT`, `RC_CHK`, `RC_DOC_PROMPT`, `rcIsoD`, `rcAbroad`, `rcCtName`, `rcScanDoc`, `rcPdfDoc`, `rcFuelSvg`, `RC_CAR_SVG` | 11648–11725 | ID/licence scan via AI |
| `izTabs`, `izMo`, `rcRev`, `RI_T` | 11772–11777 | Reports |
| ACT (OA 9809) `rcNewB … rcSaveB 9815, rcRet 9818, rcInv 9820, rcDepIn 9823, rcDepBack 9825, rcCancel`; `rcOut` 9816 → **11718**; `rcPdf` 9831 → **11717**; `rcScanRm`, `rcSavePdf` 11715–11716; `rcFleetSave` 9840, `rcCfgSave` 9841; `riT`, `riPdf` 11803 | | Deposit: cash receipt on `depK`; return → journal `kauc` |

**Travel agency** (config `firm.tour`)

| Name | Lines | Purpose |
|---|---|---|
| `nkdProf` | 10217 → **11845** | NKD division 79 → `['travel']` |
| `TU()` | **11846** | `{agg:'period', revK:'7400', advK:sch('advance')\|\|'2220', passKonto:'2290', comm:10, lic, guar, abroadEx, terms}` |
| `TA_ST`, `TA_OWN`, `TA_CAT`, `tarrs`, `tbooks`, `tbTot`, `tbPaid`, `tbPax`, `taOwn`, `taCost`, `taCalc`, `taNew`, `tbNew` | 11847–11859 | Arrangements, bookings, margin (VAT 18/118) |
| `taEditor` (rd 11887), `tbEditor` (rd 11902), `taFirmLine`, `taProgHTML`, `tbPdfHTML`, `tbVouHTML`, `taPaxHTML` | 11868–11925 | Programme, travel contract, voucher, passenger list |
| `tuMarginFor` + `ddvFor` patch **11963**, `purchaseEntries0` patch **11993**, `ACT.crFrom` patch **11992** | 11961–11993 | Margin VAT (Phase 5) |
| ACT (OA 11928) `taNewB … taSave 11932, tbSave 11938, tbPay 11941, tbInv 11946, tbAdv 11951, tbCancel, tbPdf, tbVou, taCfg, taCfgSave`; (OA 11987) `tuT, tuPdf, tuVatPost 11989` | | `tuVatPost` → journal `tourVat` (D revK / P VAT_OUT[18]); `tbAdv` → journal `tadv` |

**Transport: travel orders** (`pn*`, 9223–9488; stored in global collection **`pnal`**, not per-firm `docs`)

| Name | Lines | Purpose |
|---|---|---|
| `PN`, `pnFirm` | 9224–9225 | `OF().pn` (subscribed at 7869) filtered by `fid` |
| `pnVehicles`, `pnDrivers`, `pnNextNo`, `pnGood`, `pnStopsFrom`, `pnNew`, `pnUnassigned` | 9226–9235 | Stops built from invoices, dispatch notes, purchases |
| `pnGeo`, `pnMap` | 9239–9240 | GPS |
| **`pnSave(d,quiet)`** | **9241 — dead, overridden by 15239** | Intended to write `pnal/{id}` |
| `PN_ST`, `pnOdo`, `pnKgOf`, `pnLoad`, `pnSvc`, `pnDur`, `pnDnev`, `pnHM`, `pnPlace`, `pnRoute`, `pnRouteHTML`, `pnImg`, `pnKey`, `pnCashPosted`, `pnRetMade`, `pnHold` | 9242–9258 | |
| `pnDefsHTML`, `pnStopOfficeHTML`, `pnEditor`, `pnPdfHTML`, `pnPodHTML`, `pnImgInline`, `podFor`, `pnUpd` | 9273–9335 | Editor, PDF, proof of delivery |
| `pnDriverStopHTML`, `pnScanHTML`, `pnScanListHTML`, `pnKeep`, `pnSigInit`, `pnDu2Blob`, `pnUpload`, `pnEvent`, `pnScanInit/Loop/StopCam/Code` | 9369–9413 | Driver phone flow (barcode scan, signature, photo) |
| `pnLiveStart/Stop`, `pnDist`, `pnAgo`, `pnTrackSVG`, `pnFuelRows`, `pnFuelAlerts`, `pnDnevRows` | 9437–9463 | Live positions, fuel, per diems |
| ACT (OA 9337) `pnNewB, pnFromDay, pnOpen, pnBack, pnStopRm, pnManual, pnSaveB 9344, pnlDel 9347 (deletes pnal/ directly), pnPdf, pnPod, pnDefs, pnDefsSave, pnCashPost 9352, pnRetCr 9357, pnMail 9360`; (OA 9417, 9457, 9479) `pnScanGo/Stop/Full, pnSigClr, pnCashAll, pnDep 9423, pnDeliv 9424, pnRet 9433, pnLiveSel, pnGT, pnGV, pnSvcDone, pnDnevPdf`; `docView` → **9486** (POD button) | | |

**Transport: freight for third parties** (v469, 14439–14716)

| Name | Lines | Purpose |
|---|---|---|
| `FR_CTRY` | **14441** | `[code, name, per-diem amount, currency]` (46 countries, foreign per-diem regulation) |
| `FR_ST`, `FR_DOCV`, `FR_DOCD`, `FR_RED` | 14442–14445 | Statuses, vehicle/driver document types, per-diem reductions |
| `frTours`, `frDocs`, `frFuelImps`, `frCfg` (doc id `frcfg`), `frRate`, `frCtryN`, `frCtryOpts`, `frVeh`, `frDrv`, `frNextNo` (`Т-001/2026`) | 14446–14455 | |
| `frUnitsH`, `frSegAuto`, `frSegUnits`, `frDnev` | 14458–14464 | Per diems: 24 h = 1, >12 h = 1, 8–12 h = ½, split by country |
| `frPriceMkd`, `frPl`, `frFuelRows`, `frTourFuel`, `frCost`, `frExp`, `frExpFor` | 14467–14476 | |
| `frEditor` | 14503 → **14703** | |
| `frRead`, `frDnevPdfHTML`, `FR_COLS`, `frNum`, `frDate`, `frTrailers` | 14527, 14575, 14623, 14640–14641, 14692 | Fuel-card import columns (DKV, Shell, OMV, Eurowag) |
| ACT `frFilt, frPick, frNew 14500, frOpen, frCancel, frSegAdd/Rm, frSave 14533, frDel, frInv 14540, frTXlsx, frCmr 14557, frDnPdf, frNewDn, frOpenDn, frDmoGo, frCfgT, frCfgSave 14598, frDnDrv, frDocNew/Ed/Cancel/Save/Del, frGmoGo, frGCancel, frGRead, frGSave 14642, frGDel, frQuick, frQuickSave` | 14498–14697 | `frInv` builds `S.draft` itself (not `bzInvDraft`); `saveInv` → **14549** marks tours invoiced |

**Construction** (config `firm.cons`) — `CN()` 10045 `{hr:350, revK:'7400'}`; `cprojs`, `csits`, `cdiar` 10046; `boqVal`, `sitPrev`, `sitCalc`, `projCosts` 10047–10050; `cpEditor` 10057 (rd 10081/10082/10083), `csPdfHTML` 10085; `cpRow` 11821; ACT (OA 10089) `cpNewB … csSave, csInv 10099, csPdf, pcLink, cdNew/Open/X, cdMach, cdSave, cdPdf, consCfgSave`; `gaT`, `gaPdf` 11838; `MK_CITIES`, `kdCity` 11607–11608.

**Appointments** (config `firm.svc`) — `SV()` 10111, `appts`, `tMin`, `svRes`, `APT_ST`, `aptClash`, `aptWho` (10112–10117), `apEditor` 10125, `apMsg` 10134; ACT (OA 10136) `apNewB, apCell, apOpen, apBack, apDay, svCfg, svCfgSave, apSaveB, apCancel, apRem, apRemOne, apRemAll, apKasa, apInv`; client cards `VIEWS.kartoni` 10153 + ACT `kcEdit/kcNew/kcSel/kcX/kcRd/kcSave/kcPdf` (10166–10169).

**Trading extras, production planning, dashboard**

| Name | Lines | Purpose |
|---|---|---|
| `ORD_ST`, `ords`/`pos`, `ordDeliv`, `ordRest`, `ordSt`, `reservedQty`, `onOrderQty`, `availQty`, `lastSupplier`, `ordEditor`, `itemByLbl`, `ordPdfHTML`, `poCreate`, `poPdfHTML`, `replRows` | 9860–9918 | Customer orders, purchase orders, replenishment |
| ACT `ord*` (OA 9887), `po*` (OA 9908), `replCfg/replMake` (OA 9926) | | |
| `LOY`, `lcards`, `coupons`, `lcFind`, `cpCheck`, `posDisc`; `VIEWS.kasa` → **9937**; `posSell` → **9940** | 9931–9940 | Loyalty and coupons in the till |
| ACT loyalty (OA 9951) `loyT, lcNew/Edit/X/Save, cpNew/cpEdit/cpX/cpSave, loyCfgSave` | | |
| `mrpCalc`, `mrpDemand`, `lotIns`, `lotBal` (FEFO); ACT `mrpReset/Po/Prod` 10009–10012, `pcCfgSave` 10022, `lotT/lotDays/lotSave` 10037–10040 | 9994–10040 | |
| `kdActivity` | 11612 → **11997** | Industry cards on the client dashboard (gated by `modOnF`) |

**Module wiring**

| Name | Lines | Purpose |
|---|---|---|
| `MODS` | **10201–10214** (+ push `tour` 11995, `frt` 14649; `frFak` 14689) | `{k, n, v:[views], p:[profiles]}` |
| `MOD_OF` | 10215 (+11995, 14649, 14689) | View → module |
| `nkdOf`, `nkdProf` (→ **11845**), `PROF_N`, `firmProf` (`firm.kl.prof`), `profAuto`, `modOnF` (`firm.mods[k]` override else profile) | 10216–10225 | |
| `MOD_OFFICE` | 10227 | mrp, lot always on for office users |
| `viewOn` → **10410**, `navFilter` 10229, `navFor` → **15975** | | |
| `VIEWS.moduli` | 10231 → **10531** | Toggles → `saveFirmPatch({mods})` (10240) |
| ACT `modAutoProf`, `modPick`, `modEnable` | 10244–10246 | |
| `KL_PROF` pushes, `KL_SEC` pushes | 9855, 10195, 10200, 11844; 10196, 11996 | |
| `DEJ_V` | 16989 (filled 16990–16995) | Views moved to Дејности |

### 10.2 Data shapes (all in per-firm `docs` unless noted)

| type | Fields | Source lines |
|---|---|---|
| `hroom` | `no, kind, beds, floor, price, active, hk` | 9615, 9589 |
| `hres` | `number, date, room, from, to, guestName, phone, email, adults, children, price (gross), board (RO\|BB\|HB\|FB), partner, src, advance, guests[{name, birth, nat, doc, docNo, sex, police}], charges[{date, name, itemId, qty, price, rate, konto}], status (resv\|in\|out\|cancel), note, noTax, inAt, outAt, folio` | 9519, 9564 |
| `rtable` | `no, area, seats` | 9978 |
| `rord` | `table, opened, waiter, lines[{itemId, name, qty, price, rate, sent, ready, note}], status (open\|paid\|void), paidAt` | 9979–9987 |
| `cveh` | `plate, vin, make, model, year, engine, fuel, partner, km, note, remindAt` | 9706 |
| `wo` | `number, date, veh, plate, partner, km, complaint, work, parts[{itemId, name, qty, price, disc, rate}], labour[{name, itemId, hrs, price, rate}], status (open\|work\|done), mech, nextKm, nextDate, nextNote` | 9643, 9668 |
| `rres` | `number, date, veh, plate, from, to, drv{name, birth, addr, doc, lic, licFrom, licExp, phone, email, nat, embg, docType, docExp, docIss, licCat, emerg, scans[]}, drv2, partner, deposit, extras[{name, qty, price}], status, note, out/ret{km, fuel(0–8), dmg, photos, sig, at}, pDay, countries[], green, auth, depIn, depP, depKept, depOut, depClosed` | 9763, 11693 |
| fleet (`assets`) | `rent, rClass, rDay, rWeek, rDep, rKm, rKmX, odo`; trailers `trailer, plate` | 9834–9840, 14692 |
| `tarr` | `code, date, name, dest, countries, from, to, kind (own\|agent), seats, price, priceCh, comm, prog, incl, excl, costs[{cat, who, desc, amt, cur, fx, pid}], status` | 11858, 11887 |
| `tbook` | `number, date, arr, cli{name, phone, email, addr}, partner, adults, children, extra, disc, priceTot, pax[{name, birth, nat, doc, docExp}], pays[{date, amt, how, blg, no}], room, note, status, payP, advDone` | 11859, 11941–11951 |
| `cproj` | `code, name, site, city, investor, cno, cdate, start, end, nadzor, eng, art32, boq[{pos, desc, unit, qty, price}], status, photos` | 10090, 10081 |
| `csit` | `proj, no, kind (int\|fin), date, from, to, cum{lineIdx: qty}` | 10096, 10082 |
| `cdiary` | `proj, date, weather, temp, works, mat, issues, nadzor, workers[{emp, name, hrs, rate}], mach[{name, hrs, rate}], photos` | 10102, 10083 |
| `appt` | `date, time, dur, res, partner, client, phone, email, svc, price, status, note, remind` | 10137, 10132 |
| `recur` | see Phase 9 | 10184 |
| `ord` | `number, date, partner, dDate, items[{itemId, name, unit, qty, price, disc, rate, konto}], note, status` | 9888–9890 |
| `po` | `number, date, partner, items[{itemId, name, unit, qty, price}], status (open\|recv\|cancel), src, recvAt` | 9899, 9912 |
| `lcard` | `no, name, phone, email, disc, points, spent, visits, last, log[≤50]` | 9953, 9940 |
| `coupon` | `code, kind (pct\|amt), val, from, to, max, minT, used` | 9955 |
| `frt` | `number, date, status, partner, order, km, vehicleId, trailer, driverId, driver2Id, loadPlace, loadC, sender, unloadDate, unloadPlace, unloadC, consignee, goods, packages, kg, m3, adr, docsAtt, price, cur, fx, vat (intl\|dom), red, tolls, tollCur, otherCost, note, segs[{c, in, out, units}], invoiced, invNumber` | 14500, 14527, 14549 |
| `frdoc` | `who (veh\|drv), ref, kind, no, validFrom, validTo, note` | 14618 |
| `frfuel` | `name, at, rows[{d, plate, ctry, prod, qty, amt, cur}]` | 14642 |
| `frcfg` | `id:'frcfg', rates{code:[amt, cur]}` | 14599 |
| travel order (global **`pnal`**) | `fid, date, number, vehicleId, plate, vname, driverId, driver, codriver, from, purpose, stops[{ref{type,id}, kind (pick\|deliv), doc, partner, pid, email, addr, goods[{item, ix, name, qty, unit, kg, bc[], loaded, lq}], amt, open, status, at, geo, recv, photo, sig, cash, ret[{k,qty}], mailed}], depKm, retKm, fuelL, fuelAmt, assignee, dnev, status (open\|onroad\|done), events[{k, txt, at, geo, by}], track, pos, updated` | 9233, 9405, 9430 |

Link fields on other records — invoices: `hresId, woId, rresId, ordId, csitId + proj, apptId, tbookId + tourM, frTours/frCur/frTot, recurId, pnRet, fromTable`; purchases: `tarr, noDed, proj, lots`; cash vouchers: `rcRef, tbRef, pnRef, proj`.

Firm config: `hot` (9616), `auto` (9745), `rent` (9841), `tour` (11957), `cons` (10106), `svc` (10142), `loy` (9956), `repl` (9927), `pnDef` (9351), `pcost` (10022), `lotDays` (10039), `mods` (10240), `kl.prof`/`kl.profSet` (10244), `nkd`/`activity`.

### 10.3 Screens

| View | Lines (final **bold**) | Menu label | MODS key |
|---|---|---|---|
| `hotel` / `hotelSoby` / `hotelKniga` | **9521** / **9602** / 9620 → **11809** | 🏨 Хотел – рецепција / соби и цени / книга на гости | hotel |
| `restoran` / `kujna` | **9963** / **9989** | 🍽 Ресторан – маси / 👨‍🍳 Кујна / шанк | rest |
| `servis` / `vozila` / `delovi` / `potsetnici` | **9645** / **9696** / **9716** / **9735** | 🔧 Сервис … | auto |
| `rent` / `flota` / `rentIzv` | **9766** / **9834** / 9844 → 11778 → **11805** | 🚗 Rent-a-car … | rent |
| `gradba` / `gradbaIzv` | 10055 → 10108 → **11839** / **11823** | 🏗 Градежништво … | cons (`gradbaIzv` has no MODS entry) |
| `termini` / `kartoni` | **10118** / **10153** | 📅 Термини / 🗂 Картони | appt |
| `periodicni` | … **13597** | 🔁 Периодични фактури | recur |
| `porachki` / `nabavki` / `dopolnuvanje` | **9870** / **9900** / **9920** | 🧾 / 📦 / 🔄 | ord / buy / buy |
| `lojalnost` | **9943** | 💳 Лојалност и купони | loy |
| `mrp` / `prodCost` / `lotovi` | **10000** / **10015** / **10027** | 🏭 MRP / Реална цена / 🏷 Лотови | mrp / mrp / lot |
| `tura` / `turaIzv` | 11861 → **11958** / **11966** | ✈ Туристичка агенција … | tour |
| `pnalozi` / `pnLive` / `pnGorivo` | **9259** / **9452** / 9464 → **14654** | 🚚 Патни налози / 🛰 / ⛽ | pn |
| `mojpn` | **9384** | 🚚 Мои патни налози (office) | — (`OFFICE_V`) |
| `frTuri` / `frFak` / `frDnev` / `frGor` / `frDok` | **14479** / **14682** / **14580** / **14624** / 14603 → **14667** | inserted after pnGorivo (14651, 14690) | frt |
| `moduli` | 10231 → **10531** | 🧩 Модули по дејност | — |
| `klDash` | 11588 → **11642** | 📈 Табла – анализа на работењето | — |

Menu: static NAV has restoran/kujna/lojalnost under Малопродажба and orders/pn/mrp under Материјално; 16983–16985 builds the Производство submenu; 16990–16995 moves every `MOD_OF` view except mrp/prodCost/lotovi into Дејности and fills `DEJ_V`.

### 10.4 Inconsistencies / bugs to fix deliberately

1. **`pnSave` collision (critical)** — travel-order saves (9346, 9366, 9416, 9419, 9420, 9423, 9430, 9433, 9440) run the payroll-notes `pnSave(L)` (15239): the travel order is written into `firm.payNotes` (overwriting pay notes), nothing reaches `pnal/`, `OF().pn` isn't updated; afterwards `pnOf(f).filter` throws in `pnCard`. Legacy data may contain travel orders inside `firm.payNotes` — the importer must detect and split them.
2. **Shared UI state**: `S.pnEd` (travel orders 9259 vs pay notes 15240–15257); `S.cpEd` (coupon editor 9954 vs construction project 10055 — opening a coupon then `gradba` renders the coupon as a project); `cp_` DOM id prefix shared.
3. `rcPdfHTML` duplicate (9801 dead, 11727 live); `ACT.rcPdf` 9831 replaced by 11717.
4. **Hard-coded accounts**: revK `'7400'` (HT, RC, CN, TU, `recLAdd` 10185, `frInv`), hotel taxK `'2399'`, rent depK `'2222'`, travel passKonto `'2290'` / advK fallback `'2220'`, `pnCashPost` konto `'1200'` (9354). Only auto service uses `sch('revGoods'/'revService')`. `passK` heuristic depends on these numbers.
5. **Hard-coded VAT rates**: 18% in `csInv` (10099), `taCalc`/`tuMarginFor` (18/118), `tbInv` commission, `frInv` (dom 18 else 0), `apKasa`/`apInv`, `woPAdd/woLAdd/dlToWo` fallbacks, `RC.rate`; hotel default 5%.
6. **Gross vs net inconsistent**: hotel, rent, appointments enter gross (→ `net4`); auto service `woCalc/woInv` (9641, 9690) and `csInv` enter net; restaurant/appointment POS gross `retailP`; `rcInv` uses `net4(c.rent/c.days)` × days (rounding drift).
7. Config keys don't match module names: `firm.hot`, `firm.rent`, `firm.tour`, `firm.svc`; freight config is a `docs` record `frcfg`.
8. `BZ_T` lacks `frt, frdoc, frfuel, frcfg` → client-role saves mark them `pend:true`.
9. **Module toggles only restrict clients**: `viewOn` returns true for any non-client view in `DEJ_V` (16989); office users always see every module; `gradbaIzv` and `mojpn` not in `MODS`; `kdActivity` uses `modOnF`, not `viewOn`.
10. Restaurant `roPay` (9986) marks the bill paid before the till sale exists.
11. Hotel `htInv` ignores `advance` (no offset or journal); `kdActivity` filters a `noshow` status that `HT_ST` doesn't define.
12. Numbering: `cpNewB` = `cprojs().length+1` (duplicates after delete); `poCreate` loops `bzNextNo('po')` before saves land; only `frSave` checks duplicates.
13. `ddvFor` wrapper (11963) — see Phase 5 item 6.
14. Freight fuel window: `frTourFuel` reads `t.retDate`, never set by `frRead` — return-leg fuel excluded.
15. Cross-module coupling: rent-a-car uses `pnUpload`, `pnDu2Blob`, `pnImgInline`, `S._pnSig`; freight uses `pnVehicles`; `frInv` bypasses `bzInvDraft`.
16. `FR_CTRY` per-diem table and `TU().terms`/`RC().terms` defaults are hard-coded (MKD, Macedonian legal text) — move to reference data.

## Phase 11 — Legacy import

`packages/legacy-import`: backup JSON → Postgres + MinIO, journal recompute, trial-balance verification. This section lists what the legacy app can export, what the importer must understand, and where legacy data is known to be dirty.

### 11.1 Legacy export formats

| Name | Lines | Output |
|---|---|---|
| ACT `backupJson` | **5060** (ET_ACT) | One firm, downloaded: `{firm, exported, data:{<14 COLS>:[…]}}` (`firm` includes `logo/sign/stamp`) |
| `bkpRun(auto,prog)` | **8979** | All firms → one asset per firm `backup_<fid>.json` = `{v:1, at, firm (without logo/sign/stamp), data:{<COLS>}}`; index doc `backups/{bk-YYYYMMDDHHMMSS}` = `{id, at, date, auto, by, firms, size, files:[{fid, name, asset, url, size, counts{<col>:n}}], glob:{'appsettings/schemes', 'appsettings/fx', 'settings/pay'}}`; keeps `BKP_KEEP=30` (8976) |
| `bkpLoadFirm`, `bkpList`, `bkpFetch` | 8977, 8978, 8986 | Read a firm's collections; list backups; fetch `/_blob/<asset>` |
| `bkpRestoreFirm(B,prog)` | **8987** | Restore = replace firm record + delete docs not in backup + set all docs (useful as the reference for "what a backup contains") |
| `VIEWS.sistem`, `bkRestHTML`, ACT `bkNow/bkZip/bkRestoreOpen/bkRestClose/bkRestoreGo` | 8992, 9006, 9012–9017 | Backup UI (daily auto backup via `localStorage bk_last`) |

**Not in any backup** (needs the "export everything" button planned in PLAN.md Step 6): `appusers`, `appaudit`, `appinbox`, `applaw`, `appmpin`, `appaml`, `apptpl` (+ chunks), `apperrors`, `appsettings/office|tpl|doccodes|kdogNo|notice|bankfmt|owner`, `office_tasks`, `office_tpl`, `office_newco`, `office_apsent`, `pnal`, firm `logo/sign/stamp` (bkpRun strips them), and every **asset** referenced by `files[]` arrays / `/_blob/<id>` strings (backups only hold ids). Full path list: Cross-cutting C.5.

### 11.2 Mapping notes per collection

| Legacy | Target (PLAN.md Step 3) | Importer notes |
|---|---|---|
| `firms/{fid}` | `firms` + `settings jsonb` | Settings blobs per phase: Phase 2 (`lock, accounts, sch, vat*, nalCodes, nalNo, nalogMode, banks, izv*, crMode, bbAnK`), Phase 4 (`rules, osnovK, posK, posP, autoNotify, blg`), Phase 6 (`mpinTpl, payNotes, hrPrefix, pddTypes`), Phase 7 (`fiskOpt, fiskDev, lotDays, pcost, prodRawK`), Phase 8 (`zsRules, zsMan, dbAdj, vpAdj, dldAdj, deMan, f35Raw, nkdAop, actMap, zsNotes, belSnap, zsArch, zsAck, crmPeriod, ent, lf, aop`), Phase 9 (`contacts, kl, kdog, recAuto, opRate, alAck, insp, lnIgnore`), Phase 10 (`hot, auto, rent, tour, cons, svc, loy, repl, pnDef, mods`). Logo/sign/stamp may be data-URLs or `/_blob/<id>` (`firmSlim` 14221). |
| `codes` | `codes` / `accounts`… by `cb` | `cb` ∈ CB keys (6947): cenovnik, store, warehouse, cash, oe, vehicle, location, route, position, paysif, city, municipality, currency, fgroup, country, hall. `warehouse`/`store` rows = locations. |
| `partners`, `items` | `partners`, `items`(+barcodes, supplier codes) | Strip leaked `rate/konto/type` from partners (Phase 2 item 17); `aliases[]`; `sp{wh}` retail prices. |
| `invoices`, `purchases`, `sales`, `payroll`, `journal`, `moves` | documents + `journal_lines` | Use stored `lines` as posted snapshot **plus** `ed{}`/`edAdd[]` overlays (3450–3457). Credits: flip when `firm.crMode` is 'minus' (`stF` 3444). Skip `pend:true` from the ledger but import them as pending drafts. |
| `bank` | `bank_statements`, `bank_lines` | Group by `acct`+`date` → statement (`izv-<acct>-<date>`, number from `firm.izv`); recompute journal lines with `bankEntries` (3384 + 12760) — stored `lines` may be stale. |
| `docs` | per type (`firm_docs` jsonb first) | Types seen: `arch, inbox, maillog, recur, kdog, pp, loan, hr, pdd, mpinack, blg, komp, paynote, supcr, outscan, proforma, dispatch, nivel, prenos, mout, akcija, rasnorm, hroom, hres, rtable, rord, cveh, wo, rres, tarr, tbook, cproj, csit, cdiary, cnote, appt, ord, po, lcard, coupon, frt, frdoc, frfuel, frcfg`. Ledger-relevant docs (`blg, pdd, komp, supcr, nivel`) are posted **live** — compute lines with the legacy functions (`blgEntries` 6518, `pddEntries` 8322, `kompEntries` 8924, `scrEntries` 8768, nivel block 3461). Drop `outscan` (transient queue). |
| `assets` | `assets` | Rent-a-car fleet fields, `photos[]`. |
| `production` | `production_orders` | |
| global `pnal` | travel orders | Also look **inside `firm.payNotes`** — the `pnSave` collision (Phase 6 item 4) wrote travel orders there. |
| `appusers` | `users`, `user_firms` | Hash `p2$150000$<hex>` = PBKDF2-SHA256 (salt `'wc\|'+salt`, 32-byte key) → verify at first login then rehash with argon2; legacy `sha256(salt+'\|'+pw)` hashes may remain; **do not import `pw0`** (plaintext). `firms:['*']` = all firms. |

### 11.3 Recompute & verify

- **Port `ledger()` to the importer** (3448 + wrappers 12429, 17424) for verification: it is per `S.year` (`inYear`), skips `pend`, adds VAT-basis off-balance lines (994/999) via `vbLines`, applies `sideFlips` (`gsch.sides`) and `extraLines` (`gsch.extra`). Run once per year present in the data.
- **Trial balance** = `bbRows` (6650 → 13619) semantics: opening = `journal.kind==='open'` only; `bbimp-Y` imported balances and `close-Y` count as turnover (Phase 2 item 12) — decide how to treat firms that have both `bbimp` and real documents.
- Verify per firm/year, account by account: legacy ledger totals vs new `journal_lines` totals; also VAT-04 (`ddv04` 5905) for each closed period (`journal.kind==='ddv'`).
- Stock: recompute weighted average with `reaverage` semantics (5101) — don't trust `moves.value` of outbound moves written while `stockAt` was broken (Phase 7 item 1).

### 11.4 Known dirty data to expect

1. `SCH_OLD` account values stored in `firm.sch` / `appsettings/schemes` that the app silently ignored (3177) — import the *effective* value, not the stored one.
2. Firm/global VAT konto overrides containing `VAT_BAD` values (2300, 1300…) — `vatImp` never validated (3170).
3. Result accounts 951/961 vs 950/960 vs 9500/9600 mixed across years (Phase 8 item 1).
4. Duplicate document ids: `docs/mpin-{mo}` (Phase 6 item 11), `hr-contract-{empId}-` with empty number (Phase 6 item 16); duplicate numbers from count+1 numbering (`nivel`, `akcija`, `cproj`, `kdog`).
5. Travel orders inside `firm.payNotes`; pay notes overwritten by travel orders.
6. Transient fields persisted (`fuelOk`, `_scan`, `_newSup`, `auto`, `calcAuto`, `autoShift`, `lateOk`, `dt`, `kind`) — drop.
7. Typed numbers stored as strings in invoice lines (`qty`, `price` as entered) — parse with the legacy rules (`fkN` 11344 / `impNum` 5391 style; comma decimals).
8. Moves with signed `qty`/`value`, field `item` (not `itemId`); orphaned transfer moves after `lgDel` (Phase 7 item 12).
9. Payroll v1 documents (`employees[].gross`, no `v:2`) if any survived.
10. Client-submitted documents with `pend:true` that were never approved.
11. Firms where `firm.per` was switched month↔quarter after VAT closes (journal ids `ddv-2026-Т1` vs `ddv-2026-01`).

### 11.5 Assets

Every file reference is an asset id from `claude.use('assets')`, stored as `{id, name, type, size}` in `files[]`/`photos[]`/`scans[]` arrays, or as `/_blob/<id>` strings (firm images, `pnImg` 9254, `kdImg` 11609), or as data-URLs (older firm images, signatures `sig.data`). The importer downloads `/_blob/<id>`, uploads to MinIO under `firms/{firmId}/{yyyy}/{uuid}.{ext}`, records sha256, and rewrites references into `files`/`file_links`. Word templates live as base64 chunks in `apptpl/{id}_p{i}` (300 KB each, `TPL_CHUNK` 16002).

## Reference data to extract as seed JSON

Sizes are UTF-8 bytes of the literal (Cyrillic = 2 bytes/char); counts are top-level elements. All are single `const` literals unless noted, so they can be extracted by evaluating the line range in a sandbox (`vm`) — the golden-test harness (PLAN.md Step 4) can reuse that loader. Destination suggestion: `packages/db/seed/<name>.json`.

### R.1 Large (> 10 KB)

| Constant | Lines | Size | Count / shape | Seed target / notes |
|---|---|---|---|---|
| `FORM_BG` | **3942** (one line) | **560 KB** | 4 base64 JPEGs: `f_ujp_ddv_dobr_0`, `f_ujp_ddv_dobr_1`, `f_ujp_ddv_prom_0`, `f_ujp_kod` | Decode to JPEG files → MinIO (`static/forms/…`); keep only keys in JSON |
| `KONTO_SRC` | **308–3166** (template string; parsed by `KONTO` 3167) | **222 KB** | 2,859 lines `konto\|name`; codes 2–10 digits (70×2, 438×3, 1,297×4, 577×5, 171×6, 135×7, 74×8, 95×9, 2×10); no duplicates | `accounts.json` — Macedonian chart of accounts. Typo in first line ("тргвоски"). Per-firm overrides live in `firm.accounts` |
| `ACT` literal | 7004–7408 | 108 KB | 278 handlers | Code, not data — listed for completeness |
| `INSP` | **16474–16526** | 23.6 KB | 40 checks (УЈП / ДПИ / ДИТ inspection readiness; contain `check` functions) | Split: texts → JSON, check logic → code |
| `ZS_DEF` | **7411–7617** | 22.2 KB | 205 rows `[r, aop, name, konta, sign, formula]` (see Phase 8) | `aop-rules.json` (ЦРМ forms 36/37). Plus `ZS_FIX` 7618 (5 forced formulas) |
| `DE38` | **10976–10979** | 15.0 KB | 124 rows `[aop, label]` (form 38, AOP 601–724) | `crm-form38.json`; plus `DE38_AUTO` 10981–10985 (38 rules, 1.6 KB) |
| `LR_RULES` | **16612–16644** | 14.4 KB | 16 tax-review rules (with functions) | Texts/thresholds → JSON, logic → code |
| `DB_F` | **10748–10827** | 14.2 KB | 79 rows (ДБ, УЈП 6-2020, АОП 01–70) | `db-form.json`; plus `DB_MIG` 10828 (11 legacy key → AOP) |
| `FORMS0` | **3943** (JSON-style literal) | 13.3 KB | 3 official forms (`f_ujp_kod`, `f_ujp_ddv_dobr`, `f_ujp_ddv_prom`) with `fields[{k,src,t}]` positioned over `FORM_BG` | `forms.json` |

### R.2 Medium (1–10 KB)

| Constant | Lines | Size | Count / shape | Notes |
|---|---|---|---|---|
| `NAV` | 3184–3199 | 8.8 KB | 14 groups | Menu (plus runtime mutations, Cross-cutting C.2) |
| `NPO_ACC` | 10412–10420 | 7.5 KB | 125 `[konto, name]` | NPO chart (Сл. весник 117/05) |
| `DIG` | 10267–10283 | 7.0 KB | 13 import definitions | Digitalisation import (PDF/Excel → records) |
| `CT_POS` | 15517–15523 | 6.9 KB | 5 job positions with duties | Contract templates |
| `IMP_T` | 5381–5388 | 5.8 KB | 7 import types (column aliases) | Generic Excel import |
| `XT` | 6899–6910 | 5.4 KB | 4 Excel templates | |
| `NPO_BS` / `NPO_PR` / `NPO_CO` / `NPO_SCH` | 10423–10435 / 10436–10443 / 10444–10449 / 10421 | 5.3 / 3.9 / 1.3 / 0.4 KB | 73 / 54 / 70 / 30 | NPO forms, company→NPO AOP map, NPO posting scheme |
| `PSIF0` | 6223–6256 | 5.3 KB | 33 payroll line codes 001–603 | `payroll-codes.json` (percentages conflict with `HTYPES`, Phase 6) |
| `ET_ACT` | 5055–5073 | 4.9 KB | 8 handlers | Code |
| `SCH_UI` | 5171–5178 | 4.4 KB | 7 scheme-editor cards | |
| `UVH` | 17199–17217 | 2.8 KB | 2 hubs | Import hub layout |
| `CT_OBL` | 15572–15577 | 3.5 KB | 4 obligation sets | Contract clauses |
| `UJP_AREAS` | 16773–16785 | 3.4 KB | 12 areas with УЈП law links | |
| `NKD21` | **10995** (comma string) | 3.2 KB | 651 NACE Rev 2.1 class codes (4-digit) | `nkd21.json` — order defines form 35 AOP (= 4000 + index) |
| `AUTH_ACT` | 5498–5511 | 3.2 KB | 7 handlers | Code |
| `BEL` | 10905–10918 | 3.1 KB | 15 explanatory-note sections | |
| `TPL0` | 3935–3941 | 2.9 KB | 6 request templates (`b_ujp_potvrda`, `b_crsm_tekovna`, `b_ovlastuvanje`, `b_banka`, `b_slobodno`, `b_opstina`) | `request-templates.json` |
| `PDF_CSS` | 3204–3229 | 2.8 KB | CSS string | Into `legacy.css` / print CSS |
| `KL_SEC` | 9029–9047 | 2.8 KB | 18 client-portal sections | |
| `PXL_COLS` | 14737–14739 | 2.8 KB | 28 payroll Excel column alias sets | |
| `PP_LAY` | 15779–15789 | 2.8 KB | 3 payment-order print layouts (mm) | |
| `DDV04` | 5888–5904 | 2.5 KB | 31 ДДВ-04 fields | `vat04-fields.json`; plus `DDV_ROWS1` 5917 (13, 1.9 KB), `DDV_ROWS2` 5918 (7) |
| `MPIN_OPS` | **14718** | 2.4 KB | 85 `[code, municipality]` | MPIN 3.4ц (Сл. весник 42/05) |
| `CB` | 6947–6964 | 2.4 KB | 16 codebook definitions | |
| `PKG_REP` | 8138–8156 | 2.4 KB | 17 package reports | |
| `BANKS_MK` | 12709–12715 | 2.2 KB | 6 banks (code, names, formats) | `banks.json` |
| `NKD35` | **10992** | 2.1 KB | 156 `'NN.NNN' → AOP` | Form 35 legacy map |
| `FS_PROMPT`, `PUR_PROMPT`, `FISK_PROMPT`, `BLG_PROMPT`, `IMP_PROMPT`, `OB_PROMPT`, `MPIN_ASK` … | Cross-cutting C.6 | 0.5–2.7 KB each | AI prompts | `packages/core/prompts/*.md`, verbatim |
| `FR_CTRY` | 14441 | 1.8 KB | 46 `[code, country, per-diem, currency]` | Foreign per-diem regulation |
| `NC_BDOCS` | 15144–15145 | 1.7 KB | 2 banks' account-opening document lists | |
| `DE38_AUTO` | 10981–10985 | 1.6 KB | 38 | |
| `ROLES` | 5455 | 1.6 KB | 7 roles | RBAC seed (with `RP` 5456, `ACT_NEED` 5458 + 91 `Object.assign`) |
| `BBO_CSS` | 13638–13652 | 1.6 KB | CSS | |
| `AML_IND` | 15851–15864 | 1.5 KB | 12 AML risk indicators | plus `AML_NKD` 15865 (15 risky NACE), `AML_LV` 15866 (4 levels) |
| `MODS` | 10201–10214 | 1.5 KB | 13 modules (+ `tour` 11995, `frt` 14649) | `modules.json` |
| `ACT.cbSeedCity` city list | **7145** (inside ACT literal) | ~1.5 KB | 30 `[code, city, postal code, municipality]` | `cities.json` |
| `DI_VIOL` | 15617 | 1.3 KB | 12 work-discipline violations | |
| `ICO` | 3749–3750 | 1.3 KB | SVG paths | UI icons |
| `RC_CAR_SVG` | 11722–11725 | 1.2 KB | SVG | |
| `SCH0` | **3174** | 1.2 KB | 73 role → konto | `posting-scheme-default.json` (+ `SCH_OLD` 3176, 16 legacy values) |
| `BATCH_ACT` | 5372–5378 | 1.1 KB | 4 handlers | Code |
| `KH` | 5081–5082 | 1.1 KB | КДФИ table header HTML | |
| `FIMP_MAP` | 8843 | 1.1 KB | 40 header aliases | Firm import |
| `HTYPES` | 5988 | 1.0 KB | 17 `[hour type, %]` | |
| `KD_SVC` | 10326 | 1.0 KB | 9 accounting services | |
| `KL_INSP` | 9104–9109 | 1.0 KB | 6 inspectorates (MK/AL) | |
| `LF_OPTS` | 10401 | 1.0 KB | 4 groups of legal forms | |

### R.3 Small but load-bearing (statutory / rates / codes)

| Constant | Lines | Count | Notes |
|---|---|---|---|
| `PAY_DEF` | **5992–5995** | 3 rows (2026-01, 2026-03, 2026-07) | Payroll parameters (PIO 19.9, vrab 0.1 …) — `payroll-params.json`, dated; plus global overrides `settings/pay` |
| `FX_DEF` (+ `FX_DATE0` 6490) | **6491** | 20 currencies | Default mid rates as of 2026-09-30 |
| `BLG_CAT`, `BLG_CTRY`, `BLG_CUR`, `BLG_FX0`, `BLG_MKRATE` | 6509–6512, 6536 | 10 / 37 / 38 / 18 / 1 | Cash categories (candidate kontos), countries, currencies, fallback rates (conflict with FX_DEF) |
| `MPIN_FZO`, `MPIN_SKOPJE` | 14719, 14720 | 30 / 18 | FZO units; Skopje municipalities |
| `MPIN_SAMPLE` | 6120 | 1 | **Contains a real-looking EDB** — test fixture only |
| `NAL_DEF` | 3478 | 15 | Nalog codes/titles |
| `VAT_OUT0`, `VAT_IN0`, `VAT_IMP0`, `VAT_BAD`, `RATES` | 3168–3171 | 3/3/3/10/4 | VAT kontos and rates |
| `DEP_PRESETS` | 3183 | 5 | Depreciation presets (0130 twice; wrong groups — Phase 8 item 9) |
| `POS_BS`, `POS_IS` | 3626–3638, 3639–3651 | 11 / 11 | Simplified statements |
| `PP_T`, `PP_NACIN`, `PP_SIF`, `PP_TAX` | 15750–15758 | 3 / 3 / 12 / 4 | Payment orders (PP_TAX "проверете") |
| `CP1251` | 6118 | map | cp1251 encoder for MPIN — use `iconv-lite` instead |
| `BAJRAM` | 6021 | 8 years (2025–2032) | Ramazan Bajram dates (extend) |
| `FISK_G0`, `FK_SC`, `FK_BRANDS` | 11343, 13090, 11500 | 4 / 3 / 8 | Fiscal VAT groups (А 18, Б 5, В 0, Г 10), schemes, device brands |
| `DT_DEF`, `DT_SH` | 16803, 16804 | 20 | ДДВ inspector table columns |
| `LR_LAWS`, `LR_INT=0.0003`, `LR_FINE_REG` | 16595–16600 | | Laws, daily interest, fine ranges |
| `AP_CASH_LIMIT=61500`, `AL_DDV_LIMIT=2000000` | 16239, 8478 | | Statutory thresholds |
| `MK_CITIES`, `BZ_NAT`, `RC_CT` | 11607, 9504, 11648 | 50 / 22 / 12 | Cities, nationalities, countries |
| `EXB`, `COSTS`, `DT`, `TYPES`, `CURS`, `PCAT`, `PXTRA`, `PAY_KEYS`, `CT_TYPES`, `ZS_MENU`, `ZS_PH`, `ZY_ROLES`, `ENT`, `DLD_ND`, `DB_ND`, `OS_DOCT`, `DOS_CAT`, `EXPG`, `KD_EXP`, `ART_UNIT0`, `EAN_*` | various | | UI enums — keep in code or a small `enums.json` |

OCR traineddata: `legacy/ocr/eng.js` (3.9 MB) and `legacy/ocr/mkd.js` (0.96 MB) wrap base64/gzip `.traineddata` in `window.__TESSDATA` — decode once to plain `eng.traineddata` / `mkd.traineddata` for the worker (PLAN.md: OCR).

## Top fix-on-purpose list

Ranked by risk; details in the phase sections.

| # | Issue | Where | Phase |
|---|---|---|---|
| 1 | `pnSave` name collision — travel orders overwrite `firm.payNotes` and never persist | 9241 vs 15239 | 6, 10, 11 |
| 2 | `stockAt` signature clash — stock-at-date returns 0 in ~22 callers | 4914 vs 13858 | 7 |
| 3 | `prRead` collision — transfer edits never read | 5553 vs 7703 | 7 |
| 4 | Security only in the UI; all users read all password hashes and client plaintext `pw0`; forgeable session token | 5456, 7804, 7865, 5470 | 9, 11 |
| 5 | PIO 18.8% / vrab 1.2% fallbacks vs PAY_DEF 19.9% / 0.1% | 6000, 6003, 6050, 7253, 3394 vs 5993–5995 | 6 |
| 6 | Result accounts 951/961 vs 950/960 vs 9500/9600; tax 2330 vs help text 2340; 8000/8200 vs 800/810 | 6739–6741, 6762, 6981, 12386, 17158 | 2, 8 |
| 7 | Depreciation all to 0190 (→ buildings), preset kontos in wrong AOP groups | 7239, 3183, ZS_DEF | 8 |
| 8 | VAT konto resolvers inconsistent (`VAT_IMP` unvalidated, `vatInKonto` fallback); `sch()` silently ignores `SCH_OLD` values; `schSaveAll` wipes firm overrides | 3169–3177, 5247 | 2, 5 |
| 9 | Retail margin konto 6694 vs 6690; transfer posting asymmetric; FIFO/LIFO only cosmetic | 3174, 17413, 13097, 11399 | 7 |
| 10 | Backups miss all office-wide data and assets | 8979 | 9, 11 |
| 11 | Posting snapshot vs live recomputation; `ed`/`edAdd` overlays in source docs | 3448–3467, 3580 | 2, 11 |
| 12 | `ownerCheck` false positives on sales scans; UBL credit notes/advances wrong | 12896, 5117, 5398 | 3 |
| 13 | MT940 balances reused across statements; name mapping drift | 12558, 12720, 12724 | 4 |
| 14 | `docs/mpin-{mo}` id collision; MPIN double booking | 14089, 15351, 14092 | 6 |
| 15 | `S.cpEd` shared by coupons and construction | 9954, 10055 | 10 |
| 16 | Hard-coded EUR 61.5 and ~40 hard-coded `'7400'` kontos | Phase 4 item 4, Phase 3 item 3 | 3, 4, 9 |
