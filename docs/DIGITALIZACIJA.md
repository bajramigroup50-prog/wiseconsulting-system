# Digjitalizimi i zyrës – katalog i mundësive

Data: 11.10.2026. Përgatitur për pronarin e zyrës (сметководствено биро me licencë, shumë firma-kliente).
Qëllimi: të shihet çfarë mund të digjitalizohet akoma, çfarë kemi biseduar por nuk është bërë, dhe çfarë kërkon ligji – që zyra të jetë „në rregull me gjithçka“.

**Si është bërë:** (1) inventar i programit (menyja `apps/web/lib/nav-data.ts` + `nav-*.ts`, `docs/ROADMAP.md`, `docs/parity/*`, faqet kryesore), që të mos propozohet diçka që ekziston; (2) kërkim në internet për institucionet në Maqedoninë e Veriut. Burimet janë në fund (§7). **Kujdes:** për shumë tema burimet janë blogje të firmave softuerike ose lajme, jo tekste zyrtare – datat dhe detajet teknike duhet të verifikohen në Службен весник / ЕНЕР / faqet e institucioneve para se të ndërtohet diçka. Kjo shënohet te çdo pikë me „⚠ verifiko“.

**Legjenda**
- **Përpjekja:** S = deri në disa ditë pune, M = 1–3 javë, L = më shumë se 3 javë ose varet nga institucioni.
- **Rekomandimi:** ✅ Tani · 🕒 Më vonë · ❌ Nuk ia vlen (tani për tani).
- **Në program:** shtegu i menysë ku ekziston diçka e ngjashme (emrat e menysë janë në maqedonisht, si në program).

---

## 0. Top-10 – përmbledhje

| # | Ideja | Pse tani | Përpj. | Rek. |
|---|---|---|---|---|
| 1 | **е-Фактура – lidhje direkte me API-n e УЈП** (dërgim, pranim/refuzim, storno, EUID + QR, nënshkrim JWS) | Projektligji: vullnetare nga 01.10.2026, **e detyrueshme për ДДВ-обврзници nga 01.04.2027**, për jo-ДДВ nga 01.07.2027, për të gjithë nga 01.01.2028 ⚠ verifiko | L | ✅ Tani (fillo me testin) |
| 2 | **Kopje rezervë jashtë serverit (offsite) + provë rikthimi çdo muaj** | Sot kopja e natës (`docker/backup.sh`) ruhet **në të njëjtin VPS** – nëse bie serveri, bie edhe kopja | S | ✅ Tani |
| 3 | **Hyrje me 2 hapa (2FA) + bllokim pas tentativave të gabuara** | Nuk ka 2FA dhe nuk ka kufizim të tentativave në login; zyra mban të dhëna financiare e personale të qindra firmave (ЗЗЛП, ligji i ri për sigurinë e rrjeteve) | S–M | ✅ Tani |
| 4 | **Kursi i НБРМ automatikisht çdo ditë** (shërbimi publik REST/JSON i НБРМ) | Sot `Шифрарник › Курсна листа` mbushet me dorë/Excel; çdo gabim kursi prish devizat, blagajnën, diferencat kursore | S | ✅ Tani |
| 5 | **Kuti e-maili për dokumente (OCR inbox)** – çdo firmë ka adresën e vet, bashkëngjitjet shkojnë vetë në „Пристигнато“ dhe lexohen me AI | Klientët sot dërgojnë faturat me e-mail/Viber dhe dikush i ngarkon me dorë | M | ✅ Tani |
| 6 | **Kalendar i afateve për të gjitha firmat + kujtesa automatike** (МПИН 10-ti, ДДВ-04 25-ti, аконтации, М1/М2, годишна сметка, ДБ, ПДД-ГИ, ДЗС…) me eksport në Google/Outlook (ICS) | Sot afatet janë të shpërndara (Автопилот, Известувања, „Што, каде и кога“ vetëm për завршна сметка) | M | ✅ Tani |
| 7 | **Faturimi i honorarit të zyrës automatikisht** nga `Договор за сметководствени услуги` + kujtesa për pagesë + krahasim honorar/punë | Të dhënat ekzistojnë (accFee, договор, „Мој извештај“), por fatura mujore e zyrës nuk del vetë | S–M | ✅ Tani |
| 8 | **Nënshkrim elektronik i kualifikuar në server (remote/cloud, p.sh. KIBS SignPlus)** për е-Фактура, deklarata, kontrata | е-Фактура kërkon nënshkrim me certifikatë; me token USB nuk mund të nënshkruajë serveri për 400 firma | M–L | ✅ Tani (vendim + ofertë), ndërtimi bashkë me #1 |
| 9 | **Kontroll i rrezikut „si e sheh УЈП“** – zbulim anomalish para se t’i zbulojë УЈП (pagesa pa faturë, fatura të dyfishta, ДДВ jo në përputhje me е-Фактура, para të gatshme mbi kufi, shuma të çuditshme) | УЈП deklaron se me е-Фактура do të kryqëzojë faturat me bankat, doganën dhe aparatet fiskale në kohë reale | M | ✅ Tani (pas #1 merr vlerë të plotë) |
| 10 | **Regjistrim i kohës së punës për klient + rishikim periodik i të drejtave të përdoruesve** | Për të ditur cilat firma janë me humbje dhe kush ka qasje ku (kërkesë e ЗЗЛП dhe e ligjit për sigurinë) | M | 🕒 Pas 1–9 |

---

## 1. Законски задолжителни или наскоро задолжителни (të detyrueshme me ligj ose së shpejti)

### 1.1 е-Фактура – integrim i plotë me sistemin e УЈП ⭐ #1
- **Çka është:** Sistemi kombëtar i faturimit elektronik me „clearance“ në kohë reale: fatura dërgohet në platformën e УЈП si JSON i nënshkruar (JWS), УЈП kthen **EUID** (identifikuesi unik), statusin, kohën dhe **link për QR** që shtypet në PDF. Blerësi e pranon ose e refuzon; ka edhe storno. Në kokën e kërkesës shkon numri serik i certifikatës, **EUJP-ID** dhe ЕДБ. Ka mjedis testi (`efakturatest.ujp.gov.mk`), regjistrim (`eujptest.ujp.gov.mk/ureg`) dhe dokumentim (`efakturawiki.ujp.gov.mk`).
- **Përfitimi:** Pa këtë, nga prilli 2027 firmat ДДВ-обврзници nuk mund të faturojnë nga programi ynë. Me të: faturat dalëse dërgohen me një klik; faturat hyrëse të klientëve **shkarkohen vetë nga УЈП** (s’ka më skanim/AI për to) dhe kontabilizohen automatikisht si „Влез“. Kjo është kursimi më i madh i kohës në vitet që vijnë.
- **Baza ligjore:** Projektligji për faturim elektronik (ЕНЕР, gusht 2026): vullnetare nga 01.10.2026; e detyrueshme për ДДВ-обврзници, ndërmarrje publike dhe shoqëri shtetërore/komunale nga **01.04.2027**; për persona juridikë jo-ДДВ nga **01.07.2027**; për shfrytëzues buxhetorë dhe НБРМ nga 01.10.2027; për të gjithë nga **01.01.2028**. Konsumatorët fundorë nuk janë të detyruar. Drejtoresha e УЈП (shtator 2026): ligji të miratohet deri në fund të 2026, zbatimi i detyrueshëm fazë-pas-faze gjatë 2027. Disa burime të huaja ende thonë „01.10.2026 e detyrueshme“ – kjo duket e tejkaluar. ⚠ verifiko tekstin përfundimtar në Службен весник.
- **Në program:** pjesërisht – `Материјално › Е-Фактура` (eksport/import UBL 2.1, pa lidhje me УЈП) dhe `Фирми › 🧾 е-Фактура – подготовка` (EUJP-ID, certifikata, kontroll i ЕДБ/adresës së blerësve).
- **Përpjekja:** L (klient API, nënshkrim JWS, ruajtje e EUID/status/QR në faturë, punë në sfond për pranim/refuzim, shkarkim i faturave hyrëse, përputhje e shifrarnikëve të УЈП – njësi matëse, tarifa ДДВ, vende).
- **Varësi/kosto:** certifikatë e kualifikuar për secilën firmë (ose autorizim i zyrës si „овластено лице“ – ⚠ verifiko a e lejon ligji), regjistrim në mjedisin e testit, specifikimi JSON ndryshoi në fazën 2 të pilotit – duhet ndjekur wiki-ja.
- **Rekomandimi:** ✅ **Tani** – fillo menjëherë me mjedisin e testit (pilotet e para kanë kaluar), që në prill 2027 të jemi gati para klientëve.

### 1.2 Nënshkrim elektronik i kualifikuar në server (remote signing) ⭐ #8
- **Çka është:** Në vend të tokenit USB në kompjuterin e kontabilistit, certifikata e kualifikuar mbahet te ofruesi (HSM/cloud) dhe serveri ynë kërkon nënshkrim përmes API-t; përdoruesi konfirmon me telefon. KIBS ofron **SignPlus** (signplus.mk) dhe identifikim në distancë **OneID**; edhe Македонски Телеком është lëshues certifikatash.
- **Përfitimi:** Nënshkrim i е-Фактура, i deklaratave, i kontratave me klientët (`Договор за сметководствени услуги` sot nënshkruhet me vizatim në ekran), i PDF-ve të пакет-it për bankë – pa token, nga çdo vend.
- **Baza ligjore:** Закон за електронски документи, електронска идентификација и доверливи услуги (Сл. весник 101/2019, 275/2019), në përputhje me eIDAS. Rregullorja e doganës (2022) dhe е-Фактура kërkojnë nënshkrim/vulë të kualifikuar.
- **Në program:** jo (vetëm nënshkrim i vizatuar në `Фирми › ✍ Договор за сметководствени услуги`).
- **Përpjekja:** M (integrim me një ofrues), L nëse duhen disa ofrues.
- **Kosto:** pagesë vjetore për certifikatë për çdo firmë/person + ndoshta tarifë për API; kërko ofertë nga KIBS për zyrë me shumë klientë.
- **Rekomandimi:** ✅ **Tani vendimi dhe oferta**, ndërtimi bashkë me 1.1.

### 1.3 Ruajtja elektronike e dokumenteve (е-архива) sipas afateve ligjore
- **Çka është:** Rregull i qartë sa vite ruhet çdo lloj dokumenti (libra kontabël, fatura, lista pagash, kontrata pune), me „mbyllje“ (s’mund të fshihet para afatit), hash/vulë kohore që vërteton se dokumenti nuk është ndryshuar, dhe listë e asaj që mund të asgjësohet kur kalon afati.
- **Përfitimi:** Kur vjen inspektimi ose klienti largohet, gjithçka gjendet; s’ka rrezik fshirjeje aksidentale; arkiva prej letre mund të zvogëlohet.
- **Baza ligjore:** ЗЕДЕИДУ (2019) njeh dokumentin elektronik dhe vulën kohore; Закон за архивски материјал (2012) dhe projektligji i ri për veprimtarinë arkivore; afatet e ruajtjes në ЗТД, Закон за даночна постапка, ligji për ДДВ (zakonisht 10 vjet për librat dhe faturat – ⚠ verifiko secilin afat). Me е-Фактура faturat ruhen edhe te УЈП.
- **Në program:** pjesërisht – `Архива › 📂 Архива на документи`, `Досие на фирмата`, `Систем › Податоци и резервна копија`; nuk ka afate ruajtjeje, bllokim fshirjeje sipas afatit, as hash/vulë kohore.
- **Përpjekja:** M.
- **Rekomandimi:** 🕒 **Më vonë** (pas 1.1); por **bllokimi i fshirjes** së dokumenteve të viteve të mbyllura mund të bëhet shpejt (S).

### 1.4 М1/М2 (АВРМ) – përgatitje automatike e regjistrimit/çregjistrimit të punëtorëve
- **Çka është:** Kur futet punëtor i ri ose mbaron kontrata, programi përgatit të dhënat për М1/М2 (dhe ППР kur duhet) në formën që kërkon portali **е-Работа** i АВРМ, i kujton afatin dhe e ruan konfirmimin në dosjen e punëtorit. Me М1 punëtori futet automatikisht në ПИОМ/ФЗОМ.
- **Përfitimi:** Më pak gabime në ЕМБГ/datë/orar; afati nuk harrohet (gjobat e inspektoratit të punës janë të larta).
- **Baza ligjore:** Закон за евиденции во областа на трудот / Закон за вработување; udhëzimet e АВРМ për е-Работа (qasja përmes СЕН/eID i МИОА). Nuk u gjet API publik – dorëzimi mbetet në portal.
- **Në program:** pjesërisht – `Финансово › Плата › Матични податоци за вработени` ka fushën „М1 пријава (датум)“ dhe kontrollin në `Подготвеност за инспекција`.
- **Përpjekja:** S (listë kontrolli + PDF/fletë për futje + kujtesë). Integrim direkt: L dhe varet nga АВРМ.
- **Rekomandimi:** ✅ **Tani** në formën e thjeshtë; 🕒 API vetëm nëse АВРМ e hap.

### 1.5 Siguria e sistemit sipas ligjit të ri (Закон за безбедност на мрежни и информациски системи)
- **Çka është:** Vlerësim vjetor i rrezikut, masa teknike (2FA, kopje rezervë jashtë, regjistër incidentesh, plan rikthimi), dokumentim i tyre.
- **Baza ligjore:** Ligji për sigurinë e rrjeteve dhe sistemeve informatike (Сл. весник 135/2025, në fuqi nga 01.01.2026, sipas NIS2); aktet e para nënligjore 12.06.2026. Zyra jonë me shumë gjasë **nuk** është „entitet thelbësor/i rëndësishëm“ (madhësia), por klientët e mëdhenj mund ta kërkojnë, dhe ЗЗЛП (2020) kërkon gjithsesi masa të përshtatshme sigurie. ⚠ verifiko.
- **Në program:** pjesërisht – `Канцеларија › 🔐 ЗЗЛП`, `Систем › Дневник на активности`.
- **Rekomandimi:** ✅ **Tani** përmes pikave 3.1–3.4 (këtu vetëm dokumenti „Politika e sigurisë“, S).

---

## 2. Голема заштеда на време (kursim i madh kohe)

### 2.1 Kursi i НБРМ automatikisht ⭐ #4
- **Çka është:** Punë në sfond çdo ditë pune (p.sh. 08:30 dhe 16:00) që merr kursin e mesëm nga shërbimi i НБРМ dhe e shkruan në `fx_rates`. НБРМ ka shërbim publik pa pagesë: i vjetri SOAP `kurs.asmx` dhe i riu REST `KLServiceNOV/GetExchangeRate?StartDate=…&EndDate=…&format=json|xml`.
- **Përfitimi:** S’ka më futje me dorë; devizat, arka, diferencat kursore dhe faturat në valutë marrin gjithmonë kursin e saktë; mund të plotësohen edhe datat e kaluara.
- **Baza:** kursi i mesëm i НБРМ është ai që përdoret për kontabilitet dhe ДДВ.
- **Në program:** pjesërisht – `Шифрарник › Курсна листа (сите фирми)` (me dorë + import Excel), burim i vetëm për të gjitha llogaritjet.
- **Përpjekja:** S. **Kosto:** asnjë.
- **Rekomandimi:** ✅ **Tani**.

### 2.2 Kuti e-maili për dokumente (OCR inbox) ⭐ #5
- **Çka është:** Çdo firmë merr adresë si `firma-123@docs.wiseconsulting.com.mk` (ose një adresë e përbashkët ku firma njihet nga dërguesi/ЕДБ). Punëtori në sfond lexon postën (IMAP), i ruan bashkëngjitjet në arkivë, i klasifikon me AI (faturë hyrëse, ekstrakt banke, listë fiskale, dokument punëtori) dhe i vendos në `Пристигнато од клиенти` gati për miratim.
- **Përfitimi:** Klientët dhe furnitorët e tyre dërgojnë direkt; askush nuk shkarkon/ngarkon me dorë; asgjë nuk humbet në e-mailin personal të kontabilistit.
- **Në program:** pjesërisht – leximi me AI (`Материјално › Скенирање документ`, `Пристигнато од клиенти`, klasifikimi i inbox-it), portali i klientit; mungon marrja nga e-maili.
- **Përpjekja:** M. **Kosto:** kutia e postës (te hostingu ekzistues) + kostoja e AI për faqe (tashmë e matur në `ai_usage`).
- **Rekomandimi:** ✅ **Tani**.

### 2.3 Kalendar i afateve për të gjitha firmat + kujtesa ⭐ #6
- **Çka është:** Një kalendar i vetëm i zyrës: për çdo firmë, sipas profilit të saj (ДДВ mujor/tremujor, ka punëtorë, паушалец, NPO, ka import, ka hotel → такса…), krijohen detyrimet: МПИН deri më 10, ДДВ-04 deri më 25 pas periudhës, аконтации ДД/ДЛД deri më 15, М1/М2, kontratat që mbarojnë, certifikatat që skadojnë, годишна сметка/ДБ, ДЗС, ПДД-ГИ, lejet. Statusi merret automatikisht nga programi (p.sh. ДДВ-04 i mbyllur = ✓). Kujtesa me e-mail/portal për kolegun përgjegjës dhe për klientin (kur mungojnë dokumente). Eksport ICS për Google/Outlook.
- **Përfitimi:** Asnjë afat i humbur = asnjë gjobë dhe asnjë klient i pakënaqur; pronari sheh në një ekran kush është vonë.
- **Në program:** pjesërisht – `Канцеларија › 🤖 Автопилот` (Даноци, Затворање на период), `Фирми › 🔔 Известувања`, `Фирми › ✅ Месечно затворање`, `Завршна сметка › 📅 Што, каде и кога се поднесува` (vetëm fundviti), `Канцеларија › Задачи`. Mungon pamja kalendarike e përbashkët, afatet që varen nga profili, skadimi i certifikatave, ICS.
- **Përpjekja:** M.
- **Rekomandimi:** ✅ **Tani**.

### 2.4 Faturimi automatik i honorarit të zyrës ⭐ #7
- **Çka është:** Nga `Договор за сметководствени услуги` (shuma, ДДВ, dita e faturimit) programi krijon çdo muaj faturën e zyrës për secilin klient (në firmën e zyrës), e dërgon me e-mail dhe në portal, ndjek pagesën nga ekstrakti i zyrës dhe dërgon opomenë automatike. Opsion: shtesë automatike kur klienti ka mbi N dokumente në muaj (sipas `Мој извештај`).
- **Përfitimi:** Asnjë honorar i paharruar; pronari sheh kush nuk paguan; çmimi rritet aty ku puna është rritur.
- **Në program:** pjesërisht – `Дејности › 🔁 Периодични фактури`, `Материјално › ⏰ Неплатени фактури и опомени`, `Анализи › 🔒 Мој извештај` (honorar vs. punë), `firms.settings.accFee`. Mungon lidhja automatike kontratë → faturë periodike e zyrës.
- **Përpjekja:** S–M.
- **Rekomandimi:** ✅ **Tani**.

### 2.5 Rregulla bankare që mësojnë vetë
- **Çka është:** Kur kontabilisti lidh një rresht ekstrakti me konto/partner, programi propozon rregull („gjithmonë kur përshkrimi përmban ‘ЕВН’ → 4xx/partneri ЕВН“) dhe e zbaton herën tjetër; rregullat mund të ndahen mes firmave (p.sh. ЕВН, Телеком, УЈП, ФЗОМ janë të njëjtë për të gjithë).
- **Përfitimi:** Ekstraktet mbyllen me shumë më pak klikime.
- **Në program:** pjesërisht – `Финансово › Изводи` ka rregulla dhe përputhje automatike (`bank_rules`); mungon mësimi automatik dhe rregullat e përbashkëta të zyrës.
- **Përpjekja:** S–M. **Rekomandimi:** ✅ Tani (pas 2.1–2.4).

### 2.6 Lidhje direkte me bankat (open banking / API)
- **Çka është:** Ekstraktet vijnë vetë çdo ditë nga banka, pa shkarkim/ngarkim.
- **Baza ligjore:** Закон за платежни услуги и платни системи (Сл. весник 90/22, 64/24), transpozim i PSD2, në fuqi nga 01.01.2023 – hap rrugën për „informacion mbi llogarinë“ (AIS). Por nuk u gjet asnjë API publik i bankave maqedonase (Халк, Комерцијална, НЛБ, Стопанска); që të jemi AISP duhet licencë nga НБРМ.
- **Në program:** importi i skedarëve (MT940, camt.053, Халк, КБ) në `Финансово › Изводи`, `Банки и формати на изводи`.
- **Përpjekja:** L, varet nga bankat. **Alternativë e lirë:** dërgim automatik i ekstraktit me e-mail nga e-banking-u i klientit → kutia 2.2 (shumë banka e lejojnë).
- **Rekomandimi:** 🕒 **Më vonë** (pyet me shkrim bankat për API korporative); ✅ tani alternativa me e-mail.

### 2.7 Deklarata doganore (ЕЦД) → kontabilizim i importit dhe i ДДВ-së në import
- **Çka është:** Lexim i deklaratës doganore elektronike (XML/PDF nga špediteri) dhe krijim automatik i kalkulimit të importit (vlera doganore, dogana, ДДВ në import për ДДВ-04, shpenzime të varura).
- **Baza:** Dogana punon plotësisht pa letër (CDEPS, NCTS 5 nga janari 2025); deklarata nënshkruhet me nënshkrim të kualifikuar.
- **Në program:** pjesërisht – `Материјално › Влез` me shpenzime të varura, `Влезни калкулации`, leximi AI i dokumenteve; mungon formati i ЕЦД.
- **Përpjekja:** M. **Rekomandimi:** 🕒 Më vonë – vetëm nëse ka shumë klientë importues.

### 2.8 Të dhënat e firmave nga ЦРСМ automatikisht
- **Çka është:** Kontroll periodik i ndryshimeve te klientët dhe partnerët (menaxher, adresë, status – likuidim/falimentim, bllokim i llogarisë).
- **Baza:** ЦРСМ ofron shërbime të dhënash me pagesë; sipas një pakete jo-zyrtare, qasja bëhet me certifikatë klienti dhe kërkesë të nënshkruar, me kufi ditor. ⚠ verifiko kushtet dhe çmimin në crm.com.mk.
- **Në program:** pjesërisht – `Фирми › 📷 Нова фирма од решение` dhe partner nga „Тековна состојба“ me AI.
- **Përpjekja:** M. **Kosto:** tarifat e ЦРСМ.
- **Rekomandimi:** 🕒 Më vonë.

### 2.9 Statistika (ДЗС) – plotësim automatik i raporteve
- **Çka është:** Raportet statistikore periodike (punë, investime, tregti) që disa klientë duhet t’i dorëzojnë, të mbushura nga të dhënat e programit.
- **Në program:** jo.
- **Përpjekja:** M për çdo formular. Nuk u gjet sistem elektronik publik me format importi ⚠ verifiko në stat.gov.mk.
- **Rekomandimi:** 🕒 Më vonë, vetëm për formularët që i plotësojmë shpesh.

---

## 3. Безбедност и контрола (siguri dhe kontroll)

### 3.1 Kopje rezervë jashtë serverit + provë rikthimi ⭐ #2
- **Çka është:** Kopja e natës (baza + dokumentet) dërgohet e enkriptuar edhe në një vend tjetër (ruajtje S3 te një ofrues tjetër, ose NAS në zyrë), me versione që s’mund të fshihen (object lock) dhe me provë automatike rikthimi një herë në muaj (rikthim në bazë provë + kontroll i bilancit bruto).
- **Përfitimi:** Nëse VPS-i prishet, hakohet ose ofruesi mbyllet, zyra rikthehet brenda orësh. Sot kopja `docker/backup.sh` ruhet në `/var/backups/wise` **në të njëjtin server**.
- **Baza:** ЗЗЛП (2020) – masa teknike për disponueshmëri; ligji për sigurinë e rrjeteve (2025).
- **Në program:** pjesërisht – `Систем › Податоци и резервна копија` (statusi i kopjes së natës, kopje JSON për firmë).
- **Përpjekja:** S. **Kosto:** disa euro në muaj për hapësirë.
- **Rekomandimi:** ✅ **Tani – më e rëndësishmja nga të gjitha për rrezikun.**

### 3.2 2FA dhe mbrojtje e hyrjes ⭐ #3
- **Çka është:** Kod nga aplikacioni (TOTP – Google/Microsoft Authenticator) ose çelës/passkey për përdoruesit e zyrës (detyrueshëm për administratorët); kufizim i tentativave të login-it dhe bllokim i përkohshëm; njoftim me e-mail për hyrje nga pajisje e re. Për klientët e portalit: opsionale.
- **Përfitimi:** Një fjalëkalim i vjedhur nuk mjafton për të hyrë në librat e 400 firmave.
- **Në program:** jo – ka sesione me afat (8 orë), por pa 2FA dhe pa kufi tentativash (fail2ban mbron vetëm SSH).
- **Përpjekja:** S–M. **Rekomandimi:** ✅ **Tani**.

### 3.3 Rishikim periodik i të drejtave + gjurmë e plotë
- **Çka është:** Çdo 3 muaj programi i jep pronarit listën: kush ka qasje në cilat firma, kush s’ka hyrë prej 90 ditësh, klientë të portalit që janë larguar – me „konfirmo/hiq“. Raport i veprimeve të ndjeshme (fshirje, rihapje periudhe, eksport i madh).
- **Në program:** pjesërisht – `Систем › Корисници и улоги`, `Дневник на активности` (audit_log për çdo ndryshim), `Фирми › 🔑 Профили на клиенти`.
- **Përpjekja:** S. **Rekomandimi:** ✅ Tani (bashkë me 3.2).

### 3.4 Zbulim anomalish / „kontroll si УЈП“ ⭐ #9
- **Çka është:** Kontrolle automatike çdo natë për të gjitha firmat: fatura të dyfishta (numër/shumë/partner), pagesa pa faturë dhe fatura pa pagesë mbi 60 ditë, para të gatshme mbi kufirin ligjor, ДДВ-04 që s’përputhet me librat dhe (pas 1.1) me faturat te УЈП, marzhe negative, shitje pas orarit, punëtorë me pagë nën minimale, rritje të papritur shpenzimesh. Rezultati shkon në „Известувања“.
- **Përfitimi:** Gabimet gjenden para inspektimit; УЈП ka deklaruar se do të kryqëzojë е-Фактура me bankat, doganën dhe aparatet fiskale.
- **Në program:** pjesërisht – `Фирми › 🕵 Подготвеност за инспекција`, `⚖️ Даночен преглед`, Автопилот („Ризик од контрола“), kontrolli i dublikatave në skanim, kontrolli ДФИ.
- **Përpjekja:** M. **Rekomandimi:** ✅ Tani (kontrollet bazë), zgjerim pas 1.1.

### 3.5 Plan rikthimi pas katastrofës (DR) dhe punë offline
- **Çka është:** Dokument + procedurë e provuar: si ngrihet programi në server të ri nga kopja (skript), kush e bën, sa kohë merr; aplikacioni desktop (Electron) mund të mbajë kopje leximi të firmave kryesore kur s’ka internet.
- **Në program:** pjesërisht – deploy me Docker/skript, aplikacioni `desktop/`.
- **Përpjekja:** S (dokument + provë), M për offline.
- **Rekomandimi:** ✅ Dokumenti tani; 🕒 offline më vonë.

### 3.6 Skadimi i certifikatave dhe autorizimeve
- **Çka është:** Regjistër i certifikatave digjitale (zyra + çdo klient), autorizimeve (полномошна) në УЈП/ЦРСМ/е-Работа, me paralajmërim 30 ditë para skadimit.
- **Në program:** jo (fushat e certifikatës në `е-Фактура – подготовка` janë fillim).
- **Përpjekja:** S. **Rekomandimi:** ✅ Tani (pjesë e 2.3).

---

## 4. Клиентски услуги (shërbime për klientët)

### 4.1 Aplikacion telefoni për klientin (PWA) – foto e faturës me një prekje
- **Çka është:** Portali i klientit si aplikacion i instalueshëm në telefon (PWA): kamera → fotografi → dërgim; njoftime push („mungojnë ekstraktet e shtatorit“); shikim i borxheve/kërkesave dhe i ДДВ-së që duhet paguar.
- **Në program:** pjesërisht – `Фирми › 👥 Портал за клиенти`, dërgimi i dokumenteve nga klienti, „👁 Преглед како клиент“.
- **Përpjekja:** S–M (manifest + optimizim i kamerës + push).
- **Rekomandimi:** ✅ Tani pas Top-10.

### 4.2 Viber / WhatsApp – marrje dokumentesh dhe njoftime
- **Çka është:** Bot Viber Business ose WhatsApp Business API: klienti dërgon foto → shkon në „Пристигнато“; zyra dërgon kujtesa.
- **Në program:** pjesërisht – lidhje „wa.me“ për ndarje nga Досие/опомени (dërgim me dorë).
- **Përpjekja:** M. **Kosto:** WhatsApp/Viber Business kanë tarifa për mesazh dhe kërkojnë verifikim të biznesit; të dhënat kalojnë te Meta/Rakuten (ЗЗЛП – duhet marrëveshje dhe njoftim te klienti).
- **Rekomandimi:** 🕒 Më vonë – fillimisht 2.2 (e-mail) dhe 4.1 (PWA) zgjidhin të njëjtën nevojë pa kosto.

### 4.3 Panel KPI për klientin
- **Çka është:** Në portal, klienti sheh çdo muaj: të hyra/shpenzime/fitim, borxhe të klientëve dhe ndaj furnitorëve, ДДВ dhe pagat që duhen paguar, krahasim me vitin e kaluar; raport PDF mujor automatik me e-mail.
- **Në program:** pjesërisht – `Анализи › 📈 Табла – анализа на работењето` (për zyrën).
- **Përpjekja:** S–M. **Rekomandimi:** ✅ Tani pas Top-10 – është shërbim që klientët e paguajnë.

### 4.4 Miratime dokumentesh (workflow) nga klienti
- **Çka është:** Klienti miraton në portal: pagesat që zyra ka përgatitur (ПП30/ПП50), listën e pagave para dërgimit të МПИН, bilancin përfundimtar para dorëzimit në ЦРСМ – me gjurmë kush/kur miratoi.
- **Në program:** pjesërisht – miratimet e hyrjeve të klientit në `Пристигнато`, `Платни налози`.
- **Përpjekja:** M. **Rekomandimi:** 🕒 Më vonë.

### 4.5 Ofertë dhe kontratë online për klient të ri
- **Çka është:** Faqe publike/link: klienti i ri plotëson të dhënat, programi llogarit honorarin sipas numrit të dokumenteve/punëtorëve, gjeneron kontratën dhe ajo nënshkruhet (1.2) – firma krijohet vetë në program.
- **Në program:** pjesërisht – `Договор за сметководствени услуги`, `Основање фирми`, `Нова фирма од решение`.
- **Përpjekja:** M. **Rekomandimi:** 🕒 Më vonë.

---

## 5. Идеи за иднина (ide për të ardhmen)

| Ideja | Përshkrim i shkurtër | Përpj. | Rek. |
|---|---|---|---|
| Regjistrim kohe për klient/koleg ⭐ #10 | Timer i thjeshtë ose kohë e llogaritur nga veprimet në program (audit_log); bashkë me `Мој извештај` tregon fitimin real për klient | M | 🕒 |
| Parashikim i ДДВ-së dhe likuiditetit | Sa ДДВ/tatim do të paguajë klienti muajin tjetër, paralajmërim kur s’ka para në llogari | M | 🕒 |
| Asistent AI për pyetje ligjore me burime | Pyetje në gjuhë natyrale mbi `Закони на УЈП (синхронизирано)` dhe `Законски промени`, përgjigje me citim neni | M | 🕒 |
| Kontabilizim automatik pa kontroll për dokumentet „e sigurta“ | Kur AI dhe rregullat janë > 99 % të sigurta dhe partneri/konto është i njohur, kontabilizohet vetë; vetëm përjashtimet shkojnë te njeriu | M | 🕒 (pas 1.1) |
| eID kombëtar për hyrjen e klientëve | Login me eID/СЕН kur të ketë mënyrë integrimi për palë private | L | ❌ tani (s’ka API publik për privatët) |
| е-достава (dorëzim elektronik i rekomanduar) | ЗЕДЕИДУ e parashikon si shërbim të besuar; s’u gjet ofrues/kuti për persona juridikë | L | ❌ tani |
| Të dhëna nga aparatet fiskale online | УЈП i merr; nuk u gjet qasje për kontabilistët; vazhdojmë me leximin e raporteve | L | ❌ tani |
| Integrim direkt me е-даноци (МПИН, ДДВ-04, ДБ) | Dorëzimi mbetet në portalin e УЈП; nuk u gjet API publik për dorëzim; skedarët XML/TXT i krijojmë tashmë | L | ❌ tani – ✅ ndiq nëse УЈП e hap pas е-Фактура |

---

## 6. Çka **ekziston tashmë** (që të mos propozohet sërish)

Leximi i dokumenteve me AI (fatura, ekstrakte, kupona, raporte fiskale, dokumente punëtorësh, решение ЦРСМ, бруто биланс), importi i ekstrakteve (MT940, camt.053, Халк, КБ) me përputhje automatike, МПИН TXT/XLSX dhe „МПИН од УЈП – прифатени“, ПП30/ПП50/ПП10, ДДВ-04 me mbyllje periudhe, завршна сметка me XML për ЦРСМ, portali i klientit me miratime, Автопилот (kontrolle çdo 6 orë, mesazhe te klientët), Известувања, Месечно затворање, Подготвеност за инспекција, Даночен преглед, Законски промени + robot i ligjeve të УЈП, УФР/AML, ЗЗЛП, opomenë dhe histori dërgimesh, fatura periodike, kontrata shërbimi me nënshkrim të vizatuar, dosja/arkiva/пакет për bankë, Excel/UBL import-eksport, kopje e natës, kopje JSON për firmë, regjistër aktivitetesh dhe gabimesh, role dhe të drejta për firmë.

---

## 7. Burimet

**е-Фактура**
- Projektligji 2026–2028 (përmbledhje): https://www.loginsystems.biz/post/predlog-zakon-e-faktura-makedonija-2026-2028
- API, EUID, QR, JWS: https://www.loginsystems.biz/post/e-faktura-ujp-api-prifakanje-euid-qr
- Deklarata e drejtoreshës së УЈП (shtator 2026): https://skopje1.mk/od-2027-godina-zadolzhitelna-e-faktura-ujp-kje-dobiva-podatoci-za-sekoja-transakcija ; https://racin.mk/ekonomija/ujp-ke-gi-gleda-fakturite-vo-realno-vreme-zadolzhitelna-primena-od-2027/
- Faza e tretë e pilotit (qershor 2026): https://republika.mk/vesti/ekonomija/ujp-ja-pochnuva-tretata-faza-od-proektot-za-e-faktura/ ; https://lookuptax.com/tax-changes/north-macedonia/efaktura-third-pilot-2026
- Statusi i pilotit: https://biznisvesti.mk/ujp-pilot-fazata-na-e-faktura-se-sproveduva-uspeshno-verifikuvani-396-e-fakturi/
- Draft (Comarch): https://www.comarch.com/trade-and-services/data-management/legal-regulation-changes/north-macedonia-launches-mandatory-e-invoicing-reform/
- Zyrtare (për verifikim): efakturawiki.ujp.gov.mk, efakturatest.ujp.gov.mk, ener.gov.mk

**НБРМ**
- Udhëzimi i shërbimit web: https://www.nbrm.mk/content/Upatstvo_Web_Service.pdf ; https://www.nbrm.mk/web-servis-novo-en.nspx ; https://www.nbrm.mk/klservice/kurs.asmx
- Ligji për shërbimet e pagesës (PSD2): https://www.karanovicpartners.com/news/important-development-in-the-payment-services-legislation-in-north-macedonia/ ; https://nbrm.mk/content/Platni%20sistemi/Working%20Group%202%20-%20Open%20Banking%20Innovations.pdf
- Bankat pa API publik: https://www.openbankingtracker.com/provider/halkbank-ad-skopje/apis ; https://www.openbankingtracker.com/provider/komercijalna-banka-ad-skopje/apis

**Nënshkrimi elektronik**
- KIBS SignPlus / OneID / QTSP: https://www.kibstrust.mk/content/Dokumenti/ (rregullat SignPlus 2.0, OneID 1.0, PDS)
- ЗЕДЕИДУ (Сл. весник 101/2019): https://www.kibstrust.mk/content/Dokumenti/Електронски%20документи,%20електронска%20идентификација%20и%20доверливи%20услуги.pdf

**АВРМ М1/М2**
- https://e-rabota.av.gov.mk/Upatstvo/AVRM_Upatstvo_e_Rabota%20PPR%20M1%20M2.pdf ; https://e-rabota.av.gov.mk/Upatstvo/AVRM_Upatstvo_e_Rabota.pdf

**Dogana**
- NCTS 5: https://customs.gov.mk/en-GB/pocetna/e-carina/nkts-5.nspx ; raporti Kapitulli 29: https://www.customs.gov.mk/content/Chapter%2029%20EN.pdf

**ЦРСМ**
- Paketë jo-zyrtare (tregon qasjen me certifikatë): https://packagist.org/packages/kalimeromk/crm ; zyrtare: crm.com.mk

**Siguria**
- Ligji për sigurinë e rrjeteve (Сл. весник 135/2025): https://bdkadvokati.com/comprehensive-cybersecurity-legislation-implemented-in-north-macedonia ; https://bdkadvokati.com/bdk-advokati-seminar-on-the-new-cybersecurity-law-in-north-macedonia

**Arkiva**
- Закон за архивски материјал (2012): https://business.gazibaba.gov.mk/media/pdf/zakonska_regulativa/pravni_raboti/arhivsko_rabotenje/1-zakon-za-arhivski-materijal-95-26072012.pdf

**Afatet tatimore (МПИН deri më 10)**: https://unija.com/mk/dospeani-zakonski-obvrski-vo-maj/

**Pa burim zyrtar të gjetur (⚠):** API për dorëzim në е-даноци, ДЗС portal elektronik, е-достава për persona juridikë, qasje e kontabilistëve te të dhënat e aparateve fiskale, API të bankave maqedonase, afatet e sakta të ruajtjes elektronike – duhet pyetur institucioni.
