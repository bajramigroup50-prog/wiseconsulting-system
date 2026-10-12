# 🔐 Instalimi i kompjuterëve (Уреди) — vetëm kompjuterët e regjistruar hyjnë në server

Serveri WISE mund të mbyllet për të gjithë botën, përveç kompjuterëve që i keni instaluar vetë: kompjuterët e zyrës
dhe kompjuterët e klientëve (rent-a-car, markete, shumicë…), edhe kur ata nuk kanë IP statike.
Çdo kompjuter merr **certifikatën e vet** (si një çelës i padukshëm). Pa këtë certifikatë serveri nuk tregon
as faqen e hyrjes (login). Emri i përdoruesit dhe fjalëkalimi mbeten si më parë — certifikata është mbrojtje shtesë.

---

## 1. Si shtohet një kompjuter (pronari i zyrës)

1. Hyni në WISE → **Систем → 🔐 Уреди (компјутери)** (e sheh vetëm pronari i zyrës).
2. Te **„+ Нов уред“** kërkoni firmën (emri, qyteti ose ЕДБ) dhe klikoni mbi të,
   ose zgjidhni **„🏢 Канцеларија (нашата)“** për kompjuterët e zyrës.
   - Emri krijohet vetë: „АЛФА ДООЕЛ – уред 1“, „– уред 2“…
   - Nëse doni, shkruani një emër shtesë, p.sh. „каса 1“ → „АЛФА ДООЕЛ – уред 3 – каса 1“.
3. Klikoni **„🔐 Креирај уред“**.
4. Klikoni **„⬇ Преземи инсталација за овој уред“** → shkarkohet **një skedar**, p.sh.
   `WISE-Setup-ALFA-DOOEL-ured-1.exe`.
5. Kopjojeni skedarin në USB dhe çojeni te **ai kompjuter** (mos e dërgoni me e-mail / Viber).
6. Te ai kompjuter: **dy klikime mbi skedarin**. Programi instalohet vetë, certifikata vendoset vetë
   (pa fjalëkalim, pa pyetje), dhe hapet ekrani i hyrjes. Kaq.
7. Jepini klientit emrin e përdoruesit dhe fjalëkalimin si zakonisht.

> Skedari vlen **vetëm për një kompjuter**. Për kompjuterin tjetër krijoni „Нов уред“ tjetër.
> Pasi kompjuteri lidhet herën e parë me serverin, butoni i shkarkimit zhduket (instalimi u përdor).
> Nëse e humbni skedarin para instalimit, mund ta shkarkoni përsëri nga lista („⬇ Инсталација“).

**Chrome / Edge në të njëjtin kompjuter:** certifikata ruhet në Windows („Personal“ i përdoruesit), prandaj edhe
Chrome / Edge mund ta hapin faqen e WISE. Herën e parë shfletuesi pyet „cilën certifikatë të përdor“ →
zgjidhni certifikatën me emrin e uredit (lëshuar nga „WISE CONSULTING Device CA“) → OK. Programi WISE (desktop) nuk pyet kurrë, e zgjedh vetë.

**Një kompjuter i një firme klienti** mund të përdoret vetëm nga përdoruesit-klientë të asaj firme dhe nga stafi i
zyrës. Një klient i një firme tjetër merr mesazhin „Овој компјутер е наменет за друга фирма“.

## 2. Heqja e lejes (kompjuter i vjedhur, i shitur, punonjës që largohet)

Te lista → **„🚫 Одземи“** → konfirmoni. Kompjuteri e humb menjëherë hyrjen (brenda pak sekondash) dhe sheh
„Пристапот за овој компјутер е одземен“. Veprimi shënohet në „Дневник на активности“.
Për ta rikthyer: krijoni „Нов уред“ të ri për atë kompjuter dhe instalojeni përsëri.

## 3. Kompjuter i ri / Windows i riinstaluar

Certifikata është e lidhur me përdoruesin e Windows-it në atë kompjuter. Pas riinstalimit të Windows-it ose për
kompjuter të ri: „🚫 Одземи“ për të vjetrin (nëse nuk përdoret më) dhe „+ Нов уред“ për të riun.
Certifikata vlen 3 vjet; para skadimit krijoni një „Нов уред“ dhe instalojeni (instalimi i ri e zëvendëson të vjetrin).

## 4. Mënyra e mbrojtjes (në server)

| `DEVICE_CERTS` | Çfarë ndodh |
|---|---|
| `off` (fillimisht) | Si më parë: kushdo me emër/fjalëkalim. |
| `optional` | Kompjuterët pa certifikatë ende hyjnë; të hequrit / të panjohurit refuzohen. Periudha e instalimit. |
| `required` | **Vetëm** kompjuterët e instaluar. Të tjerët nuk marrin as faqen e hyrjes. |

Faqja „🔐 Уреди“ tregon mënyrën aktuale, nëse certifikata e zyrës (CA) ekziston dhe nëse instalimi bazë
(`WISE-Setup.exe`) është vendosur në server.

## 5. Probleme

- **„Овој компјутер не е овластен…“** në programin WISE → kompjuteri nuk është instaluar me skedarin e vet,
  ose leja është hequr. Krijoni „Нов уред“ dhe instalojeni.
- Regjistri i instalimit të certifikatës: `%LOCALAPPDATA%\WISE CONSULTING\device-install.log`.
- Shikoni certifikatën: Start → „Manage user certificates“ → Personal → Certificates → „<emri i uredit>“,
  lëshuar nga „WISE CONSULTING Device CA“.

---

## 6. Technical notes (coordinator / developer)

### How it works
- **CA**: `docker/device-ca.sh` (openssl, RSA 3072, 10 years) → `/opt/wise/ca/private/ca.key` (uid 1001, 0400, only the
  app container mounts it at `/run/wise-ca`) and `/opt/wise/ca/public/ca.crt` (Caddy mounts only `public/`).
  Never in git. Back up `ca.key` offline — losing it means re-enrolling every computer.
- **Device certificate**: issued in the app (`apps/web/lib/device-certs.ts`) with node crypto (RSA 2048 key) +
  node-forge (X.509 + PKCS#12, pure JS: the `node:24-slim` image has no openssl CLI). CN = device name (UTF-8),
  O = WISE CONSULTING, EKU clientAuth, 3 years, random 128-bit serial. PKCS#12 = 3DES / SHA-1 MAC (imports on every
  Windows 10/11). The CA is not inside the .p12 (importing a CA into the user Root store pops a Windows warning).
- **Per-device installer, one file**: the generic `WISE-Setup.exe` (built once on Windows from `desktop/`, see below)
  is placed on the server at `/opt/wise/download/WISE-Setup.exe` (mounted read-only into the app). The download
  route streams it with a trailer appended: `[p12][meta JSON][u32le p12 len][u32le meta len]"WISEDEV1"`
  (meta = name, p12 password, CA CN). NSIS ignores bytes after its own data (CRC covers only its declared length —
  checked: the appended 1.0.0 installer still opens its wizard). The NSIS include `desktop/installer/installer.nsh`
  (`customInstall`) runs `desktop/installer/wise-device.ps1` hidden via `nsExec`, which reads the trailer of
  `$EXEPATH` and adds the certificate to `CurrentUser\My` (.NET `X509Store`, no admin, no dialog, key not
  exportable), removing older WISE device certificates. No trailer (generic installer, auto-update) → no-op.
  Works on Linux with no Windows tooling; the installer is unsigned (signing would be invalidated by the trailer —
  if we ever sign, the trailer must move into the signature's unauthenticated attribute instead).
- **Stored bundle**: the .p12 + its password are kept sealed (AES-256-GCM, key = SHA-256 of the CA key) in
  `devices.bundle` until the device first connects (then cleared) or is revoked, so the owner can re-download.
  The password inside the installer is only obfuscation-level protection: anyone holding the file before it is
  installed can extract the certificate — that is why it is one-device, revocable, and carried on USB.
- **Electron** (`desktop/main.js`): `select-client-certificate` picks the certificate whose issuer is
  „WISE CONSULTING Device CA“ (newest) for the app's host and its subdomains, without a dialog; TLS client-cert errors
  show „Овој компјутер не е овластен…“. Installer is now one-click per-user (`nsis.oneClick: true`) and starts the app.
- **Caddy** (`docker/Caddyfile`): `import device_tls_{$DEVICE_CERTS:off}` → `client_auth` `verify_if_given`
  (optional) or `require_and_verify` (required) with `trust_pool file /etc/caddy/wise-ca/ca.crt` on DOMAIN,
  www.DOMAIN and files.DOMAIN. The fingerprint goes to the app as `X-Wise-Client-Fp`
  (`{http.request.tls.client.fingerprint}`, client-sent copies stripped). files.DOMAIN (S3) asks the app first with
  `forward_auth app:3000 /api/device-check` (revocation). ACME HTTP-01 on :80 is unaffected. An invalid
  `DEVICE_CERTS` value makes Caddy refuse to start (fail closed). The `IP_HOST` site has no client_auth; in `required`
  mode the app refuses every request there (no certificate).
- **App** (`apps/web/proxy.ts` + `lib/device-guard.ts`): optional → revoked/unknown fingerprint = 403;
  required → also no fingerprint = 403 (except `/api/health`, the container health check). 30 s cache per
  fingerprint (revocation clears it at once in the same process); „last seen“ time/IP written at most every 5 min.

### Validate the Caddyfile (on the server, before deploying)
```sh
cd /opt/wise/app
for m in off optional required; do
  docker run --rm -e DOMAIN=example.com -e ACME_EMAIL=a@example.com -e IP_HOST=localhost -e ALLOW_IPS="0.0.0.0/0 ::/0" \
    -e DEVICE_CERTS=$m -v "$PWD/docker/Caddyfile:/etc/caddy/Caddyfile:ro" -v /opt/wise/ca/public:/etc/caddy/wise-ca:ro \
    caddy:2.10-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && echo "$m OK"
done
```
(`optional` / `required` need `/opt/wise/ca/public/ca.crt` to exist.)

### Build the generic installer (once per desktop version, on a Windows PC)
```powershell
cd desktop; npm ci; npm run dist   # → desktop\dist\WISE-Setup-1.1.0.exe
```
Copy it to the server as `/opt/wise/download/WISE-Setup.exe` (`scp … wise@server:/opt/wise/download/WISE-Setup.exe`,
readable by uid 1001). Never upload a per-device installer there (the app refuses a base that already has a trailer).

### Rollout
1. Merge + deploy (migration `0023_devices` creates the `devices` table; `DEVICE_CERTS` defaults to `off` → no change).
2. On the VPS: `sudo sh /opt/wise/app/docker/device-ca.sh` → back up `/opt/wise/ca/private/ca.key` offline.
3. Build the desktop 1.1.0 installer on Windows and copy it to `/opt/wise/download/WISE-Setup.exe`
   (`sudo mkdir -p /opt/wise/download`).
4. `docker compose -f docker/compose.yml --env-file /opt/wise/.env up -d app caddy` (picks up the new mounts).
   Check „🔐 Уреди“: CA ✔, installer ✔.
5. Set `DEVICE_CERTS=optional` in `/opt/wise/.env`, validate the Caddyfile (above), redeploy (`docker/deploy.sh`).
6. Enrol: the owner's own PC first, then every office PC, then the client PCs (one installer each).
   Watch „Последно“ in the list fill in. Test one revocation on a spare device.
7. When every computer in use shows „Последно“: set `DEVICE_CERTS=required`, validate, redeploy. From a
   non-enrolled computer / phone the site must not open (TLS handshake fails), the enrolled ones work.
   Rollback = `DEVICE_CERTS=optional` (or `off`) + redeploy.
   Keep SSH access to the VPS as the break-glass path (mTLS does not affect SSH).

### Fiscal cash registers (later)
Not implemented. The desktop app reserves IPC channels in `desktop/fiscal.js` (`wise:fiscal:status`,
`wise:fiscal:printReceipt`, `wise:fiscal:dailyReport`; only `status` is registered and answers „not available“).
Adding `preload.js` (contextBridge `window.wiseFiscal`) + the driver in the main process enables it.
