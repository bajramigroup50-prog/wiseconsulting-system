# Raport i performancës dhe qëndrueshmërisë – WISE (ueb)

**Data:** 15.10.2026. Kontrolli u bë **vetëm lokalisht**. Serveri i prodhimit nuk u prek.

## 1. Si u kontrollua

- **Ndërtimi:** `next build` + `next start`, pra ndërtimi i prodhimit, jo `next dev`.
- **Baza:** PGlite lokal (`pnpm --filter @wise/db dev-server`), sepse në këtë kompjuter nuk ka Postgres/Docker. PGlite ka vetëm një lidhje, prandaj kohët janë **më të larta se në Postgres të vërtetë**. Ngarkimi paralel (`Promise.all`) këtu nuk fiton kohë, por në prodhim (Postgres me 10 lidhje) fiton.
- **Të dhënat:**
  - `seedDemo` krijon 3 firma demo dhe zyrën demo.
  - Mbi to u shtua vëllim në **ДЕМО ТРГОВИЈА ДООЕЛ**: 400 partnerë, 50 artikuj-shërbime, 1 500 fatura dalëse, 500 fatura hyrëse dhe 1 500 urdhra kontabël manualë.
  - Gjithsej rreth 3 700 urdhra kontabël dhe 13 800 rreshta kontabël në vitin 2026.
- **Roboti:** `apps/web/e2e/smoke-all-views.spec.ts` (Playwright, Chrome), si administrator, me firmën dhe vitin 2026 të zgjedhur. Ai hap **176 pamje**, d.m.th. të gjitha pamjet e menysë `lib/nav*.ts`, përveç „Излез (избор на фирма)“. Për secilën regjistron:
  - TTFB-në;
  - kohën deri sa faqja të jetë gati (rrjeti i qetë, faqja e hidratuar);
  - gabimet në konsolë dhe kërkesat e dështuara;
  - paralajmërimet e hidratimit të React;
  - kufirin e gabimit „Се појави грешка“;
  - shenjat `aria-busy` / „Се вчитува…“ që nuk zhduken.
- **Redaktorët:** u hapën redaktorët kryesorë dhe u ekzekutua veprimi kryesor me të dhëna të vlefshme.

## 2. Përmbledhje

| | Para | Pas |
|---|---:|---:|
| Mesatarja (mediana) e kohës deri sa faqja është gati | 316 ms | **136 ms** |
| Koha e mbledhur e të 176 pamjeve | 114,2 s | **33,3 s** |
| Pamje mbi 2 s | 3 | **0** |
| Pamje mbi 1 s | 19 | **0** |
| Pamje që nuk u qetësuan kurrë | 1 (`/plati`, 30 s) | **0** |
| Gabime hidratimi të React | 1 (`/semi`) | **0** |
| TTFB mediana / maksimumi (pas) | – | 40 ms / 434 ms (`/banka`) |

**Faqet më të këqija para rregullimit:**

1. „Пресметка на плата“ `/plati`: 30 s, dritarja nuk qetësohej kurrë.
2. „Услуги“ `/uslugi`: 4,3 s.
3. „Налози за книжење“ `/nalozi`: 2,1 s.
4. „Излез“ `/izlez`: 1,9 s.
5. „Изводи“ `/banka`: 1,8 s.

## 3. Çfarë bllokonte dhe pse

1. **`/plati` – „dritarja nuk mbaron kurrë së ngarkuari“.**
   - Shkaku: në listën e muajve, butoni „Преглед“ ishte `<Link>` i Next drejt `/plati/<muaj>/pecati`. Ajo nuk është faqe, por *route handler* (printim HTML).
   - Next e para-ngarkon (prefetch) çdo `<Link>` të dukshëm si RSC. Këto kërkesa te route handler-i mbeteshin të varura pa përgjigje, njëra për çdo muaj në listë.
   - Pasojat: shfletuesi nuk qetësohej për 30 s, dhe serveri llogariste rekapitulimin e pagave për çdo muaj, edhe pa e hapur askush.
2. **Klikimi në meny nuk jepte asnjë shenjë.**
   - `router.push` thirrej pa tranzicion. Në faqet e ngadalta, menyja mbetej e hapur dhe ekrani i vjetër i palëvizur derisa vinte faqja e re. Për përdoruesin kjo duket si „dritare e ngrirë“.
   - Nuk ka asnjë `loading.tsx` në aplikacion.
3. **Butoni `Submit` nuk çaktivizohej gjatë ruajtjes.**
   - Komenti në kod thoshte se çaktivizohet, por nuk çaktivizohej.
   - Klikimi i dyfishtë në „Зачувај“ mund të dërgonte dokumentin dy herë.
4. **`/semi` – gabim hidratimi React #418.**
   - Numrat formatoheshin me `toLocaleString('mk-MK')` në një komponent klienti.
   - Node dhe Chrome kanë të dhëna të ndryshme ICU, prandaj teksti i serverit ≠ teksti i klientit.
5. **`/zsNPO`, `/zsTP` japin 404 për një SH.P.K.** Kjo është me qëllim, sipas legacy `ENT_V`: format vlejnë vetëm për OJQ / TP. Megjithatë menyja i tregon për të gjitha firmat. Shih propozimet.
6. **`/` (Контролна табла) – 500 në PGlite.**
   - Gabimi: „unnamed prepared statement does not exist“.
   - Faqja kryesore dërgon shumë pyetje paralele, dhe serveri PGlite i ngatërron ato në një lidhje të vetme. Ky është kufizim i bazës së zhvillimit (e përshkruar edhe në `e2e/README.md`), jo i aplikacionit. Në Postgres nuk ndodh.
   - Ndodhte njësoj para dhe pas ndryshimeve.

**Redaktorët (veprimi kryesor me të dhëna të vlefshme, firma me vëllim):**

| Veprimi | Koha | Rezultati |
|---|---:|---|
| Faturë dalëse: koka → „Креирај фактура →“ (draft) | 0,3 s | ✓ hapet redaktori i rreshtave |
| Faturë dalëse: rreshti + „Зачувај и прокнижи“ | 0,4 s | ✓ `?saved=` |
| Faturë hyrëse (shpenzim i drejtpërdrejtë) „Зачувај и прокнижи“ | 0,7 s | ✓ `?saved=` |
| Import ekstrakti bankar (camt.053) „Зачувај и прокнижи“ → rishikim | 1,9 s | ✓ `?review=1` |
| Paga: „Креирај предлог и отвори“ | < 0,3 s | ✓ |
| Paga: „Пресметка (F4)“ | 0,3 s | ✓ |
| TVSH: „Потврди и книжи во налог“ (mbyllja e 09/2026) | 0,15 s | ✓ butoni zhduket, urdhri krijohet |
| Urdhër manual „Зачувај (F4)“ | 0,5 s | ✓ `?n=<numër>` |

Asnjë alarm nuk mbeti i hapur, nuk pati bllokim modal dhe asnjë veprim nuk mbeti i varur. Asnjë gabim nuk u shfaq pa mesazh: gabimet e veprimeve dalin në `role="alert"`.

## 4. Çfarë u rregullua

Asnjë ndryshim nuk prek logjikën kontabël ose rezultatet. Të gjitha testet mbeten të gjelbra.

| # | Rregullimi | Skedarët | Efekti (para → pas) |
|---|---|---|---|
| 1 | Butoni „Преглед“ në listën e pagave u bë `<a>` i thjeshtë: pa prefetch të route handler-it | `app/(app)/plati/page.tsx` | `/plati` **29 736 → 271 ms**, rrjeti qetësohet |
| 2 | Layout-i: kërkimet e pavarura (cookies, pronari, `myViews`, pastaj bllokimet + buxheti AI) ngarkohen bashkë me `Promise.all` | `app/(app)/layout.tsx` | një rrugë më pak drejt bazës në çdo faqe |
| 3 | Layout-i: viti i parë i firmës me `extract(year from min(date))` në vend të `min(extract(year from date))`, që lexohet nga indeksi `(firm_id, date)` në vend që të skanojë të gjithë urdhrat e firmës | `app/(app)/layout.tsx` | ndikon në **çdo faqe**; pjesa më e madhe e rënies së medianës 316 → 136 ms |
| 4 | Shiriti i sipërm: afatet (`rokBadge`) nisin menjëherë, ligjet + skedarët e mesazheve ngarkohen paralelisht | `lib/top-status.ts` | 2 hapa sekuencialë më pak në çdo faqe |
| 5 | `proxy.ts` (çdo kërkesë, edhe çdo prefetch): rregulli „Колегите гледаат само сметководство“ dhe pronari lexohen paralelisht | `lib/view-access.ts` | një rrugë më pak për çdo kërkesë (u shtua pas matjes së fundit, nuk është matur veçmas) |
| 6 | Lista e faturave: rreshtat grupohen një herë (jo `filter` mbi të gjithë rreshtat për çdo faturë); urdhrat, dokumentet e referuara dhe pagesat ngarkohen **vetëm për faturat e listës** (jo të gjitha faturat/urdhrat e firmës nga të gjitha vitet) dhe paralelisht | `components/sales/invoices-view.tsx` | `/izlez` 1 883 → 472 ms |
| 7 | Faqosja e listave të mëdha: lista e faturave/shërbimeve tregon **500 dokumentet e fundit**, me shënim dhe lidhje „прикажи ги сите N“ (`?all=1`). Totalet, filtrat dhe eksporti në Excel mbeten për të gjithë listën | `components/sales/invoices-view.tsx` | `/uslugi` (1 500 fatura) **4 299 → 931 ms** |
| 8 | Filtri i vitit `extract(year from date) = Y` u zëvendësua me `date between 'Y-01-01' and 'Y-12-31'` (i njëjti rezultat, por përdor indeksin `(firm_id, date)`) | `vlez`, `efaktura`, `frFak`, `frTuri`, `pnalozi`, `povratDob`, `invoices-view`, `packages/db`: `sales/invoices.ts` (numërimi), `sales/purchases.ts`, `sales/supplier-credits.ts`, `compliance.ts`, `industry/transport.ts` | `/vlez` 1 348 → 478 ms, `/efaktura` 1 325 → 690 ms |
| 9 | Indekse të reja: `audit_at_idx` (`audit_log.at`) për 📊 Продуктивност / aktivitetin, dhe `ai_usage_at_idx` (`ai_usage.at`) për shpenzimin mujor AI që pronari e llogarit në **çdo faqe** | `packages/db/src/schema/foundation.ts`, `schema/ai.ts`, migrimi **`0031_perf_indexes.sql`** | pa skanim të plotë të tabelave që rriten pa kufi |
| 10 | Shenjë ngarkimi te menyja: kalimi bëhet në `startTransition`, menyja mbyllet menjëherë dhe në krye shfaqet një shirit i hollë që lëviz (`.navbusy`, `aria-busy` te `#nav`) derisa të vijë ekrani i ri | `components/nav.tsx`, `app/legacy.css` | nuk ka më „klikova dhe s’ndodhi asgjë“ |
| 11 | `Submit` çaktivizohet gjatë ruajtjes (`useFormStatus`) | `components/action-form.tsx` | pa dërgim të dyfishtë të dokumenteve |
| 12 | `/semi`: numrat me `fmt` të përbashkët (i njëjti tekst në server dhe klient) | `app/(app)/semi/journals-ui.tsx` | gabimi React #418 → 0 |

**Testi i vjetruar:** `apps/web/test/flows/archive-files.test.ts` dështonte edhe në `main`, pas rregullit të ri të datës 15.10.2026 (commit 78492d4) që i lejon kontabilistit (`acc`) të fshijë. Testi priste që `acc` të refuzohej. Tani testi kontrollon refuzimin me rolin `oper`, i cili nuk e ka të drejtën `del`. Qëllimi i testit mbetet i njëjti.

**Migrimi:** `packages/db/migrations/0031_perf_indexes.sql`, i krijuar me `pnpm exec drizzle-kit generate --name perf_indexes`:

```sql
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");
CREATE INDEX "ai_usage_at_idx" ON "ai_usage" USING btree ("at");
```

**Kontroll i indekseve.** Skema i ka tashmë indekset kryesore:
- `journals (firm_id, date)` dhe `(firm_id, source_type, source_id)`;
- `journal_lines (firm_id, account)` dhe `(firm_id, partner_id)`;
- `invoices` / `purchases (firm_id, date)`;
- `bank_lines (firm_id, ref…)`, etj.

Skanimet sekuenciale që u panë në statistikat e PGlite vinin nga një firmë e vetme që zë pothuajse gjithë tabelën. Atje skanimi sekuencial është zgjidhja e duhur, jo mungesë indeksi.

## 5. Tabela e të gjitha faqeve

- „Para“ = ndërtimi fillestar; „Pas“ = me rregullimet e mësipërme.
- Koha = nga nisja e navigimit deri sa faqja është gati (rrjeti i qetë, pa 500 ms pritjen e Playwright).
- Firma ДЕМО ТРГОВИЈА ДООЕЛ, viti 2026, PGlite. Renditja: nga më e ngadalta para rregullimit.

| # | Pamja (menyja) | URL | Para (ms) | Pas (ms) | TTFB pas (ms) | Statusi pas |
|---:|---|---|---:|---:|---:|---|
| 1 | Пресметка на плата | `/plati` | 29736 (rrjeti s’u qetësua kurrë) | 271 | 50 | ✓ |
| 2 | Услуги | `/uslugi` | 4299 | 931 | 250 | ✓ |
| 3 | Налози за книжење | `/nalozi` | 2091 | 724 | 226 | ✓ |
| 4 | Излез | `/izlez` | 1883 | 472 | 124 | ✓ |
| 5 | Изводи (денарски) | `/banka` | 1775 | 713 | 434 | ✓ |
| 6 | Девизни изводи | `/devizni` | 1672 | 639 | 384 | ✓ |
| 7 | 📅 Термини (услуги, ординации) | `/termini` | 1565 | 443 | 35 | ✓ |
| 8 | Аналитика на партнери (ИОС) | `/analitika` | 1467 | 506 | 144 | ✓ |
| 9 | 🕵 Подготвеност за инспекција | `/insp` | 1448 | 393 | 200 | ✓ |
| 10 | ⚖ Законска усогласеност | `/zakon` | 1357 | 410 | 251 | ✓ |
| 11 | Влез | `/vlez` | 1348 | 478 | 149 | ✓ |
| 12 | Е-Фактура | `/efaktura` | 1325 | 690 | 158 | ✓ |
| 13 | 📋 Завршна сметка – по фази | `/zsProc` | 1306 | 369 | 171 | ✓ |
| 14 | Благајна (1020) | `/blagajna` | 1222 | 444 | 161 | ✓ |
| 15 | Почетна состојба | `/pocetna` | 1222 | 362 | 70 | ✓ |
| 16 | Сите шифрарници | `/sifrarnik` | 1218 | 347 | 42 | ✓ |
| 17 | Контен план | `/konto` | 1214 | 691 | 225 | ✓ |
| 18 | Бруто биланс | `/bilanc` | 1183 | 299 | 59 | ✓ |
| 19 | 📚 Закони на УЈП (синхронизирано) | `/ujpZakoni` | 1133 | 431 | 287 | ✓ |
| 20 | 💳 Платни налози (ПП30/ПП50/ПП10) | `/ppNal` | 995 | 359 | 147 | ✓ |
| 21 | Книги за ДДВ (влезни / излезни фактури) | `/ddvKnigi` | 979 | 352 | 132 | ✓ |
| 22 | Контролна табла | `/` | 946 | 300 | 201 | ⚠ 500 (PGlite – shih shënimin) |
| 23 | 🗂 Картони на клиенти / пациенти | `/kartoni` | 923 | 200 | 34 | ✓ |
| 24 | 🏭 Нова фактура од производство | `/izlezProd` | 878 | 222 | 82 | ✓ |
| 25 | ДДВ · ДДВ-04 | `/ddv` | 819 | 333 | 136 | ✓ |
| 26 | Лагер листа | `/g_lager` | 815 | 136 | 54 | ✓ |
| 27 | Комитенти | `/partneri` | 754 | 387 | 77 | ✓ |
| 28 | ✈ Туристичка агенција – аранжмани | `/tura` | 750 | 124 | 35 | ✓ |
| 29 | Матични податоци за вработени | `/vraboteni` | 729 | 211 | 43 | ✓ |
| 30 | Влезни калкулации | `/kalkG` | 692 | 277 | 46 | ✓ |
| 31 | 📊 Продуктивност на вработените | `/produktivnost` | 659 | 482 | 360 | ✓ |
| 32 | ✍ Договор за сметководствени услуги | `/kdogovori` | 655 | 210 | 136 | ✓ |
| 33 | Производи и артикли | `/artikli` | 618 | 328 | 52 | ✓ |
| 34 | Шифрарник на градови | `/cb_city` | 615 | 237 | 41 | ✓ |
| 35 | 📈 Табла – анализа на работењето | `/klDash` | 609 | 265 | 78 | ✓ |
| 36 | Аналитичка картица по конто | `/kkart` | 591 | 284 | 78 | ✓ |
| 37 | Аналитички картици по комитент | `/kartici` | 589 | 262 | 68 | ✓ |
| 38 | Упатство | `/pomos` | 586 | 218 | 26 | ✓ |
| 39 | Анализи и извештаи | `/analizi` | 581 | 289 | 150 | ✓ |
| 40 | 📁 Досие – годишни сметки по години | `/zsDos` | 575 | 220 | 42 | ✓ |
| 41 | Фирми (регистрација и избор) | `/firmi` | 554 | 206 | 43 | ✓ |
| 42 | Годишна сметка – непрофитни организации | `/zsNPO` | 549 | 183 | 114 | ℹ 404 (vetëm për OJQ / TP) |
| 43 | Приемници и издатници | `/zaliha` | 547 | 262 | 48 | ✓ |
| 44 | 📅 Календар на рокови | `/rokovi` | 542 | 144 | 40 | ✓ |
| 45 | ⚖️ Даночен преглед (според законите) | `/lawrep` | 521 | 250 | 136 | ✓ |
| 46 | 👥 Корисници (колеги) и лозинки | `/korisnici` | 518 | 192 | 92 | ✓ |
| 47 | Годишна сметка – ТП / самостојна дејност | `/zsTP` | 512 | 188 | 132 | ℹ 404 (vetëm për OJQ / TP) |
| 48 | 📠 Фискални извештаи (рачна каса) | `/fiskPer` | 508 | 132 | 47 | ✓ |
| 49 | Регистар и амортизација | `/os` | 506 | 187 | 33 | ✓ |
| 50 | Шеми за автоматско книжење | `/semi` | 501 (hydration #418) | 188 | 77 | ✓ |
| 51 | Услуги | `/uslugiS` | 488 | 282 | 64 | ✓ |
| 52 | 📥 Увоз од Excel / XML | `/uvozMat` | 472 | 209 | 37 | ✓ |
| 53 | Одобренија | `/odobrenija` | 472 | 105 | 32 | ✓ |
| 54 | 🤝 Позајмици и заеми (договори) | `/pozajmici` | 460 | 184 | 102 | ✓ |
| 55 | 🚛 Превоз за трети лица – тури и фактури | `/frTuri` | 441 | 166 | 44 | ✓ |
| 56 | Резултат по објекти | `/poobjekti` | 434 | 172 | 110 | ✓ |
| 57 | ⏰ Неплатени фактури и опомени | `/opomeni` | 434 | 177 | 73 | ✓ |
| 58 | ⚖ Правен асистент (AI) | `/lawAi` | 428 | 213 | 38 | ✓ |
| 59 | 👥 Портал за клиенти | `/klPortal` | 422 | 180 | 41 | ✓ |
| 60 | Каса | `/kasa` | 422 | 158 | 47 | ✓ |
| 61 | 📥 Увоз од Excel / XML | `/uvozMalo` | 408 | 194 | 28 | ✓ |
| 62 | ✅ Месечно затворање (сите фирми) | `/zatvoranje` | 399 | 160 | 58 | ✓ |
| 63 | Плаќања без фактура (аванси) | `/bkAdv` | 394 | 175 | 89 | ✓ |
| 64 | Барања и обрасци | `/baranja` | 393 | 188 | 31 | ✓ |
| 65 | 📥 МПИН од УЈП (сите фирми) | `/mpinIn` | 392 | 150 | 42 | ✓ |
| 66 | 📑 Контроли и решенија (анализа) | `/kontroli` | 390 | 140 | 45 | ✓ |
| 67 | Евиденција на договори | `/dogovori` | 389 | 109 | 37 | ✓ |
| 68 | Излез (продажба, повратница, отпис, попис) | `/m_izlez` | 389 | 130 | 40 | ✓ |
| 69 | 🏭 Планирање производство (MRP) | `/mrp` | 388 | 150 | 64 | ✓ |
| 70 | Скенирање документ | `/skan` | 387 | 151 | 34 | ✓ |
| 71 | Пренос во продавница | `/prenosi` | 382 | 168 | 41 | ✓ |
| 72 | 🚗 Rent-a-car – резервации | `/rent` | 381 | 146 | 36 | ✓ |
| 73 | Влезни калкулации | `/kalkM` | 379 | 204 | 48 | ✓ |
| 74 | 🔧 Сервис – работни налози | `/servis` | 378 | 150 | 34 | ✓ |
| 75 | 🏨 Хотел – рецепција | `/hotel` | 372 | 135 | 36 | ✓ |
| 76 | 🚚 Патни налози (возила, возачи) | `/pnalozi` | 368 | 139 | 47 | ✓ |
| 77 | 📂 Архива на документи (сите) | `/arhiva` | 359 | 125 | 34 | ✓ |
| 78 | Нивелација | `/nivel` | 357 | 155 | 64 | ✓ |
| 79 | 🧾 е-Фактура – подготовка | `/efPrep` | 352 | 133 | 38 | ✓ |
| 80 | 🏗 Градежништво – објекти, ситуации, дневник | `/gradba` | 346 | 109 | 37 | ✓ |
| 81 | 🧾 Месечна фактура за сметководствени услуги | `/kdfakturi` | 345 | 104 | 37 | ✓ |
| 82 | 🧾 Нарачки од купувачи | `/porachki` | 340 | 134 | 38 | ✓ |
| 83 | Годишен извештај | `/payGod` | 338 | 130 | 36 | ✓ |
| 84 | 👥 Плати – сите фирми (автоматски) | `/payBatch` | 333 | 96 | 30 | ✓ |
| 85 | 📷 Скенирај / прикачи нов документ | `/arNewNav` | 322 | 136 | 28 | ✓ |
| 86 | Количинска евиденција по артикл | `/g_trg` | 321 | 147 | 64 | ✓ |
| 87 | Податоци и резервна копија | `/sistem` | 318 | 177 | 103 | ✓ |
| 88 | 🧹 Анализа и чистење на артикли | `/artQ` | 316 | 204 | 64 | ✓ |
| 89 | Работни налози (производство) | `/prod` | 313 | 127 | 42 | ✓ |
| 90 | Материјална картица | `/g_kartica` | 307 | 135 | 36 | ✓ |
| 91 | 📷 Нова фирма од решение | `/firmiResh` | 303 | 120 | 33 | ✓ |
| 92 | 💳 Лојалност и купони | `/lojalnost` | 303 | 124 | 30 | ✓ |
| 93 | 🔔 Известувања за сите фирми | `/izvestuvanja` | 300 | 145 | 38 | ✓ |
| 94 | Закупнина, бонуси и услуги (книжење) | `/pdd` | 298 | 111 | 43 | ✓ |
| 95 | Хотел – книга на гости, такса, зафатеност | `/hotelKniga` | 294 | 127 | 29 | ✓ |
| 96 | Возила на клиенти (историја) | `/vozila` | 292 | 114 | 31 | ✓ |
| 97 | 📥 Увоз на фирми од Excel | `/firmiImp` | 291 | 122 | 29 | ✓ |
| 98 | 📥 Пристигнато од клиенти | `/klInbox` | 288 | 108 | 36 | ✓ |
| 99 | 📦 Раздолжување без норматив | `/rasNorm` | 287 | 121 | 42 | ✓ |
| 100 | Нормативи (производство) | `/normativ` | 286 | 129 | 44 | ✓ |
| 101 | ⚖️ Законски промени | `/zakoni` | 282 | 117 | 40 | ✓ |
| 102 | 🧩 Модули по дејност | `/moduli` | 282 | 132 | 40 | ✓ |
| 103 | Компензации | `/kompenzacii` | 282 | 97 | 41 | ✓ |
| 104 | 📊 Месечен извештај за клиентот | `/mesIzv` | 279 | 121 | 33 | ✓ |
| 105 | Калкулатор на цена | `/kalkCalc` | 278 | 124 | 50 | ✓ |
| 106 | Пребарување делови (OE / замени / возило) | `/delovi` | 276 | 142 | 34 | ✓ |
| 107 | Банки и формати на изводи | `/bankFmt` | 275 | 144 | 40 | ✓ |
| 108 | 🔍 Споредба на две картици | `/recFree` | 274 | 94 | 33 | ✓ |
| 109 | 🛡 Спречување перење пари (УФР) | `/aml` | 266 | 94 | 40 | ✓ |
| 110 | Внеси предлог податоци | `/payPredlog` | 261 | 100 | 29 | ✓ |
| 111 | Туристичка агенција – извештаи | `/turaIzv` | 261 | 120 | 29 | ✓ |
| 112 | ⛽ Гориво, сервис, дневници | `/pnGorivo` | 261 | 121 | 30 | ✓ |
| 113 | Лагер листа скратена | `/g_lagerk` | 260 | 102 | 38 | ✓ |
| 114 | Шифри на ставки (боледување, празници…) | `/cb_paysif` | 258 | 126 | 31 | ✓ |
| 115 | Rent-a-car – извештаи | `/rentIzv` | 257 | 150 | 36 | ✓ |
| 116 | Картица на производ | `/m_kartica` | 256 | 112 | 34 | ✓ |
| 117 | Казнена камата | `/kamati` | 256 | 89 | 38 | ✓ |
| 118 | Работни места | `/cb_position` | 255 | 129 | 34 | ✓ |
| 119 | ⛽ Картички за гориво | `/frGor` | 255 | 102 | 31 | ✓ |
| 120 | Пакет документи за банка / институција | `/paket` | 254 | 92 | 32 | ✓ |
| 121 | Хотел – соби и цени | `/hotelSoby` | 253 | 114 | 33 | ✓ |
| 122 | 🍽 Ресторан – маси | `/restoran` | 253 | 148 | 45 | ✓ |
| 123 | Увоз од Excel / CSV / XML | `/uvoz` | 253 | 182 | 32 | ✓ |
| 124 | 📅 Што, каде и кога се поднесува | `/zsRok` | 249 | 118 | 32 | ✓ |
| 125 | 🗂 Целосен извештај за фирма | `/firmIzv` | 248 | 86 | 33 | ✓ |
| 126 | 🧾 Дневници во странство (возачи) | `/frDnev` | 246 | 117 | 36 | ✓ |
| 127 | Евиденција во трговијата на мало (МЕТГ) | `/m_trg` | 245 | 123 | 57 | ✓ |
| 128 | 📈 Градежништво – анализи | `/gradbaIzv` | 245 | 123 | 33 | ✓ |
| 129 | 🔁 Периодични фактури | `/periodicni` | 243 | 104 | 33 | ✓ |
| 130 | 🗂 Досие на фирмата (исто како во Архива) | `/dosie` | 242 | 97 | 38 | ✓ |
| 131 | М4 Образец | `/payM4` | 241 | 110 | 39 | ✓ |
| 132 | Лагер листа проширена | `/m_lagerp` | 240 | 103 | 35 | ✓ |
| 133 | 🔄 Автоматско дополнување залиха | `/dopolnuvanje` | 238 | 116 | 37 | ✓ |
| 134 | 🔑 Профили на клиенти | `/klProfili` | 237 | 85 | 34 | ✓ |
| 135 | 📦 Нарачки до добавувачи | `/nabavki` | 236 | 122 | 39 | ✓ |
| 136 | Реална цена на чинење | `/prodCost` | 232 | 115 | 35 | ✓ |
| 137 | Испратници | `/ispratnici` | 232 | 86 | 30 | ✓ |
| 138 | Акции и попусти | `/m_akcii` | 231 | 108 | 38 | ✓ |
| 139 | Повратници / одобренија од добавувачи | `/povratDob` | 227 | 92 | 32 | ✓ |
| 140 | Rent-a-car – флота и цени | `/flota` | 225 | 111 | 32 | ✓ |
| 141 | 📄 Лиценци и документи (возила, возачи) | `/frDok` | 221 | 155 | 66 | ✓ |
| 142 | Масовно внесување фактури | `/masovno` | 216 | 91 | 35 | ✓ |
| 143 | 🛰 Возила во живо | `/pnLive` | 216 | 100 | 30 | ✓ |
| 144 | Курсна листа (сите фирми) | `/kursna` | 214 | 108 | 34 | ✓ |
| 145 | 🤖 WISE Робот | `/robot` | 211 | 138 | 55 | ✓ |
| 146 | Трговска книга на големо (ЕТ) | `/g_trgv` | 210 | 113 | 51 | ✓ |
| 147 | 🧾 Фактури за превоз | `/frFak` | 210 | 113 | 31 | ✓ |
| 148 | ✎ Називи за артикли само со шифра | `/artNames` | 210 | 93 | 31 | ✓ |
| 149 | Дневник на активности | `/aktivnost` | 209 | 145 | 54 | ✓ |
| 150 | Даночни тарифи | `/tarifi` | 207 | 148 | 47 | ✓ |
| 151 | 🔐 Уреди (компјутери) | `/uredi` | 207 | 117 | 52 | ✓ |
| 152 | 🏷 Лотови и рок на траење | `/lotovi` | 205 | 104 | 41 | ✓ |
| 153 | КДФИ-01 (дневни фискални извештаи) | `/kdfi` | 205 | 97 | 36 | ✓ |
| 154 | 🔐 Заштита на лични податоци (ЗЗЛП) | `/zzlp` | 204 | 105 | 36 | ✓ |
| 155 | 🏷 Баркодови и етикети | `/barkodi` | 196 | 100 | 37 | ✓ |
| 156 | 👨‍🍳 Кујна / шанк | `/kujna` | 195 | 101 | 35 | ✓ |
| 157 | 📜 Историја на праќања | `/mailhist` | 193 | 98 | 30 | ✓ |
| 158 | Лагер листа | `/m_lager` | 191 | 107 | 38 | ✓ |
| 159 | Распоред на артикли по конта (6600 / 3100 / производство) | `/artKonta` | 189 | 162 | 44 | ✓ |
| 160 | 🐞 Регистар на грешки | `/greski` | 189 | 149 | 46 | ✓ |
| 161 | Задачи (табла) | `/kanc` | 189 | 129 | 39 | ✓ |
| 162 | 📄 Шаблони | `/tpl` | 186 | 118 | 42 | ✓ |
| 163 | Профактури | `/profakturi` | 182 | 91 | 32 | ✓ |
| 164 | 🤖 Автопилот | `/autop` | 178 | 91 | 38 | ✓ |
| 165 | Упросечување | `/uprosek` | 176 | 91 | 36 | ✓ |
| 166 | 🔒 Мој извештај – активност по клиент | `/mojIzv` | 174 | 90 | 31 | ✓ |
| 167 | Потсетници за сервис | `/potsetnici` | 173 | 105 | 30 | ✓ |
| 168 | Теркови за книжење | `/terkovi` | 171 | 118 | 26 | ✓ |
| 169 | 🔄 Конвертор на датотеки | `/konvertor` | 166 | 96 | 36 | ✓ |
| 170 | 📥 Увоз од старата програма | `/uvozStara` | 156 | 88 | 29 | ✓ |
| 171 | 🤖 AI читање | `/aiCitanje` | 154 | 107 | 42 | ✓ |
| 172 | ✏ Потпис и напомена за е-пошта | `/mailPotpis` | 152 | 98 | 28 | ✓ |
| 173 | Масовно внесување фактури | `/masovnoM` | 151 | 85 | 27 | ✓ |
| 174 | Мои задачи | `/mojzad` | 136 | 79 | 29 | ✓ |
| 175 | 💲 AI трошок | `/aiTrosok` | 131 | 170 | 58 | ✓ |
| 176 | Основање фирми | `/osnovanje` | 107 | 91 | 27 | ✓ |

## 6. Çfarë mbetet dhe propozime

Këto nuk u ndryshuan sepse prekin më shumë kod ose sjelljen e ekranit. Duan vendim ose punë më vete.

1. **Prefetch i tepërt.**
   - Në faqet me shumë lidhje, çdo `<Link>` i dukshëm bën një kërkesë RSC, dhe çdo kërkesë kalon `proxy.ts` (4 pyetje: sesioni, rregulli i kolegëve, pronari, administratorët).
   - Me numërimin e pyetjeve, `/termini` shkaktoi rreth 280 pyetje, `/uslugi` rreth 280, `/izlez` rreth 260, ndërsa mediana është 47 pyetje për pamje. Pjesa më e madhe vjen nga prefetch-et.
   - **Propozim:** `prefetch={false}` në lidhjet masive të tabelave (👁, ✎, „Налог“, butonat e printimit) dhe kontroll që asnjë `<Link>` të mos shkojë te një route handler. Te `/plati` kjo u rregullua.
   - Lista e route handler-ëve: `arhiva/xlsx`, `dosie/wa|zip`, `firmi/izvestaj|izvoz`, `nalozi/dnevnik`, `plati/[month]/mpin|nalozi|pecati`, `zsXml/download`, etj.
2. **Cache për kërkesë** (`React.cache`) për `officeOwnerIn`, `bookOnlySetting` dhe leximet e `app_settings`. Pronari lexohet rreth 3 herë në çdo faqe (layout, `myViews`, `rokBadge`).
3. **Kontrolna tabla `/`:**
   - `invoicesWithPayments` / `purchasesWithPayments` ngarkojnë të gjitha faturat dhe hyrjet e firmës nga **të gjitha vitet**.
   - `stockSummary` ngarkon të gjitha lëvizjet e magacinit nga të gjitha vitet.
   - **Propozim:** filtër sipas vitit/datës dhe një thirrje e vetme `documentPayments` për të dyja llojet.
4. **`/banka`** (434 ms TTFB pas):
   - rreth 9 hapa sekuencialë;
   - `matchContext` i plotë në çdo hapje;
   - kontot dhe partnerët ngarkohen dy herë.
   - **Propozim:** paralelizim dhe ngarkimi i `matchContext` vetëm kur duhet (rishikim / redaktim rreshti).
5. **`/nalozi`:**
   - lista ngarkon të gjitha urdhrat e vitit me agregatin;
   - pamja e një urdhri ka 7 hapa sekuencialë;
   - redaktori i urdhrit vizaton një `<select>` me **të gjithë partnerët për çdo rresht**.
   - **Propozim:** faqosje si te faturat; një fushë kërkimi (datalist / autocomplete) e përbashkët për partnerët.
6. **Lista e faturave** ende ngarkon `loadDunning` → `invoicesWithPayments` për të gjitha vitet, si dhe `loadDocs` (të gjitha urdhrat me `meta.ref`, të gjitha rreshtat bankarë me referencë) dy herë.
7. **N+1 në faqet vjetore/mbledhëse:**
   - `payBatch/data.ts`: për çdo firmë 3–6 pyetje sekuenciale;
   - `lib/payroll/server.ts` `yearRuns`: 12 × 3 pyetje (`payGod`, `payM4`);
   - `lawrep`: `lawReview` për çdo firmë dhe `computeVatPeriod` për çdo periudhë.
   - **Propozim:** ngarkim në grup.
8. **Butonat e thjeshtë „Зачувај“** (`<button>` brenda `<form action>` pa `useFormStatus`) në shumë ekrane: `fiskPer`, `dosie`, `gradba`, `baranja`, `efPrep`, etj. Kalimi te `Submit` (tani me çaktivizim) ose te `ActionForm` do t’i mbronte nga klikimi i dyfishtë.
9. **`/zsNPO`, `/zsTP`:** të fshihen nga menyja për firmat që nuk janë OJQ / TP, ose të shfaqet një shënim në vend të 404.
10. **`toLocaleString('mk-MK')` në komponentë klienti:** `firm-picker`, `ai-compare`, `travel-order-flow`, `autop/close-table`, `klDash`, etj. Rrezik i njëjtë hidratimi si te `/semi`; të përdoret `lib/fmt`.
11. **Paketat e klientit:** `xlsx` (402 KB) është i ndarë në copëz më vete dhe hyn vetëm në 8 ekrane që e importojnë statikisht: `artNames`, `m_izlez`, `nivel`, `uvoz`, `g_lager`, `m_lager`, … përmes `_retail/read-file.ts`. Mund të ngarkohet me `import()` vetëm kur zgjidhet skedari.
12. **Matje në Postgres të vërtetë.** Kohët e mësipërme janë me PGlite, që ka një lidhje. Rekomandohet të ekzekutohet `smoke-all-views.spec.ts` edhe në një kopje të bazës së prodhimit në Postgres lokal (Docker), jo në serverin e prodhimit, për të parë fitimin e plotë të paralelizimit.

## 7. Kontrolli automatik (për më vonë)

`apps/web/e2e/smoke-all-views.spec.ts` hap çdo pamje të menysë dhe dështon nëse ndodh ndonjë nga këto:
- gabim në konsolë ose gabim faqeje;
- paralajmërim hidratimi;
- kërkesë e dështuar ose 5xx;
- kufiri i gabimit;
- shenjë „busy“ që nuk zhduket;
- faqe më e ngadaltë se `E2E_MAX_MS` (parazgjedhja 2 000 ms).

Tabela për çdo pamje ruhet në `apps/web/test-results/smoke-all-views.json`. Mënyra e ekzekutimit përshkruhet në `apps/web/e2e/README.md` („Smoke of every view“). Shkurt:

```sh
pnpm --filter @wise/web build
pnpm --filter @wise/web exec next start -p 3107          # me bazën lokale (PGlite ose Postgres) me të dhëna
E2E_FIRM="ДЕМО ТРГОВИЈА ДООЕЛ" pnpm --filter @wise/web e2e e2e/smoke-all-views.spec.ts
```

Variablat: `E2E_VIEWS=banka,nalozi` (vetëm këto pamje), `E2E_SKIP`, `E2E_YEAR`, `E2E_MAX_MS`.

**Shënim:** në PGlite faqja `/` mund të japë 500 („unnamed prepared statement“). Kjo vjen nga baza e zhvillimit, jo nga aplikacioni.
