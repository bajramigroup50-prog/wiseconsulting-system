# Fiskalni aparati (ACCENT · DUNA · DAVID) — WISE desktop

> Pjesa 1 është për pronarin (shqip). Pjesa 2 është teknike (anglisht). Çdo gjë që nuk është vërtetuar me dokument
> zyrtar ose me një aparat të vërtetë është shënuar **„за проверка“** (për t'u kontrolluar në vend).

---

## Pjesa 1 — Për pronarin (shqip)

### Çfarë bën programi

Në dyqan (market, rent-a-car, shitje me shumicë) kompjuteri i arkës ka të instaluar **aplikacionin WISE për desktop**.
Vetëm aplikacioni desktop mund të flasë me aparatin fiskal (kabëll COM/USB ose rrjet LAN). Në shfletues (Chrome, Edge)
shitja regjistrohet normalisht, por **pa faturë fiskale** — butonat e shpjegojnë këtë.

Te **Фискална каса** (arka):

| Butoni | Çfarë bën |
|---|---|
| **🧾 Фискална сметка** | Regjistron shitjen (stoku, librat, kartela e besnikërisë) dhe e printon faturën fiskale. Numri i faturës që kthen aparati ruhet në server (auditim). |
| **Евидентирај продажба** | Si më parë: vetëm regjistron shitjen, pa aparat. |
| **Печати повторно** | Kur aparati nuk e ka konfirmuar faturën (s'ka letër, s'është i lidhur) — printon sërish **të njëjtën** faturë, pa e regjistruar shitjen dy herë. |
| **Сторно** | Faturë storno (kthim) për një faturë fiskale të konfirmuar; mban numrin e faturës origjinale. Stoku/librat korrigjohen veçmas (fshirja e qarkullimit ose kthim). |
| **X извештај** | Raport ditor pa mbyllje (kontroll gjatë ditës). |
| **Z извештај** | Mbyllja ditore në memorien fiskale — një herë në ditë, në fund të punës. Numri i Z ruhet në server. |
| **Внес / Излез пари** | Futje / nxjerrje parash në arkë (shërbimore). |
| **Статус** | A është aparati i lidhur, a ka letër, a është memoria fiskale e mbushur. |

**Rregull i rëndësishëm:** një shitje shënohet si e fiskalizuar **vetëm** kur aparati e ka konfirmuar dhe ka kthyer numrin e
faturës. Nëse aparati jep gabim, shitja mbetet e regjistruar, por në listën „Фискални сметки“ shfaqet ❌ / ⏳ me butonin
„Печати повторно“. Gabimet shfaqen në maqedonisht (p.sh. „Нема хартија…“, „Фискалниот апарат не одговара…“,
„Фискалната меморија е полна…“).

Nëse aparati e printoi faturën por interneti ra pikërisht atëherë, programi shfaq numrin dhe butonin **„Зачувај го бројот“**
— mos printo përsëri, vetëm ruaje numrin.

### Si ta konfigurosh aparatin te klienti (hap pas hapi)

1. **Instalo WISE desktop** në kompjuterin e arkës (me certifikatën e pajisjes, shih `docs/INSTALIM-UREDI.md`).
2. **Shiko aparatin** dhe shkruaj:
   - prodhuesi (ACCENT / DAVID / DUNA) dhe **modeli** (shkruhet në etiketë ose në faturën e testit);
   - **si lidhet me kompjuterin**: kabëll serial (RS232), USB (zakonisht shfaqet si „COM“ port), apo rrjet (LAN, IP adresa);
   - a është i instaluar **programi i prodhuesit** (p.sh. Accent *Fiscal32.exe*, „фискален сервис“ i David/PIXEL ose i Duna).
3. Nëse lidhet me kabëll: hap **Device Manager → Ports (COM & LPT)** dhe shiko numrin e portës (p.sh. COM3). Për
   adapterin USB-serial instalo drajverin e prodhuesit (Accent i jep te „Преземања“ → RS USB adapter).
4. Në WISE hap **Фискална каса → 🧾 Фискален апарат → ⚙️ Поставки** (`/kasa/aparat`):
   - **Производител** dhe **Модел**;
   - **Врска**: *COM порта* (zgjidh COM-in, shpejtësia zakonisht 9600; Duna 115200 — за проверка),
     *Мрежа* (IP + porta që të jep serviseri — за проверка për çdo model), ose
     *Програма на производителот* („Избери програма“ → p.sh. `C:\Accent\Fiscal32.exe`; COM-i i saj vendoset në `fiskal.ini` në të njëjtën dosje);
   - **Оператор / лозинка / број на каса** — si i ka programuar serviseri (parazgjedhje 1 / 0000 / 1);
   - **Зачувај**.
5. Shtyp **Статус** → duhet të dalë „✅ Апаратот одговара“ dhe numri serik.
6. Shtyp **Тест печатење** → aparati printon një raport diagnostikues (jo fiskal).
7. Bëj një shitje prove me 1 artikull (p.sh. 1 den.) me **🧾 Фискална сметка**, kontrollo që numri i faturës në ekran = numri në letër.
   Pastaj (nëse duhet) bëj **Сторно** të saj.
8. Trajno arkatarin: në fund të ditës **Z извештај**.

**Për demo / trajnim** zgjidh prodhuesin **СИМУЛАТОР**: nuk ka aparat, faturat shkruhen në skedarin
`%APPDATA%\WISE CONSULTING\fiscal-simulator.log`. Mund të simulosh edhe gabime (s'ka letër, s'është i lidhur…).

### Çfarë duhet të mësosh në vend (lista)

- [ ] Prodhuesi dhe modeli i saktë (dhe versioni i firmware-it nga raporti diagnostikues).
- [ ] Lidhja: RS232 / USB-COM / LAN / Bluetooth; numri i COM-it ose IP:porta.
- [ ] Shpejtësia (baud) e vendosur në aparat (Accent: çelësi SW4 → 9600 ose 19200).
- [ ] A është arkë fiskale (ECR, p.sh. Accent SY55, Duna Вардарец) apo printer fiskal (PF550, David FP)? Arkat duhet të vihen
      në modalitetin **„фискален печатач / PC mode“** (Duna: „FPR“).
- [ ] A është instaluar programi/shërbimi i prodhuesit dhe a e lejon prodhuesi lidhjen direkte (protokolli).
- [ ] Numri i operatorit, fjalëkalimi dhe numri i arkës.
- [ ] Grupet e TVSH-së të programuara në aparat (А 18 %, Б 5 %, В 10 %, Г 0 %/e liruar) — kontrollo raportin X; nëse ndryshojnë, „Даночни групи на апаратот“.
- [ ] Për firmat jo-pagues TVSH: aparati pranon vetëm grupin Г (WISE e dërgon automatikisht kur firma s'është në TVSH).

---

## Part 2 — Technical (English)

### Vendors, devices, protocols — confirmed vs „за проверка“

| Vendor | Devices (MK market) | Connection | Protocol / integration | Status |
|---|---|---|---|---|
| **ACCENT** (Accent Computers, Skopje — Synergy brand, made by Datecs) | Fiscal printers **PF550**, **PF700**, (older **PF500**); cash registers **SY55, SY250, SY46, SY47** | PF550: RS232 9600/19200 8N1; PF700: RS232, USB, LAN; registers: RS232 PC port, GPRS to УЈП | PF500/PF550/PF700: **Datecs framed protocol, documented** in Accent's „Контролни кодови PF550 PF700 v1.40“ (MK) and „Control codes PF550 v1.36“ (EN). Vendor tools: `Fiscal32.exe` (IN/OUT/ERR command files), `pf500.dll`, `ecrprint` console, `ecr.dll`. | **Confirmed** from vendor docs: framing, checksum, status bytes, commands 48/49/51/53/56/85/86/69/70/74/90/113, VAT letters А–Г = cp1251 192–195, payment codes P/N/C/D, IN-file format. **за проверка**: PF700 LAN port number; SY cash registers use the newer TAB-separated Datecs syntax („Control_codes_cash_register-v2“) — *not implemented*, use the vendor program or PC mode; receipt number source (cmd 113 vs close counters) on real firmware. |
| **DAVID** (Давид компјутери, Skopje; software partner ПИКСЕЛ Системи) | Fiscal printers **ДАВИД ФП**, **FX1200**, **FX1300**; registers **Expert SX**, **Perfect S**, **Давид S**, **Давид М** (Daisy-made models, also sold by Fiditek) | „ideal for PC-based POS“ (FP); Expert SX: Bluetooth; interfaces not published | Not published by David. The open driver **tinodj/mk-fiscal-printer-driver** prints on **David Expert SX** with the same Datecs frames and commands 48/49/53/56/69 and cp1251 VAT letters. Daisy's ISL protocol family (FX1200C, Expert SX, Perfect S) is Datecs-compatible framing (ErpNet.FP `bg.dy.isl`). | **Partly confirmed** (Expert SX, community driver). **за проверка**: FX1200/FX1300/ДАВИД ФП commands, storno (85/86), payment codes, Z/X options, baud rate, whether the PIXEL „софтвер за работа со фискални апарати“ offers a command-file interface. |
| **DUNA** (Дуна компјутери, Skopje — own production since 2001) | Registers **Вардарец**, **Развигорец**, **Северец**, mobile **Пелистерец**, **Маестрал**; retail software Vector / Спинакер | Вардарец: 3× RS232 (PC port **115200 b/s**), USB (master mode), GPRS; can run as **„Fiscal printer (FPR)“** | **Not public.** The user manual only says the register can be switched into fiscal-printer mode and connected to a PC over RS232 115200. | **за проверка** (everything protocol-related): ask Duna (fiskalni@duna.mk, 02/3104 500) for the PC protocol / SDK or their service program. Until then: the „command file“ driver only if Duna's program uses the Accent-style IN/OUT format, otherwise sales are recorded without a fiscal receipt. The raw driver can be *tried* in FPR mode (Datecs framing is the most common in MK) — **за проверка**. |

VAT groups on Macedonian fiscal devices — Правилник за техничките и функционалните карактеристики на фискалните системи
на опрема, чл. 26 ст. 1, as amended by Сл. весник на РСМ 315/2020 and 60/2022 (in force 14.03.2022): **А = 18 %**,
**Б = 5 %**, **В = 10 %**, **Г = ослободено / 0 %** (also every sale of a firm that is not a VAT payer). Before the
amendment exempt sales were marked В (old programming В 0 %, Г 10 %, which the legacy WISE program assumed); the
transition ran to 01.07.2021 (exempt В → Г) and 01.01.2022 (10 % on В). Sources: ujp.gov.mk Правилник (пречистен текст
60/22), zonel.com.mk „Законски 96“ (04.01.2021), knigoprima.com.mk (01/2021), eurokonsaltplus.com.mk (2022).
One constant for everything: `FISCAL_VAT_GROUPS` in `@wise/core/retail/vat-groups` (receipts `vatGroup`, report reader
`FISK_G0`, AI prompt `FISK_GROUPS`); the desktop copy `desktop/fiscal/vat-groups.js` is kept equal by
`packages/core/test/retail/vat-groups.test.ts`. A device programmed differently: ⚙️ Фискален апарат → „Даночни групи на
апаратот“ (the service remaps the letters by rate); „X извештај“ / „Статус“ read the device's rates (Datecs command 97,
**за проверка** per firmware) and warn on a mismatch; the fiscal-report reader uses the rates printed on the report and
warns when they differ from the legal mapping.

### Architecture

```
web page (Next.js, /kasa)            Electron main process (desktop/)
  fiscal-panel.tsx / pos-till.tsx      preload.js  → window.wiseFiscal (only on app.wiseconsulting.com.mk)
  lib/fiscal-bridge.ts (detect)        fiscal/ipc.js   ipcMain 'wise:fiscal:*' + sender-origin check, native dialogs
  kasa/fiscal-flow.ts (print+record)   fiscal/service.js  config (userData/fiscal.json), vendor catalogue, job queue
  kasa/fiscal-actions.ts (server)      fiscal/drivers/datecs-raw.js   Datecs frames over COM (serialport) / TCP
  @wise/db fiscal-receipts.ts (fiskr)  fiscal/drivers/command-file.js Accent IN/OUT/ERR files (+ vendor exe)
  @wise/core retail/fiscal.ts          fiscal/drivers/simulator.js    log file, counters, simulated faults
```

**Driver interface** (every driver): `status()`, `printReceipt(receipt, { storno })`, `report('X'|'Z')`,
`cash(±amount)`, `lastReceipt()`, `testPrint()`, `close()`. Results are `{ ok: true, number, time, total }` or
`{ ok: false, code, error }` (Macedonian message). Codes: `NOT_CONFIGURED, NOT_CONNECTED, PORT_BUSY, SERIAL_MISSING,
PAPER_OUT, COVER_OPEN, PRINTER_FAULT, FM_FULL, FM_ERROR, CLOCK, RECEIPT_OPEN, NOT_ALLOWED, SYNTAX, OVERFLOW,
DEVICE_ERROR, NO_ANSWER_FILE, INVALID_INPUT, FORBIDDEN`.

**Receipt** (built on the server by `toFiscalReceipt`, validated again in the desktop by `normalizeReceipt`):
`{ items: [{ name, qty, price (unit, incl. VAT, > 0), vat: 'А'|'Б'|'В'|'Г', mk? }], discountPct?, payments: { card? }, ref? }`.
The devices refuse negative lines, so the POS discount (card / coupon / points) becomes one % over the subtotal (cmd 51);
the card part is paid with `D`, the rest with „<TAB> and no amount“ = everything remaining in cash, so a one-cent
rounding difference can never block the close. Max 99 lines per receipt; names cut to the model's length (Accent 25,
others 22 — за проверка).

**Datecs frame** (host → device) `01 LEN SEQ CMD DATA 05 BCC×4 03`; answer `01 LEN SEQ CMD DATA 04 STATUS×6 05 BCC×4 03`;
LEN = bytes after 01 up to 05 + 20h; BCC = 16-bit sum LEN…05, 4 nibbles + 30h; NAK 15h → resend same SEQ, SYN 16h →
busy, wait; 500 ms answer time-out → resend with the same SEQ (the device then repeats its answer instead of executing twice).

**Receipt sequence**: `74 X` (refuse if a receipt is open / error) → `48 op,pwd,till` (storno `85`) → `49 name<TAB>[@]<А-Г>price*qty`
(storno: 2nd text line „Сторно на бр. N“ on the first item — за проверка) → `51 10,-pct` → `53 <TAB>Dcard` → `53 <TAB>` → `56` (storno `86`)
→ `113` last document number → `62` device time. Z = `69 0`, X = `69 2`, cash = `70 ±amount`, test = `71` (diagnostic, non-fiscal).

**Accent IN file** (`PF500.IN`, cp1251, CRLF): one command per line `<SEQ char><CMD char><data>`, e.g. ` 01,0000,1`,
`#1Produkt 1<TAB>А25.00*1.000`, `$5<TAB>`, `%8`. Answers: `pf500.out` (one data line per command, e.g. `0014,0000`),
`pf500.err` (six decimal status bytes per command). The vendor program reads its COM settings from `fiskal.ini`.
WISE either runs the chosen exe (cwd = its folder) or waits for a watching service to write the answer files (30 s).

**Security**: the API exists only on the app's own origin (preload checks `location.host`, main re-checks
`senderFrame.url`); the page never passes file paths (exe / folder only through the native dialog in the main process);
TCP only to LAN addresses; the operator password is never echoed back; jobs are serialised (one receipt at a time).

**Native module**: `serialport` 13 (N-API prebuilt binaries shipped inside the package for win32-x64/ia32/arm64, no
compiler and no rebuild needed — `build.npmRebuild: false`, `asarUnpack` for `@serialport/bindings-cpp`). It is loaded
lazily: if missing, COM connections answer `SERIAL_MISSING` and LAN / command-file / simulator still work.
Before building the installer run `npm install` in `desktop/` (the lockfile already contains serialport).

**Server audit** (`firm_docs` type `fiskr`, `@wise/db` `fiscal-receipts.ts`): sale/storno rows are `pending` (created with
the POS sale in the same transaction) → `ok` only with the device number (final, never overwritten) or `failed` with the
error; Z / X / cash rows are written after the device confirmed. Audit actions `fiskrNew`, `fiskrOk`, `fiskrFail`, `fiskrReport`.

### Tests

- `cd desktop && npm test` (= `node --test "fiscal/test/*.test.js"`, no Electron needed) — cp1251, frames/checksum, status bits, command list, raw driver on a
  simulated PF550 (NAK, SYN, paper out, open receipt, no answer), Accent IN-file format and answer parsing, simulator, service rules; IPC origin guard and the preload (stubbed `electron`).
- `packages/core/src/retail-fiscal.test.ts` — VAT letters, discount %, card part, confirmation rule.
- `packages/db/src/fiscal-receipts.test.ts` — pending → ok / failed, finality, storno once, Z/X/cash.
- `apps/web/test/flows/fiscal.test.ts` — bridge detection, POS sale + receipt number recorded via the real server actions.

### Sources

- Accent downloads (control codes PF550/PF700 v1.40, PF550 v1.36 EN, IN-file examples, ecr.dll, Fiscal32): https://www.accent.mk/?page_id=1282 ; products https://www.accent.mk/?page_id=47
- Accent PF500 examples and VB6 module (pf500.dll, IN files, `fiskal.ini`): https://github.com/bor0/pf500
- Community MK driver tested with Synergy PF-500/PF550 and David Expert SX: https://github.com/tinodj/mk-fiscal-printer-driver
- David компјутери — fiscal printers / registers / software: https://david.com.mk/c/1/fiskalni-printeri , https://www.david.com.mk/c/4/fiskalni-kasi , https://david.com.mk/c/9/rabota-so-fiskalni-aparati
- Duna — Вардарец user manual (RS232 115200, FPR mode): https://www.fiditek.mk/downloads/VARDAREC_korisnicko_upatstvo.pdf ; Северец manual: https://www.fiditek.mk/downloads/SEVEREC_korisnicko_upatstvo.pdf ; contact https://shop.duna.mk/contact/
- Daisy / Datecs / Tremol protocol families (BG), transports COM / Bluetooth / TCP: https://github.com/erpnet/ErpNet.FP
- УЈП — authorised fiscal equipment manufacturers: http://www.ujp.gov.mk/en/vodic/category/417
- Министерство за финансии — ДДВ стапки (18 / 10 / 5 %): https://finance.gov.mk/mk-MK/oblasti/danok-na-dodadena-vrednost
