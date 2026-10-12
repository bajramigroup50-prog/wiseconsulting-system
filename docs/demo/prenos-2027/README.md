# Mbyllja e vitit 2026 dhe bartja e saldove në 2027 (demo)

Hapni **`index.html`** (galeria me 21 foto dhe videon) ose shikoni direkt **`prenos-2027.mp4`** (~2 minuta).
Të dhënat janë shembull: firma **„ДЕМО ПРОИЗВОДСТВО ДООЕЛ“**, viti 2026 (gjendje fillestare, 7 partnerë, fatura
dalëse dhe hyrëse – disa të paguara, disa të hapura –, ekstrakte bankare, arkë, pagat e 2 punonjësve për nëntor dhe
dhjetor, një makinë me amortizim, kredi nga banka, TVSH mujore). Fitimi para tatimit 81.171,00 den., tatimi 8.117,00.

## Hapat që ndjek kontabilisti

| # | Ekrani | Çfarë bëni / çfarë shihni |
|---|---|---|
| 1–3 | Најава → Година → Фирми | Hyni me përdoruesin tuaj, zgjidhni vitin **2026**, pastaj firmën. |
| 4 | Faqja kryesore e firmës | Lart shihet firma dhe viti (2026). |
| 5 | Финансово › Завршна сметка – по фази | Pasqyra e fazave: „Годината не е затворена“, kontrolli është i pastër. |
| 6 | „3. Затворање“ (/mbyllja) | Kontrollet para mbylljes (bruto bilanci i barabartë, pa gjetje, amortizimi), rezultati, tatimi dhe fitimi neto → 951. |
| 7 | Butoni **„Затвори ја годината 2026“** | Programi pyet për konfirmim (tatimi dhe neto). Shtypni **OK**. |
| 8 | Rezultati në ekran | Viti u mbyll (urdhri 999 më 31.12.2026) **dhe** saldot u bartën automatikisht në „Почетна состојба 2027“ më 01.01.2027 (23 rreshta, debi = kredi) – mesazhi del në faqe, me lidhjen „Пренос на салда →“. Butonat tani janë „Пресметај повторно“ (rillogarit) dhe „Поништи затворање“ (anulo). |
| 9 | **„Пренос на салда“** (/prenos), filtri „Непренесени и разлики“ | Tregon vetëm mungesat/dallimet e vërteta – këtu: „нема непренесени салда ни разлики“. |
| 10 | „☐ Прикажи ги и непренесените по правило“ | Rreshtat që sipas rregullit NUK barten, me shenjë gri „— не се пренесува“: klasat 4/7/8 (по закон), kontot statistikore 994/999 – baza e TVSH-së (статистичка) dhe saldot zero (нулто салдо). Poshtë: cilësimi i prefikseve të kontove statistikore (994, 999). |
| 11 | Filtri „Пренесени“ | Çdo konto analitike dhe **çdo partner veç e veç** (1200 për çdo blerës, 2200 për çdo furnizues, 2620 banka): saldo 31.12.2026 = fillestare 01.01.2027, „✓ пренесено“. 951 → 950. |
| 12 | Filtri „Сите“ | E gjithë evidenca e bartjes. |
| 13 | Kontrolli i totaleve | „Вкупно затворање = Вкупно почетна“, debi = kredi, aktiva = pasiva. |
| 14 | Butonat **PDF / Excel** | Printoni ose eksportoni evidencën (skedari `prenos-2026-2027.xlsx` është ky eksport). |
| 15 | Ndërrimi i vitit lart djathtas → 2027 | Programi pyet „Да се премине во година 2027?“ – shtypni OK. Shfaqet shiriti i verdhë „Работите во 2027“. |
| 16 | **Почетна состојба 2027** | Saldot e bartura, konto pas konto dhe partner pas partneri. |
| 17–18 | **Налози 2027** | Urdhri 0 „Почетна состојба 2027“ (01.01.2027) është i pari; „Отвори“ tregon të 25 rreshtat. |
| 19 | **Бруто биланс 2027** | Kolonat „Поч. сост.“ = saldot e 31.12.2026; qarkullimi i 2027 shkon në kolonat „од тек. година“. |
| 20–21 | **Картица 1200 → МАРКЕТ ПЛУС** | Kartela e blerësit në 2027 fillon me saldon e bartur 334.760,00, pastaj fatura e re e 15.01.2027. |

## Mirë të dihet

- Mbyllja dhe bartja bëhen me **një klik**; nëse më vonë ndryshoni diçka në 2026, shtypni „Пресметај повторно“ ose
  „↻ Пренеси повторно“ – urdhri i 2027 **zëvendësohet, nuk dyfishohet**.
- Pas dorëzimit të llogarisë vjetore: „Заклучи ја годината 2026“ (dokumentet e 2026 nuk ndryshojnë më).
- Kontot statistikore të bazës së TVSH-së (994…, 999…) janë shifra të periudhës, jo saldo – nuk barten. Lista e
  prefikseve ndryshohet poshtë në „Пренос на салда“ (regjistrohet në ditarin e aktiviteteve), pastaj „Пренеси повторно“.
- Butoni PDF i „Пренос на салда“ krijon PDF-në në server dhe e hap në një dritare të re.

## Si u krijua (për teknikët)

- Të dhënat: `apps/web/test/demo/prenos-seed.test.ts` (veprimet e serverit / shërbimet e programit, jo SQL).
- Kalimi në shfletues: `apps/web/e2e/prenos-demo.spec.ts` (`E2E_DEMO_OUT`, `E2E_DEMO_FRAMES`), video:
  `apps/web/e2e/demo-video.mjs` (Chrome MediaRecorder → MP4, pa ffmpeg).
- Dritaret e konfirmimit të shfletuesit (confirm/alert) nuk fotografohen dot; në foto/video teksti i tyre i saktë
  shfaqet në një kuti të njëjtë.
