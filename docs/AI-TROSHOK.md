# Kostoja e AI-së (💲 AI трошок)

Ky dokument shpjegon si llogaritet kostoja e leximit me AI, sa kushton zakonisht një dokument dhe si mbahet nën kontroll
(limiti mujor në program dhe limiti në konsolën e Anthropic).

**Rregulli i pronarit:** çdo gjë që mund të bëhet pa AI bëhet pa AI; AI vetëm kur s'ka zgjidhje tjetër.
Asnjë përdorim **automatik** (në sfond) i AI-së nuk është i ndezur si parazgjedhje – vetëm me zgjedhjen e pronarit.
Butonat që shpenzojnë kredit AI kanë distinktivin **„💲 AI“**.

## 1. Parimi: falas së pari, AI vetëm kur duhet

Për çdo lloj dokumenti që ka lexues falas, programi provon **gjithmonë së pari leximin pa AI** (PDF me tekst, Excel,
CSV, XML, Word). Rezultati pranohet kur kalojnë kontrollet e veta:

| Lloji | Kontrolli që duhet të kalojë |
|---|---|
| Ekstrakt bankar (`bank`) | gjendja fillestare + lëvizjet = gjendja përfundimtare, pa paralajmërime |
| Bilanc bruto / çelje (`ob`) | debi = kredi dhe totalet e shtypura të llogarive përputhen me rreshtat |
| Faturë hyrëse / dalëse (`purchase`, `sale`) | baza × norma = TVSH, grupet (+ TVSH) = totali, rreshtat = grupet |
| Procesverbal kontrolli (`kontrola`) | ka kokë (organi / numri / data) dhe të paktën një konstatim |

Vetëm kur kontrolli dështon dokumenti shkon te AI, dhe arsyeja ruhet te leximi (`options.aiWhy`) e shfaqet në listë:
„скенирано – PDF без текст / слика“, „не се совпаѓаат збировите“, „нејасни износи“, „нема заглавие или наоди“.
E-faturat UBL (XML) lexohen gjithmonë pa AI.

**Cache:** i njëjti skedar (i njëjti `sha256`) i të njëjtit lloj në të njëjtën firmë nuk lexohet dy herë me AI –
përdoret rezultati i mëparshëm (shënohet „од претходно читање на истата датотека“, `options.cachedFrom`).

## 2. Modelet (nga më i liri)

| Niveli | Modeli | Përdoret për |
|---|---|---|
| quick | `claude-haiku-5-5` | klasifikim i sandukut, dokumente të shkurtra identiteti (pasaportë, patentë, leje qarkullimi), leximi i parë i faturës, ndarja e PDF-ve me shumë fatura |
| default | `claude-sonnet-5-5` | ekstrakte, fatura (leximi i dytë kur shumat nuk përputhen), bilance, procesverbale, raporte fiskale, dokumente punonjësish |
| complex | `claude-opus-5-5` | **vetëm** te „🔍 Подетално читање“ (mund të çaktivizohet te 💲 AI трошок) |

Faqet bosh të PDF-së hiqen para dërgimit (faturohen si çdo faqe). PDF me më shumë faqe se limiti
(„Најмногу страници по AI-читање“, parazgjedhje 30) refuzohet me mesazh – ndajeni në pjesë.
Fotot i zvogëlon vetë API-ja në ≤ 1568 px (≈ 1 600 token për foto).

## 3. Si llogaritet kostoja

Çdo thirrje e modelit regjistrohet në tabelën `ai_usage`:

1. **para thirrjes** – shkruhet një rresht me koston e **vlerësuar** (faqe × ~2 300 token + teksti i kërkesës, dalja
   ~2 500 token). Kështu edhe punët paralele dhe një ndërprerje gjatë thirrjes llogariten kundrejt limitit;
2. **pas thirrjes** – rreshti merr tokenët e vërtetë dhe koston e vërtetë (0 kur ofruesi e refuzoi thirrjen).

Formula (çmimet në USD për 1 milion token, nga tabela e worker-it `apps/worker/src/ai/client.ts`, `AI_PRICES`):

```
kosto = (input × Çmim_input + output × Çmim_output + cache_read × Çmim_cr + cache_write × Çmim_cw) / 1 000 000
```

| Modeli | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| claude-haiku-5-5 | 0.10 | 0.50 | 0.01 | 0.125 |
| claude-sonnet-5-5 | 2.00 | 10.00 | 0.20 | 2.50 |
| claude-opus-5-5 | 4.00 | 20.00 | 0.20 | 5.00 |

## 4. Kosto tipike për dokument (vlerësim me çmimet e mësipërme)

| Dokumenti | Modeli | ≈ USD |
|---|---|---|
| Faturë 1 faqe, shumat përputhen | Haiku | 0.001 |
| Faturë 1 faqe, leximi i dytë (Haiku + Sonnet) | Haiku + Sonnet | 0.024 |
| Ekstrakt bankar 3 faqe (skanuar) | Sonnet | 0.057 |
| Bilanc bruto 5 faqe | Sonnet | 0.126 |
| Bilanc bruto 5 faqe, „🔍 детално“ | Opus | 0.252 |
| Procesverbal kontrolli 4 faqe | Sonnet | 0.051 |
| Raport fiskal (1 foto) | Sonnet | 0.021 |
| Kupon / bllok (1 foto) | Sonnet | 0.016 |
| Dokument punonjësi 2 faqe | Sonnet | 0.022 |
| Klasifikim (1 faqe) | Haiku | 0.0005 |
| Çdo dokument i lexuar pa AI / nga cache | – | 0 |

Shembull: 100 firma × (20 fatura + 2 ekstrakte) në muaj, **të gjitha të skanuara**: ≈ 2 000 × 0.008 (70 % mjafton
Haiku) + 200 × 0.057 ≈ **28 USD/muaj**. Me PDF me tekst (e-banking, fatura nga programet) shumica lexohet falas.
Shifrat e vërteta, sipas muajit / firmës / llojit / modelit, me mesataren për dokument dhe projeksionin e muajit,
janë te **Систем › 💲 AI трошок** (vetëm për pronarin e zyrës).

## 5. Limiti mujor në program

Te **Систем › 💲 AI трошок** pronari vendos:

- **„Месечен лимит за AI (USD)“** – parazgjedhje 50 USD; bosh = pa limit;
- **limit për firmë** (opsional) – vetëm ajo firmë ndalet kur e arrin;
- faqet maksimale për lexim dhe rregullin për Opus.

Në **80 %** pronari sheh distinktivin „💲 AI 82%“ në shiritin e sipërm (njoftohet një herë në muaj për çdo nivel).
Në **100 %** AI-ja **pauzohet** deri në fund të muajit: ekstraktet, bilancet, faturat dhe procesverbalet me tekst
(PDF, Excel, CSV, XML, Word) vazhdojnë të lexohen pa AI; dokumentet e skanuara marrin mesazhin
„Месечниот лимит за AI е достигнат …“. Pronari mund ta ngrejë limitin në çdo kohë – leximi me AI vazhdon menjëherë.

## 6. Limiti në konsolën e Anthropic (mbrojtja e dytë)

Limiti i programit nuk e zëvendëson limitin te ofruesi. Vendoseni edhe atje:

1. Hyni në <https://console.anthropic.com> me llogarinë e zyrës.
2. **Settings → Limits** (ose **Billing → Spend limits**): vendosni **Monthly spend limit**, p.sh. pak mbi limitin e
   programit (60 USD kur programi ka 50).
3. Te **Billing** çaktivizoni **auto-reload** të kredisë, ose vendosni shumë të vogël rimbushjeje.
4. Te **Settings → Notifications** aktivizoni njoftimet me email për shpenzimet.

Kur kredia mbaron ose çelësi refuzohet, programi kalon automatikisht te lexuesit falas dhe tregon mesazhin përkatës
(Систем › AI читање).

## 7. Inventari i të gjitha thirrjeve AI

Të gjitha thirrjet kalojnë nga `readContent` / `askText` (apps/worker/src/ai): limiti mujor, regjistrimi para/pas,
Opus vetëm te „🔍“. Kolona „Nisja“: **klik** = përdoruesi e nis vetë; **auto** = në sfond pa klik.

| Ku (lloji / puna) | Nisja | Modeli | ≈ USD / dok. | Alternativa falas |
|---|---|---|---|---|
| Fatura hyrëse / dalëse `purchase` / `sale` (Скенирај, Масовно, sanduku) | klik (ngarkim) | Haiku, pastaj Sonnet nëse shumat s'përputhen | 0.001–0.024 | ✅ PDF me tekst (pranohet kur baza×norma=TVSH, grupet=totali), UBL XML – falas së pari |
| Ndarja e PDF-së me shumë fatura (`:split`) | brenda leximit të faturës, vetëm kur leximi falas dështon | Haiku | 0.002–0.01 | ✅ fatura me tekst që përputhet nuk ndahet fare |
| Ekstrakt bankar `bank` | klik (ngarkim) | Sonnet | 0.057 (3 faqe) | ✅ PDF me tekst që pajtohet, XML / CSV / MT940 / KB – falas së pari |
| Bilanc bruto / çelje `ob` | klik | Sonnet (Opus vetëm „🔍“) | 0.126 (5 faqe) | ✅ PDF me tekst / CSV (debi = kredi); lexuesi i bilancit 39-faqësh – agjenti tjetër |
| Procesverbal kontrolli `kontrola` | klik | Sonnet (Opus vetëm „🔍“) | 0.051 | ✅ PDF me tekst / Word / TXT (kokë + ≥ 1 konstatim) |
| Klasifikim i sandukut `classify` („🤖 Автоматски 💲 AI“) | klik | Haiku | 0.0005 | ✅ i ri: PDF / XML / Word / TXT me tekst sipas fjalëve të titullit / ЕДБ e shitësit; AI vetëm për skanime |
| Kontimi i rreshtave bankarë `bankcls` („🤖 Предложи со AI 💲 AI“) | klik, vetëm pas rregullave + konteve të mësuara (`autoMatch`) | Sonnet | 0.02–0.10 | ✅ rregullat dhe kontet e mësuara janë hapi i parë; AI vetëm për mbetjet |
| Kupona / blloqe `blg` | klik | Haiku (PDF) / Sonnet (foto) | 0.001–0.016 | ⏳ lexues falas – agjenti tjetër |
| Raporte fiskale `fisk` | klik | Sonnet (Opus vetëm „🔍“) | 0.021 | ⏳ lexues falas – agjenti tjetër |
| МПИН `mpin.read` (МПИН, sanduku) | klik (ngarkim) | Sonnet | 0.02 | ⏳ lexues falas – agjenti tjetër |
| Vendim / ekstrakt ЦРМ `ai.read-firm-resh` (Нова фирма од решение, Инспекции – шифри) dhe `tk` | klik | Sonnet | 0.02–0.04 | ⏳ lexues falas – agjenti tjetër |
| Dokumente punonjësish `emp` | klik | Sonnet | 0.022 | ❌ s'ka (dokumente të lira, shpesh skanime) |
| Dokumente importi `imp`, kthime / miratime `scr` | klik | Sonnet | 0.02–0.05 | ❌ s'ka ende (kandidat: UBL / PDF me tekst) |
| Kartela e partnerit `rec` (усогласување) | klik | Sonnet | 0.03–0.08 | ❌ s'ka ende (kandidat: PDF me tekst) |
| Llogaria vjetore `zm` (БС / БУ) | klik | Sonnet | 0.04 | ❌ s'ka ende (kandidat: XML / PDF me tekst) |
| Leje qarkullimi `vreg`, pasaportë / LK `rcdoc`, patentë `rclic` | klik | Haiku | 0.001–0.003 | ❌ s'ka (foto) |
| Normativ `bom` („🤖 Предложи“) | klik | Sonnet | 0.01–0.03 | ❌ s'ka (sugjerim) |
| Krahasim modelesh `cmp` | klik | Haiku + Sonnet | 0.025 | – (vegël testimi) |
| Robot për ligjet `law.robot` | **auto** (çdo ditë 06:52; kontrolli i parë në ballinë) + klik | Sonnet | 0.01–0.05 për burim me lidhje të reja | ✅ **parazgjedhje pa AI**: lidhjet e reja ruhen „⚠ да се потврди“. AI vetëm me „🤖 Провери со AI 💲 AI“ ose kur pronari ndez „Дневниот робот за закони користи AI автоматски“ (💲 AI трошок, `aiBudget.autoLawAi`, fikur si parazgjedhje) |
| Pyetje për ligjet `law.ask` („🤖 Прашај 💲 AI“) | klik | Sonnet | 0.01–0.03 | ❌ s'ka (përgjigje e lirë) |
| Autopilot, fatura periodike, mail-e, kujtesa | auto | – | 0 | nuk përdorin AI |

Asnjë punë tjetër në sfond (cron) nuk thërret AI. Kur limiti mujor arrihet, rreshtat me ✅ vazhdojnë pa AI; roboti
ruan lidhjet pa përshkrim.

# AI-трошок – што се чита без AI

Каде програмата може да прочита документ од неговиот текст (електронски PDF со текстуален слој, XML, CSV, TXT,
.docx), го чита **без AI** (модел `noai`, без трошок) и го означува „прочитано без AI – проверете“. AI се повикува само
за скенови / фотографии или кога бесплатното читање не ги најде задолжителните полиња.

## Нова фирма од решение („📷 Нова фирма од решение“)

Порано: секогаш AI (Sonnet, ~$0.015–0.02 по документ).

Сега (`apps/worker/src/jobs/firm-resh.ts` → `apps/worker/src/ai/firm-resh-free.ts` → `packages/core/src/noai/firm-resh.ts`):

- **Електронски документи од ЦРСМ и УЈП се читаат бесплатно**: „Решение за упис / регистрација“, „Тековна состојба“,
  „Историјат“ (ЦРСМ) и „Решение / Потврда за регистрација за ДДВ“ (УЈП) – PDF со текст (или .txt).
- Се читаат: назив (целосен и кратко име), правна форма, ЕМБС, ЕДБ (без „МК“), седиште (улица, број, место, општина),
  приоритетна дејност (НКД шифра + назив) и другите шифри, датум на основање / упис, управител / застапник, основачи /
  сопственици со удел, основна главнина, жиро сметка и банка, ДДВ обврзник + датум од, е-пошта, телефон.
- Задолжително за бесплатен резултат: назив + ЕМБС или ЕДБ (за ДДВ документ: ЕДБ и датумот од). Ако нешто фали → AI
  (ако е достапно); ако AI е исклучено / не успее, се прикажува делумно прочитаното со список што недостасува.
- ЕМБС (7 цифри) и ЕДБ (13 цифри) се проверуваат само по формат – алгоритмите за контролна цифра не се официјално
  објавени, па број со погрешна контролна цифра не се одбива (корисникот го проверува прочитаното).
- Неколку датотеки заедно (на пр. тековна состојба + ДДВ потврда) се спојуваат: празните полиња се пополнуваат од
  следниот документ.
- Скен / фотографија (нема текст) → AI како порано.

Тестови: `packages/core/src/noai/firm-resh.test.ts` (синтетички текстови во `firm-resh.fixtures.ts`, без вистински
податоци), `apps/worker/src/jobs/firm-resh.test.ts`.
## 8. Lexues falas të rinj: МПИН, raporte fiskale, kupona fiskalë

Këto tre lloje tani lexohen **së pari pa AI** (zëvendësojnë rreshtat ⏳ për `mpin.read`, `fisk` dhe `blg` në tabelën
e mësipërme). Rezultati ka **të njëjtën formë** si leximi me AI, shënohet `model = noai` dhe
**„прочитано без AI – проверете“**, dhe pranohet **vetëm kur kalojnë kontrollet**; përndryshe lexon AI dhe arsyeja
ruhet (`noaiWhy` te rezultati i `fisk` / `blg`, në log te `mpin.read`). Fotot dhe PDF-të e skanuara shkojnë gjithmonë te AI.

| Dokumenti | Burimi falas | Çfarë lexohet | Kontrollet (të gjitha duhet të kalojnë) |
|---|---|---|---|
| МПИН „Декларација за прием“ (`mpin.read`, МПИН од УЈП) | PDF me tekst nga e-Персонален данок; eksport tekst (.txt) | ЕДБ, emri, periudha, statusi, nr. / data e paraqitjes, nr. i të siguruarve, tabela (Бруто основица / Стапка / Месечен износ × ПИО, здравство, 0,5 %, вработување, стаж, персонален данок), totali, afati, folio | ЕДБ 13 shifra, periudha, bruto / ПИО / здравство > 0; **totali = shuma e kolonave** (± 1) dhe/ose **çdo kolonë = baza × norma e shtypur** (± 1) – të paktën njëra duhet të jetë e shtypur; neto = bruto − kontribute − tatim > 0 |
| Raport fiskal periodik / Z ditore (`fisk`, fiskPer) | PDF me tekst ose eksport tekst nga arka | ОД–ДО (data dhe Z), ЕДБ, aparati, ПРОМЕТ А/Б/В/Г, ДДВ për grup, ВКУПЕН ПРОМЕТ, готовина / картичка, nr. i kuponave, storno; çdo ditë më vete kur ka disa „ДНЕВЕН ФИНАНСИСКИ ИЗВЕШТАЈ“ | Σ grupet = ВКУПЕН ПРОМЕТ (± 0,05); ДДВ X = qarkullimi × r / (100 + r) (± 1, më shumë për shumë kuponë); Σ ДДВ = ДДВ ИЗНОС; pagesat = totali (± 1); data / periudha. Blloku „ПРОМЕТ ОД МАКЕДОНСКИ ПР.“ nuk numërohet, „СТОРНИ СМЕТКИ“ shkon vetëm te storno |
| Kupon fiskal (`blg`, Благајна) | vetëm e-kupon / PDF me tekst | shitësi, ЕДБ / ДДВ број, data dhe ora, nr. i kuponit, artikujt (sasia × çmimi = vlera, grupi), ДДВ për grup, totali, pagesa (кусур), kategoria (karburant → litra) | totali > 0, data, ЕДБ; Σ artikujt (ose qarkullimi i shtypur për grup) = totali (± 0,02); ДДВ për grup = qarkullimi × r / (100 + r); paguar − kusur = totali. Kupon me попуст / rabat → AI |

**Grupet e TVSH-së** (verifikuar me `FISK_G0` dhe me rregullat e printerëve fiskalë): **А = 18 %, Б = 5 %,
В = 0 % (ослободено), Г = 10 %** – jo 18/5/10/0 sipas rendit të shkronjave. Norma e shtypur në raport / kupon
(„ДДВ Г 10.00%“) ka përparësi.

Kodi: `packages/core/src/noai/mpin.ts`, `fiscal-report.ts`, `receipt.ts` (+ `doc-text.ts`: shumat me saktësisht 2
decimale, kështu „1.234,56“ / „1,234.56“ / „1 234.56“ nuk janë kurrë të dykuptimta); worker
`apps/worker/src/ai/free-docs.ts` (përdoret nga `mpin.read`, `readResultKind` për `fisk` / `blg` dhe nga `freeRead`
kur AI nuk është në dispozicion). Testet me dokumente sintetike: `packages/core/src/noai/free-docs.test.ts`,
`apps/worker/src/ai/free-docs.test.ts` (PDF me tekst cirilik të gjeneruar në test).
