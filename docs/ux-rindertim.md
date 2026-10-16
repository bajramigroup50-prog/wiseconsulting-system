# WISE – Rindërtimi i ndërfaqes (UX): analizë dhe propozim

> Dokument vetëm për analizë. Asnjë ndryshim në kod nuk është bërë. Çdo propozim ka numër (P1, P2, …) që pronari ta miratojë ose ta refuzojë një nga një. Emrat e ekraneve janë lënë në maqedonisht, siç i sheh stafi.
>
> Burimet e analizës:
> - menyja përfundimtare, e llogaritur nga `apps/web/lib/nav.ts` (`nav-data.ts` + 11 patch-e `nav-*.ts`);
> - shiriti i sipërm `components/top-bar.tsx` dhe `app/(app)/layout.tsx`;
> - faqja kryesore `app/(app)/page.tsx` dhe `book-home.tsx`;
> - faqet nën `app/(app)/*`;
> - punët e planifikuara në `apps/worker/src/jobs/*`.

---

## 1. Përmbledhje

Programi ka **~230 ekrane** dhe **14 grupe menyje** me **~190 zëra**.

**Si është menyja sot**
- Grupi **„Фирми“ ka 29 zëra** në një listë të vetme, pa ndarës. Aty përzihen:
  - zgjedhja e firmës;
  - ligjet (5 zëra);
  - afatet;
  - portali i klientëve;
  - kontratat e zyrës;
  - përdoruesit.
- Shumë zëra shfaqen **dy ose tre herë** në grupe të ndryshme:
  - `firmi`, `korisnici`, `dosie`, `paket` dhe `izlezF`, secili 2 herë;
  - `fiskPer`, `efaktura`, `prenosi`, `uprosek`, `kalkCalc` dhe `poobjekti`, secili 2 herë;
  - nënmenyja „🏭 Производство“ me 7 zëra, e gjitha 2 herë;
  - `mpinIn` 2 herë.
- Grupet **„Основни средства“, „Камати“ dhe „Помош“ kanë vetëm 1 zë secili**. Grupi „Излез“ e përsërit butonin e shiritit të sipërm „⏏ ИЗЛЕЗ ОД ФИРМАТА“.

**Problemet kryesore**
1. **I njëjti funksion ka disa hyrje me UI të ndryshme**:
   - importi i ekstrakteve bankare (banka, devizni, nalozi `?izv`, nalozi `&uvoz`);
   - 8 faqe me input-in e vet për skedarë;
   - 5 ekrane ligjesh;
   - 4 ekrane afatesh;
   - 6 ekrane raportesh.
2. **Cilësimet janë të shpërndara.** Cilësimet e zyrës ndodhen në 8 ekrane:
   - `kdogovori`: profili i zyrës;
   - `autop`;
   - `rokovi`;
   - `kdfakturi`;
   - `korisnici`;
   - `mailPotpis`;
   - `klInbox`: cilësimet e portalit;
   - `aiCitanje` dhe `aiTrosok`.

   Edhe cilësimet e kontabilitetit janë të ndara në 4 vende:
   - `nalozi?cfg`: numërimi;
   - `banka`: llogaritë dhe rregullat;
   - `semi`;
   - `konto`, `terkovi`, `tarifi`.
3. **Faqet kanë shumë butona në krye.** Numri i butonave/lidhjeve në kod:
   - plati 79;
   - banka 55;
   - nalozi 51;
   - kontroli 33;
   - firmi 32;
   - aml 30.

   Vetëm `banka` ka 8 butona në header. Nuk ka një model të përbashkët me 3 veprime kryesore dhe një meny „⋯“.
4. **Klikime të përsëritura** atje ku programi mund ta bëjë vetë punën:
   - kontimi rresht për rresht i ekstraktit;
   - numërimi me dorë;
   - „Поврзи со фактура“ për çdo pagesë;
   - ri-kontimi pas ndryshimit të skemave.

**Çfarë propozohet**
- **Menyja:** 14 grupe → **9 grupe** dhe ~190 → **~120 zëra të dukshëm**. Pjesa tjetër bëhen skeda (tabs) brenda ekranit „prind“.
- **Faqja standarde:** titull, të shumtën 3 veprime, „⋯“, një shirit filtrash dhe veprimet e rreshtit në „⋮“.
- **„Поставки“:** një vend i vetëm për çdo zonë.
- **Automatizime me hap „Преглед“:** detyrat i bën programi, njeriu vetëm i konfirmon.

**Parimi i kujdesit për stafin.** Të gjitha adresat e vjetra (`/banke`, `/uvozMat`, `/zsRok` …) mbeten si **ridrejtime**, që lidhjet dhe zakonet të mos prishen. Menyja e re hyn me një çelës „Мени: класично / ново“ (P40), që stafi mësuar me programin e vjetër të mos humbasë.

---

## 2. Dyfishimet e gjetura

| Nr | Funksioni | Ku shfaqet sot | Propozimi |
|---|---|---|---|
| **P1** | Importi i ekstraktit bankar | 1. `banka` (`import-box.tsx`, `#uvoz-izvod`) → `?review=1`<br>2. `devizni` (`<BankView fx/>`)<br>3. `nalozi?izv` dhe `nalozi?n=X&uvoz` (i njëjti `ImportBox` në „nalog mode“)<br>4. butoni „+ Нов налог – изводи“ në header-in e `banka`<br>5. `skan`, që e dërgon përdoruesin te `/banka` | **Një hyrje e vetme: „Изводи“** (`banka`), me skedat **Денарски / Девизни**. Importi bëhet gjithmonë aty dhe nalogu krijohet automatikisht. Në `nalozi` mbetet vetëm lidhja „Отвори го изводот“; hiqet butoni „+ Нов налог – изводи“ nga të dyja faqet. `devizni` bëhet skedë (`/banka?fx=1`). |
| **P2** | Kontimi i rreshtave të pakontuar | 1. `banka`: „✓ Прокнижи ги сите по предлогот“ për çdo ekstrakt<br>2. `banka`: „Прокнижи автоматски“ (`?review=1`) + AI `ClassifyButton` (dy kalime)<br>3. `nalozi`: „✓ Прокнижи ги сите во налогот“ (i njëjti `bookAllAction`) | **Një ekran „Преглед за книжење“** për të gjitha ekstraktet e firmës. Rregullat dhe AI aplikohen vetë, me ngjyra: ✓ gati / ⚠ pa propozim. Ka një buton „Прокнижи ги сите готови“. Kartela në `nalozi` hiqet. |
| **P3** | Lidhja e pagesës me faturën | Në `banka?line=` me butonin „Поврзи“ (FIFO tashmë i para-zgjedhur), në `bkAdv` me „Поврзи со фактура“ / „Затвори рачно“ (çon prapë te banka) dhe në `bkPick`/`bkUnl` (vetëm ridrejtime). | `bkAdv` bëhet **skeda „Без фактура“** te „Изводи“, me lidhje masive FIFO dhe konfirmim. `bkPick`/`bkUnl` mbeten vetëm si ridrejtime. |
| **P4** | Numërimi | `banka`: „Нумерирај изводи“ dhe „✓ Пополни ги броевите“. `nalozi`: „🔒 Фиксирај броеви“ dhe „Шифри на налози…“ (`?cfg`). | Numërimi bëhet **automatik gjatë ruajtjes** (P30). Rregullat hyjnë te **„Поставки → Книжење“** (P21). Butonat hiqen; mbetet vetëm „Фиксирај“ në menynë „⋯“, për raste të rralla. |
| **P5** | Bankat dhe formatet | `bankFmt` (formatet + „Провери датотека“), `banke` (→ `/banka?banks=1`), „Банкарски сметки…“ dhe „🔎 Формати по банка“ te banka, `konta-panel`. | Të gjitha këto shkojnë te **„Изводи → ⚙ Поставки“**, me seksionet: Сметки, Правила, Формати. `bankFmt` mbetet ridrejtim. |
| **P6** | Importi/konvertimi i skedarëve | 8 faqe me `type="file"` të vetin: `uvoz/importer`, `konvertor`, `firmiImp`, `pocetna`, `bankFmt/analyzer`, `recon` (3), `banka/import-box`, `blagajna/voucher-form`. Përveç tyre: `uvozMat` dhe `uvozMalo` (hub `_retail/uv-hub.tsx` → `/uvoz?t=`), `uvozStara`, `aiCitanje`. | **Një komponent i përbashkët `<Uvoz>`** me zvarritje, njohje automatike të formatit (Excel/CSV/XML/PDF/foto→AI), konvertor të integruar dhe shabllon. **Në meny mbetet një zë: „📥 Увоз“** (hub me skeda: Документи, Изводи, Шифрарници, Почетна, Фирми, Стара програма). `konvertor` bëhet hapi „Непознат формат?“ brenda importit, jo zë më vete. `uvozMat`/`uvozMalo` hiqen nga menyja. |
| **P7** | Skanimi/leximi i dokumenteve me AI | `skan`, `masovno` dhe `masovnoM` (i njëjti `scan-center.tsx`); `arNewNav` (`UploadField`, pa AI); importi UBL te `efaktura` (i njëjti `ScanUpload`); `klInbox` (dokumentet nga klientët). Ka tre komponentë upload: `ai-read.tsx`, `sales/scan-upload.tsx`, `upload-field.tsx`. | **Një „📥 Пристигнати документи“** (inbox): skanim, masiv, dokumente nga klientët, e-faturë e marrë dhe arkivim. Programi e njeh vetë llojin (faturë hyrëse/dalëse, ekstrakt, dokument arkivi) dhe e dërgon atje ku duhet. `masovno`/`masovnoM` → skedë; `arNewNav` → veprimi „Само архивирај“. |
| **P8** | Ligjet | `zakoni` (⚖️ Законски промени, roboti), `lawAi` (⚖ Правен асистент AI), `ujpZakoni` (📚 Закони на УЈП), `lawrep` (⚖️ Даночен преглед), `zakon` (⚖ Законска усогласеност). | **Një ekran „⚖ Закони“** me skedat: Промени / Асистент (AI) / Закони на УЈП / Даночен преглед / Усогласеност. Në meny ka 1 zë në vend të 5. Roboti në shiritin e sipërm çon te skeda „Промени“. |
| **P9** | Afatet dhe kujtesat | `rokovi` (📅 Календар на рокови + ⚙ Потсетници), `zsRok` (📅 Што, каде и кога се поднесува), `izvestuvanja` (🔔 njoftimet e autopilotit), „Рокови“ në faqen kryesore, distinktivi 📅 në shiritin e sipërm. `potsetnici` (kujtesat e servisit të makinave) është **tjetër gjë**: mbetet te Дејности. | **„📅 Рокови“** si ekran i vetëm, me skedat: Календар / Листа / Годишни сметки (përmbajtja e `zsRok`) / ⚙ Потсетници. `izvestuvanja` bashkohet me `autop` (P12). |
| **P10** | Raportet dhe analizat | `klDash` (📈 Табла), `analizi` (Анализи и извештаи), `analitika` (ИОС), `mojIzv` (🔒 Мој извештај), `firmIzv` (🗂 Целосен извештај, owner), `mesIzv` (📊 Месечен извештај за клиентот), `klIzv` (portali), `produktivnost`. | Grupi **„📊 Извештаи“** me dy nivele. **Për firmën:** Табла (`klDash`), Анализи (`analizi`), Месечен извештај (`mesIzv`), Целосен извештај (`firmIzv`). **Për zyrën:** Мој извештај (`mojIzv`), Продуктивност. `analitika` (ИОС) kthehet te Финансово, pranë karticave, ku i takon. |
| **P11** | Zyra dhe klientët | `kanc` (Задачи табла), `mojzad` (Мои задачи), `klInbox` (📥 Пристигнато), `klPortal` (👥 Портал), `klProfili` (🔑 Профили), `baranja`, `tpl`. | `kanc` + `mojzad` → **„Задачи“**, me filtrin „Мои / Сите“ (`mojzad` mbetet si filtër i paracaktuar për rolin `teren`). `klPortal` + `klProfili` → **„Портал за клиенти“**, me skedat Пристап / Профили / ⚙ Поставки (cilësimet e portalit dalin nga `klInbox`). `klInbox` shkon te inbox-i i përbashkët (P7). |
| **P12** | Njoftimet dhe autopiloti | `izvestuvanja` (🔔 për të gjitha firmat), `autop` (🤖 Автопилот + Поставки), butoni ⚠ te shiriti i sipërm, `AlStartup`, `AinbPanel`, `zatvoranje` (✅ mbyllja mujore), `insp` (🕵 inspekcioni), `kontroli`. | **„🤖 Автопилот“** si qendër e vetme: Наоди (ish `izvestuvanja`) / Месечно затворање / Подготвеност за инспекција / ⚙ Поставки. `kontroli` (kontrollet e inspektorëve) mbetet më vete, por brenda të njëjtit grup. |
| **P13** | Dosja dhe arkiva | `dosie` 2 herë (Фирми + Архива), `paket` 2 herë, `arhiva`, `arNewNav`, `zsDos` (dosja e llogarive vjetore). | Mbeten vetëm në **„Архива“**: Архива / Досие / Пакет. Nga „Фирми“ hiqen. `zsDos` bëhet skedë e „Досие“ (filtër „Годишни сметки“). |
| **P14** | Firmat | `firmi` 2 herë (Фирми + Систем), `firmiImp`, `firmiResh`, `izlezF` 2 herë (+ butoni ⏏ i shiritit), `moduli`. | **„Фирми“**: një zë. Veprimet „+ Нова“, „📷 Од решение“ dhe „📥 Од Excel“ futen në menynë „⋯“ të ekranit. `moduli` bëhet skedë te kartela e firmës. Grupi „Излез“ hiqet, sepse mjafton butoni ⏏ i shiritit. |
| **P15** | Përdoruesit | `korisnici` 2 herë (Фирми + Систем), `lozinka`, `uredi` (🔐), `aktivnost`, `greski`. | Vetëm te **„Систем → Корисници“**, me skedat Колеги / Клиенти / Пристап / Уреди / Заклучени. |
| **P16** | Prodhimi | Nënmenyja „🏭 Производство“ (7 zëra) është kopjuar në **Материјално dhe Малопродажба** (`nav-dejnosti.ts`). | Mbetet **një herë**, si grup ose nënmeny e vetme. Tek Малопродажба hiqet. |
| **P17** | Zëra të kopjuar Материјално ↔ Малопродажба | `fiskPer` (gjithashtu te Финансово), `efaktura`, `prenosi`, `uprosek`, `kalkCalc`. `poobjekti` te Финансово + Материјално. `kalkG`/`kalkM`, `masovno`/`masovnoM`, `g_lager`/`g_lagerk`, `m_lager`/`m_lagerp`, `g_kartica`/`m_kartica`. | Këto ekrane e ndajnë tashmë kodin (`_stock/lager-page.tsx`, `_stock/kart-page.tsx`, `_retail/kalk-page.tsx`, `components/sales/scan-center.tsx`); ndryshojnë vetëm nga një parametër. Prandaj bashkimi në UI është i lirë. Bashkimi i ekraneve të njëjta: **Лагер листа** me çelësin „скратена / проширена“, **Картица** me filtrin „Магацин / Продавница“, **Влезни калкулации** me filtrin e vendndodhjes. Çdo zë i përbashkët shfaqet **një herë**. Shënim: bashkimi kërkon kontroll të paritetit me programin e vjetër (shih Rreziqet). |
| **P18** | Kodet (шифрарници) | `sifrarnik` (hub), plus si zëra më vete: `partneri`, `artikli`, `uslugiS`, `artNames`, `artQ`, `artKonta`, `barkodi`, `konto`, `tarifi`, `terkovi`, `kursna`. Edhe tre kode page brenda „Плата“: `cb_city`, `cb_paysif`, `cb_position`. | Në meny mbeten 4: **Комитенти, Артикли и услуги, Контен план, Сите шифрарници**. `artNames`, `artQ`, `artKonta` dhe `barkodi` bëhen skeda/veprime „⋯“ te Артикли. `cb_*` e pagave hyjnë te „Плата → ⚙ Шифри“. |
| **P19** | Pagat | Nënmenyja „Плата“ ka 13 zëra: `plati`, `payBatch`, `mpinIn` (+ `mpinIn` te Фирми), `vraboteni`, `payPredlog`, `payGod`, `payM4`, `pdd`, `dogovori`, 3 `cb_*`. Faqja `plati` ka **79 butona**. | **„Плата“** me 4 zëra: Пресметка, Вработени, Плати – сите фирми, Годишни (М4/извештај). `payPredlog` futet si hap në „Пресметка“, `mpinIn` si skedë e „Плати – сите фирми“, `pdd`/`dogovori` si skeda të „Вработени“. Faqja `plati` duhet ndarë në hapa (P26). |
| **P20** | Llogaria vjetore | `zsProc` (по фази), `zsDos`, `zsNPO`, `zsTP`, `zsRok`, plus `mbyllja`, `vjetore`, `prenos`, `zs_*` (pa meny). | **„Завршна сметка“** me 1 zë (`zsProc`, magjistar me faza). Lloji i subjektit (ДОО/НПО/ТП) zgjidhet automatikisht nga firma. `zsNPO`/`zsTP` bëhen variante të fazave, `zsRok` shkon te P9. |
| **P21** | Cilësimet e kontabilitetit | `nalozi?cfg` (numërimi, kodet e nalogeve, 🔒 data e kyçjes), `semi` (Систем), `terkovi`, `tarifi`, `konto`, `banka` (rregullat), `firmi/firm-form` („Конта за ДДВ по стапки“). | **„Поставки → Книжење“** për firmën: Нумерација, Заклучување, Шеми, Теркови, Тарифи, Правила за изводи, ДДВ конта. |
| **P22** | Cilësimet e zyrës | Profili i zyrës te `kdogovori`, `autop`, `rokovi` (⚙ Потсетници), `kdfakturi` (⚙ Поставки), `korisnici` (🔒 Колегите гледаат само сметководство), `mailPotpis`, `klInbox` (Поставки на порталот), `aiCitanje`, `aiTrosok` (limiti). | **„Систем → ⚙ Поставки на канцеларијата“**: Профил, Е-пошта и потпис, Автопилот, Рокови, Фактурирање, Портал, AI, Пристап. Ekranet ekzistuese lexojnë po nga i njëjti `OfficeProfile` (`packages/db/src/office.ts`), kështu që ndryshimi është kryesisht në UI. |
| **P41** | Mjetet e eksportit/importit dhe formularët (në kod) | 5 shirita eksporti që mbivendosen: `components/list-tools.tsx`, `doc-tools.tsx`, `vp-tools.tsx`, `parity-fin/export-bar.tsx`, `download-csv.tsx`. 3 mbështjellës formularësh: `action-form.tsx`, `yearend/action-form.tsx`, `stock-ui.tsx`. 2 `confirm-link.tsx`. Nuk ka komponent të përbashkët tabele. | Një `<ExportMenu>` brenda „⋯“ të `<PageHeader>`, një `ActionForm`, një `<DataTable>` me „⋮“ dhe veprime masive. Kjo është baza teknike e P27. |
| **P45** | Emra që ngatërrohen | `prenosi` (магацин→продавница) dhe `prenos` (пренос во нова година); `m_izlez` (излез од продавница) dhe `izlez` (фактури); `kkart`/`kartici` dhe `g_kartica`/`m_kartica` | Emra të qartë: „Пренос во продавница“ / „Пренос на салда во нова година“, „Отпис/излез од продавница“ / „Излезни фактури“ |
| **P23** | Cilësime lokale në ekranet e degëve | `kasa/aparat` (⚙️ Фискален апарат), `blagajna` (⚙ Благајни), `opomeni` (⚙ Рок, затезна камата), `pnalozi` (⚙ Стандардно), `termini`, `tura`, `hotelSoby`, `flota`, `gradba`, `lojalnost` (⚙ Правила), `lotovi`, `frDnev`. | Këto mbeten në ekranin e tyre, por **gjithmonë në të njëjtin vend**: butoni „⚙“ djathtas lart në header, që hap një panel anësor. Nuk ka më seksione cilësimesh në mes të faqes. |

---

## 3. Struktura e re e menysë

### 3.1 Sot: 14 grupe, rreth 190 zëra

| Grupi | Zëra | Problemi |
|---|---|---|
| Фирми | 29 | Përzierje e firmave, ligjeve, afateve, portalit, kontratave dhe përdoruesve |
| Финансово | 21 + Плата 13 + Завршна 5 | Shumë i gjatë; `fiskPer` dhe `poobjekti` janë të kopjuar |
| Архива | 4 | `dosie` dhe `paket` janë të kopjuar |
| Материјално | 18 + Производство 7 + 2 nënmeny | Nënmenytë janë të thella |
| Малопродажба | 17 + Производство 7 | Kopje nga Материјално |
| Дејности | 32 | Shfaqet vetëm sipas moduleve |
| Анализи | 3 | — |
| Основни средства | 1 | Grup me 1 zë |
| Камати | 1 | Grup me 1 zë |
| Шифрарник | 12 | — |
| Систем | 14 | `firmi` dhe `korisnici` të kopjuar; importet janë këtu |
| Канцеларија | 9 | — |
| Помош | 1 | Grup me 1 zë |
| Излез | 1 | E njëjtë me butonin ⏏ |

### 3.2 Propozimi: 9 grupe (**P24**)

```
🏠 Почетна                 (Контролна табла; WISE Робот mbetet paneli anësor + zë i vogël)

🏢 Канцеларија             (puna e zyrës për të gjitha firmat)
   Фирми                    [⋯ Нова · Од решение · Од Excel · Модули]
   🤖 Автопилот             [Наоди · Месечно затворање · Инспекција · ⚙]
   📅 Рокови                [Календар · Листа · Годишни сметки · ⚙]
   ⚖ Закони                 [Промени · Асистент · УЈП · Даночен преглед · Усогласеност]
   📑 Контроли и решенија
   ✅ Задачи                [Мои / Сите]
   👥 Портал за клиенти     [Пристап · Профили · ⚙]
   ✍ Договори и фактури за услуги   (owner)   [kdogovori · kdfakturi]
   📄 Барања, обрасци, шаблони      [baranja · tpl · osnovanje]
   🛡 Усогласеност на канцеларијата [aml · zzlp]
   ── për të gjitha firmat ──
   📥 МПИН од УЈП · 🧾 е-Фактура подготовка · 👥 Плати – сите фирми

📥 Документи               (gjithçka që hyn)
   Пристигнати документи    [Скенирај · Масовно · Од клиенти · е-Фактура · Само архивирај]
   📥 Увоз                  [Документи · Изводи · Шифрарници · Почетна · Стара програма]
   📂 Архива                [Архива · Досие · Пакет]

💰 Финансии
   Изводи                   [Денарски · Девизни · Без фактура · Преглед за книжење · ⚙]
   Благајна
   Платни налози (ПП)
   Компензации
   Позајмици и заеми
   ──
   Налози за книжење
   Картици                  [По комитент · По конто · Споредба (recFree) · Усогласување (recon)]
   ИОС (analitika)
   Бруто биланс
   Резултат по објекти
   ──
   ДДВ                      [ДДВ-04 · Книги · Фискални извештаи]
   Основни средства
   Казнена камата
   Почетна состојба
   Завршна сметка

👷 Плата
   Пресметка · Вработени · Годишни (М4 / извештај) · ⚙ Шифри

📦 Магацин и продажба      (Материјално + Малопродажба, me filtrin e vendndodhjes)
   Излезни фактури · Влезни (влез/калкулации) · Услуги · Одобрения/Повратници
   Неплатени и опомени      [+ Историја на праќања]
   Профактури · Испратници · Приемници/издатници · Пренос
   Лагер · Картица · Трговска книга (ЕТ / МЕТГ) · КДФИ
   Каса · Нивелација · Акции · Упросечување · Калкулатор
   🏭 Производство          (një herë)

🧩 Дејности                (vetëm modulet e ndezura; pa ndryshim në strukturë)

📊 Извештаи
   Табла · Анализи · Месечен извештај · Целосен извештај (owner)
   Мој извештај · Продуктивност (owner)

⚙ Систем
   Поставки на канцеларијата · Поставки на фирмата (Книжење)
   Корисници · Шифрарници (Комитенти · Артикли · Контен план · Сите)
   Курсна листа · Резервна копија · Дневник на активности · Грешки · AI · Упатство
```

**Rezultati.** Menyja ka 9 grupe dhe rreth 75 zëra të nivelit të parë, pa grupet e moduleve. Zërat që hiqen nuk zhduken: bëhen skeda brenda ekraneve ose mbeten si ridrejtime.

**P25. Kërkimi në meny (Ctrl+K).** Sot nuk ka kërkim në menynë `components/nav.tsx`. Propozohet një fushë „Пребарај екран…“ që gjen çdo ekran sipas emrit të vjetër dhe të ri, edhe atë që është bërë skedë. Ky është mjeti kryesor për stafin që e kërkon ekranin me emrin e programit të vjetër.

**P26. Shiriti i sipërm (`components/top-bar.tsx`).** Sot ka 5 distinktivë me ngjyra të ndryshme:
- roboti i ligjit;
- 🔒 kyçjet;
- 💲 AI;
- 📅 afatet;
- zarfi;
- ⚠ njoftimet.

Propozohet:
- **një „🔔 Qendër njoftimesh“** me numër të përbashkët, e cila hap një listë me skedat Ligje / Afate / Klientë / Autopilot / Sistem;
- **„⏏ ИЗЛЕЗ ОД ФИРМАТА“** mbetet, por me madhësi normale;
- **pill-i „Базата е поврзана“** shfaqet vetëm kur ka problem.

---

## 4. Rregullat e faqes standarde (P27)

Në kod ekziston tashmë `components/hd.tsx` (`<Hd>`), i përdorur në rreth 178 faqe. Propozimi e zgjeron atë në një **`<PageHeader>`**:

1. **Header-i**
   - titulli dhe nëntitulli (firma · periudha);
   - **të shumtën 3 veprime kryesore** djathtas (p.sh. „+ Нова“, „📥 Увоз“, „Прокнижи“);
   - një buton **„⋯ Повеќе“** për veprimet e rralla: CSV/Excel/PDF, printim, fshirje masive, rinumërim, „Фиксирај броеви“, ri-kontim;
   - butoni **„⚙“** për cilësimet e asaj zone, i cili hap një panel anësor.
2. **Shiriti i filtrave**
   - një rresht i vetëm nën header: periudha, kërkimi, statusi, vendndodhja;
   - filtrat ruhen në URL;
   - butoni „Исчисти“.
3. **Tabelat**
   - veprimet e rreshtit futen në menynë **„⋮“**; vetëm 1 veprim i shpejtë mbetet i dukshëm (p.sh. „✓ Прокнижи“);
   - zgjedhja me kutizë shfaq një **shirit veprimesh masive** në fund të faqes („3 избрани · Прокнижи · Избриши“).
4. **Mesazhet (callouts)**
   - të shumtën 1 callout i verdhë/i kuq në krye;
   - nëse ka më shumë, ato bashkohen: „3 работи бараат внимание ▸“.
5. **Skedat në vend të dritareve të reja**
   - ekranet e lidhura hapen si skeda (`?t=`) brenda të njëjtit ekran;
   - nuk hapet faqe ose dritare e re.
6. **Konfirmimi**
   - çdo veprim masiv tregon një parapamje („Ќе се прокнижат 42 ставки, вкупно …“) para se të ekzekutohet;
   - veprimet në një periudhë të kyçur refuzohen (siç bëhet tani).
7. **Ikonat dhe emrat**
   - emojit në meny përdoren vetëm për grupet, ose për asnjë zë; sot ato janë të përziera, p.sh. „⚖️“ dhe „⚖“;
   - emrat janë të shkurtër: „Изводи“, jo „Изводи (денарски)“, sepse denari/devizat janë skeda.

Faqet që duhen ristrukturuar së pari, sipas numrit të butonave në kod:
- `plati` (79);
- `banka` (55);
- `nalozi` (51);
- `kontroli` (33);
- `firmi` (32);
- `aml` (30);
- `vraboteni` (29);
- `kasa` (26);
- `kartici` (26);
- `ddv` (24).

---

## 5. Automatizime

Programi tashmë ka punë të planifikuara në `apps/worker/src/jobs`:
- `autopilot` çdo 6 orë;
- `law` çdo ditë;
- `rokovi` në 07:10;
- `fee.invoices` në 06:40;
- `nbrm.rates` 3 herë në ditë;
- `recurring` në 06:00;
- `reminders` çdo orë;
- `mail` çdo 5 minuta.

Propozimet më poshtë ndërtohen mbi këtë infrastrukturë. **Rregulli i përbashkët:** programi përgatit punën, njeriu e sheh te „Преглед“ dhe e konfirmon me një klik. Asgjë nuk kontohet në heshtje në një periudhë të kyçur.

| Nr | Çfarë bëhet me dorë sot | Automatizimi | Hapi „Преглед“ |
|---|---|---|---|
| **P28** | Pas importit të ekstraktit: rregullat → „Прокнижи автоматски“ → klasifikimi AI → „✓ {konto}“ rresht për rresht | Gjatë importit, **rregullat + FIFO + AI aplikohen në një kalim** | Lista „Готови (N) / Без предлог (M)“ dhe butoni „Прокнижи ги готовите“ |
| **P29** | „Поврзи“ / „Поврзи со фактура“ për çdo pagesë (`banka?line=`, `bkAdv`) | Lidhja automatike pagesë↔faturë kur shuma dhe partneri përputhen (FIFO). Rastet e dyshimta shkojnë në „Без фактура“ | Lista e lidhjeve të propozuara me kutiza |
| **P30** | „Нумерирај изводи“, „✓ Пополни ги броевите“, „🔒 Фиксирај броеви“ | **Numri jepet gjatë ruajtjes** sipas rregullit te Поставки; fiksimi bëhet automatikisht kur periudha kyçet | Asnjë; në „⋯“ mbetet vetëm „Ренумерирај“ me paralajmërim |
| **P31** | „Прекнижи ги сега“ pas ndryshimit të skemës ose kontos (`repost-callout.tsx`, `konta-panel`) | Ri-kontimi bëhet **automatikisht në sfond** pas ruajtjes (punë worker-i), vetëm për periudhat e hapura | Njoftim: „Прекнижени 120 налози · види разлики“ |
| **P32** | Ekstraktet që vijnë me e-mail/portal → shkarkim → import | Inbox-i i përbashkët (P7) e njeh ekstraktin dhe e **importon vetë** te firma e duhur, sipas IBAN-it | Hyn në listën „Преглед за книжење“ |
| **P33** | Faturat hyrëse të skanuara: „Провери“ për çdo dokument (`skan`) | Dokumentet me besueshmëri të lartë të AI dhe partner të njohur shënohen „спремни“ | „Зачувај ги сите спремни“ edhe për blerjet (sot ekziston vetëm për shitjet) |
| **P34** | `efaktura`: „XML (UBL)“ për çdo faturë | Eksport masiv sipas periudhës (ZIP) dhe, kur kërkohet ligjërisht, dërgim automatik | Lista e faturave të periudhës |
| **P35** | Mbyllja mujore (`zatvoranje`) për 280 firma, firmë pas firme | Në fund të muajit, **autopiloti** kontrollon çdo firmë (ekstraktet e pakontuara, ДДВ, pagat, karticat) | Tabela „готови за затворање“ → „Затвори ги избраните“ |
| **P36** | Pagat: hyrja e `payPredlog` dhe llogaritja për çdo firmë | Përsëritja automatike e muajit të kaluar si draft për të gjitha firmat (`payBatch` ekziston, por thirret me dorë); МПИН-i i pranuar lidhet vetë | „Плати – сите фирми“: drafti → „Потврди“ |
| **P37** | ДДВ-04: hapja e ekranit për çdo firmë | Përgatitja automatike e draftit të ДДВ-04 në ditën e afatit − 5, me njoftim në 📅 Рокови | Lista e drafteve për konfirmim |
| **P38** | Raporti mujor për klientin (`mesIzv` „⚙ Подготви за сите клиенти“) | Planifikim mujor (worker) dhe dërgim në portal | Draftet e raportit → „Испрати“ |
| **P39** | `pocetna`: „⇄ Д/П“ për çdo rresht, zgjedhja e formatit | Njohja automatike e anës (debit/kredit) sipas klasës së kontos; formati i paqartë kërkon një pyetje, jo disa butona | Parapamja e bilancit fillestar |
| **P42** | Butonat „Провери сега“ për punë që worker-i tashmë i bën: `autop` „🔄 Провери сега“ (autopilot çdo 6 orë), `izvestuvanja` „↻ Провери повторно“, `rokovi` „↻ Освежи“ (07:10), `zakoni` „▶ Провери сега“ (06:52) | Butoni zëvendësohet me statusin „Последна проверка: денес 07:10“; vetë butoni kalon te „⋯“ | — |
| **P43** | Punë pa orar: `lawrep` „▶ Провери ги сите“, `opomeni` „💬 WhatsApp на сите“ (sendDunningAll), `aml` amlScanRun / amlPurge, sinkronizimi `law.texts`, dërgimi i `potsetnici` | Punë të reja në worker: kontrolli tatimor natën, opomenat sipas nivelit (javore), AML çdo javë, sinkronizimi i ligjeve çdo ditë, kujtesat e servisit në punën `reminders` | Lista e opomenave/gjetjeve para dërgimit |
| **P44** | `moduli` suggestModulesAction / autoProfilesAction, `kdogovori` „🔄 Внеси ги“ (syncRecurring), `klInbox` rrugëzimi, `mpinIn` shpërndarja | Bëhen automatikisht gjatë ngjarjes: krijimi i firmës ose ndryshimi i НКД-së, ruajtja e kontratës, besueshmëri e lartë e klasifikimit, përputhja e sigurt me ЕДБ-në | Vetëm rastet e pasigurta mbeten për dorë |

---

## 6. Plani në faza

Vlerësimi i përpjekjes: **S** = deri në 1 ditë, **M** = 2–4 ditë, **L** = 1–2 javë. Të gjitha ndryshimet janë vetëm në UI/meny, përveç kur thuhet ndryshe. Adresat e vjetra mbeten ridrejtime.

### Faza 1 – Fitore të shpejta (rreth 1–2 javë)

| Propozimi | Puna | Përpjekja |
|---|---|---|
| P13, P14, P15, P16, P17 (vetëm menyja) | Hiqen zërat e kopjuar nga menyja (`dosie`, `paket`, `firmi`, `korisnici`, `izlezF`, `fiskPer`, `efaktura`, `prenosi`, `uprosek`, `kalkCalc`, `poobjekti`, Производство në Малопродажба, `mpinIn` i dytë). Ndryshohen `nav-data.ts` dhe `nav-dejnosti.ts`; testet `nav*.test.ts` përditësohen | S |
| Grupet me 1 zë | „Основни средства“ dhe „Камати“ → Финансово, „Помош“ → Систем, „Излез“ hiqet | S |
| P25 | Kërkimi në meny (Ctrl+K) në `components/nav.tsx`, me emrat e vjetër si sinonime | M |
| P1 (pjesa e parë) | Hiqet butoni „+ Нов налог – изводи“ nga `banka` dhe `nalozi`; importi mbetet vetëm te Изводи; `devizni` → skedë | S |
| P8 | `zakoni`, `lawAi`, `ujpZakoni`, `lawrep`, `zakon` → një ekran me skeda (faqet ekzistuese ripërdoren si skeda) | M |
| P9 | `rokovi` + `zsRok` → një ekran me skeda | S |
| P5 | `bankFmt`, `banke`, „Банкарски сметки…“ → „Изводи → ⚙“ | S |
| P40 | Çelësi „Мени: класично / ново“ te `korisnici` (për çdo përdorues), që stafi të kalojë gradualisht | S |

### Faza 2 – Faqja standarde dhe cilësimet (rreth 3–5 javë)

| Propozimi | Puna | Përpjekja |
|---|---|---|
| P27 | `<PageHeader>` (3 veprime + „⋯“ + „⚙“), `<FilterBar>`, `<RowMenu>`, `<BulkBar>`; zbatohen së pari te `banka`, `nalozi`, `plati`, `firmi`, `kartici` | L |
| P22 | „Поставки на канцеларијата“: një ekran me seksione mbi `OfficeProfile`. Formularët ekzistues zhvendosen nga `kdogovori`, `autop`, `rokovi`, `kdfakturi`, `korisnici`, `mailPotpis`, `klInbox`, `aiCitanje`, `aiTrosok` | M |
| P21 | „Поставки → Книжење“ për firmën (`nalozi?cfg`, `semi`, `terkovi`, `tarifi`, kontot e ДДВ nga `firm-form`) | M |
| P23 | Butoni „⚙“ me panel anësor për cilësimet e degëve | M |
| P10, P11, P12 | Grupet „Извештаи“ dhe „Канцеларија“; `kanc`+`mojzad`, `klPortal`+`klProfili`, `izvestuvanja`+`zatvoranje`+`insp` → Автопилот | M |
| P18, P19, P20 | Kodet (4 zëra), Плата (4 zëra + skeda), Завршна сметка (1 zë) | M |
| P24 | Menyja e re me 9 grupe (pas P40) | M |
| P26 | „🔔 Qendra e njoftimeve“ në shiritin e sipërm | M |
| P30, P4 | Numërimi automatik gjatë ruajtjes | M |

### Faza 3 – Automatizimet dhe bashkimet e thella (rreth 6–10 javë)

| Propozimi | Puna | Përpjekja |
|---|---|---|
| P2, P28 | „Преглед за книжење“ i përbashkët për të gjitha ekstraktet; rregullat + FIFO + AI në një kalim | L |
| P3, P29 | Lidhja automatike e pagesave me faturat; `bkAdv` → skedë | M |
| P6 | Komponenti i përbashkët `<Uvoz>` me njohje të formatit; zëvendëson 8 input-et e veçanta | L |
| P7, P32, P33 | „Пристигнати документи“: inbox-i i përbashkët me njohje të llojit dhe importim automatik të ekstrakteve sipas IBAN-it | L |
| P31 | Ri-kontimi automatik në sfond (punë e re në worker) | M |
| P35, P36, P37, P38 | Mbyllja mujore, pagat, ДДВ-04 dhe raportet mujore si punë të planifikuara me draft dhe konfirmim | L |
| P17 (ekranet) | Bashkimi i ekraneve të lagerit, karticës dhe kalkulacioneve (magazinë/dyqan) | L |
| P34, P39 | Eksporti masiv i e-faturës; njohja automatike e anës në `pocetna` | M |

---

## 7. Rreziqet

| Rreziku | Ku | Masa mbrojtëse |
|---|---|---|
| **Stafi e kërkon ekranin në vendin e vjetër.** Programi pasqyron programin e vjetër (`legacy/index.html`, `NAV`) dhe stafi e njeh përmendësh | P24, P13–P20 | P40 (menyja klasike/e re për çdo përdorues), P25 (kërkimi me emrat e vjetër), ridrejtime për çdo URL të vjetër, një shënim „Се премести во …“ për 2–3 muaj |
| **Prishja e paritetit me programin e vjetër.** Komentet në kod citojnë rreshtat e legacy dhe testet `nav-*.test.ts` kontrollojnë renditjen e saktë | të gjitha propozimet e menysë | Testet përditësohen me qëllim (jo fshihen); ekranet nuk fshihen, vetëm zhvendosen; menyja klasike mbetet e disponueshme |
| **Të drejtat e aksesit.** `viewAllowed`, `nav-access.ts` („Пристап до менија“), `BOOK_ONLY_VIEWS`, `OWNER_VIEWS` dhe `proxy.ts` mbështeten te ID-të e ekraneve të menysë | P8–P20 | ID-të e ekraneve mbeten të njëjta; skedat kontrollojnë të drejtën e ID-së së tyre të vjetër; testi i ri kontrollon që asnjë ekran i dhënë kolegut nuk humbet |
| **Kontimi automatik i gabuar** | P28, P29, P31, P35–P37 | Gjithmonë draft + „Преглед“; asgjë në periudhë të kyçur; auditim (`audit`) për çdo veprim masiv; çelës „автоматски“ te Поставки, fikur si fillim për çdo firmë |
| **Ri-kontimi në sfond ndryshon numrat dhe shumat** që klienti i ka parë | P31 | Vetëm periudhat e hapura; raport „разлики“ para/pas |
| **Bashkimi i ekraneve të magazinës dhe të dyqanit** (`g_*` dhe `m_*`) ka rregulla të ndryshme kontabël (çmimi me ДДВ, МЕТГ) | P17 | Bashkohet vetëm UI-ja (filtri); logjika mbetet e veçantë; ky hap shtyhet në Fazën 3 |
| **Klientët e portalit** (`klNav`, roli `klient`) | P11 | Menyja e klientit nuk ndryshon në asnjë fazë |
| **Roli `teren`** ka vetëm `mojzad` dhe `mojpn` | P11 | Mbetet `mojzad` si URL dhe filtër i paracaktuar |
| **Ngarkesa e punës dhe regresionet** në faqe të mëdha (`plati` 79 butona, `banka` 55) | P27 | Rinovimi bëhet faqe pas faqeje, pas çelësit P40, me testet ekzistuese |
| **Moduli „Дејности“ dhe filtrat e moduleve** (`filterNavByModules`) | P24 | Grupi Дејности mbetet siç është; ndryshon vetëm vendi në renditje |

---

### Lista e shpejtë për miratim

| Nr | Shkurt | Faza |
|---|---|---|
| P1 | Importi i ekstraktit vetëm te „Изводи“ | 1 / 3 |
| P2 | Një „Преглед за книжење“ | 3 |
| P3 | `bkAdv` → skedë, lidhje masive | 3 |
| P4 | Numërimi pa butona | 2 |
| P5 | Bankat/formatet → Изводи ⚙ | 1 |
| P6 | Një import i përbashkët | 3 |
| P7 | Inbox-i i përbashkët i dokumenteve | 3 |
| P8 | 5 ekranet e ligjeve → 1 | 1 |
| P9 | Afatet → 1 ekran | 1 |
| P10 | Grupi „Извештаи“ | 2 |
| P11 | Задачи + Портал të bashkuar | 2 |
| P12 | Автопилот si qendër | 2 |
| P13 | Архива vetëm një herë | 1 |
| P14 | Фирми: 1 zë + „⋯“ | 1 |
| P15 | Корисници vetëm te Систем | 1 |
| P16 | Производство vetëm një herë | 1 |
| P17 | Zëra/ekrane të kopjuar Матер./Мало | 1 / 3 |
| P18 | Шифрарник 4 zëra | 2 |
| P19 | Плата 4 zëra | 2 |
| P20 | Завршна сметка 1 zë | 2 |
| P21 | Поставки → Книжење | 2 |
| P22 | Поставки на канцеларијата | 2 |
| P23 | „⚙“ i njëjtë në degë | 2 |
| P24 | Menyja me 9 grupe | 2 |
| P25 | Kërkimi Ctrl+K | 1 |
| P26 | Qendra e njoftimeve | 2 |
| P27 | Faqja standarde | 2 |
| P28 | Kontimi i ekstrakteve në një kalim | 3 |
| P29 | Lidhja automatike pagesë↔faturë | 3 |
| P30 | Numri gjatë ruajtjes | 2 |
| P31 | Ri-kontimi automatik | 3 |
| P32 | Ekstraktet nga inbox-i automatikisht | 3 |
| P33 | „Зачувај ги сите спремни“ për blerjet | 3 |
| P34 | e-Фактура masiv | 3 |
| P35 | Mbyllja mujore automatike | 3 |
| P36 | Pagat draft për të gjitha firmat | 3 |
| P37 | ДДВ-04 draft automatik | 3 |
| P38 | Raporti mujor i planifikuar | 3 |
| P39 | Pocetna pa „⇄ Д/П“ | 3 |
| P40 | Çelësi menyja klasike/e re | 1 |
| P41 | Komponentët e përbashkët (eksport, formular, tabelë) | 2 |
| P42 | „Провери сега“ → status i punës automatike | 1 |
| P43 | Punë të reja të planifikuara (lawrep, opomeni, aml, ligje, servis) | 3 |
| P44 | Veprime automatike në ngjarje (moduli, kontratat, inbox, МПИН) | 3 |
| P45 | Emra më të qartë (prenos/prenosi, izlez/m_izlez) | 1 |
