# Kostoja e AI-së (💲 AI трошок)

Ky dokument shpjegon si llogaritet kostoja e leximit me AI, sa kushton zakonisht një dokument dhe si mbahet nën kontroll
(limiti mujor në program dhe limiti në konsolën e Anthropic).

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
