# WISE CONSULTING - imports this computer's certificate (mutual TLS) from the installer itself.
# Run hidden by the NSIS installer (installer.nsh, customInstall) as the installing user:
#   powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File wise-device.ps1 -Installer "<setup.exe>"
# The per-device installer is the generic WISE-Setup.exe + a trailer written by the server
# (apps/web/lib/device-certs.ts, deviceTrailer):
#   [p12][meta JSON utf-8][u32le p12 length][u32le meta length]["WISEDEV1"]
# meta = { v, name, password, issuer }. No trailer (a generic installer or an auto-update) -> nothing to do.
# The certificate goes to CurrentUser\My (no admin rights, no dialog), key NOT exportable. Older WISE device
# certificates of this user are removed so only the current one is offered. The CA is not imported (that would show a
# Windows security warning); the server only needs this computer's certificate.
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$StoreName = 'My'
)
$ErrorActionPreference = 'Stop'
$logDir = Join-Path $env:LOCALAPPDATA 'WISE CONSULTING'
$log = Join-Path $logDir 'device-install.log'
function Log([string]$m) {
  try {
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $m) -Encoding UTF8
  } catch { }
}

try {
  $fs = [System.IO.File]::Open($Installer, 'Open', 'Read', 'ReadWrite')
  try {
    if ($fs.Length -lt 16) { Log 'installer too small'; exit 0 }
    $tail = New-Object byte[] 16
    [void]$fs.Seek(-16, [System.IO.SeekOrigin]::End)
    [void]$fs.Read($tail, 0, 16)
    if ([System.Text.Encoding]::ASCII.GetString($tail, 8, 8) -ne 'WISEDEV1') { Log 'no device certificate in this installer'; exit 0 }
    $p12Len = [System.BitConverter]::ToUInt32($tail, 0)
    $metaLen = [System.BitConverter]::ToUInt32($tail, 4)
    if ($p12Len -le 0 -or $p12Len -gt 1MB -or $metaLen -le 0 -or $metaLen -gt 64KB -or ($p12Len + $metaLen + 16) -gt $fs.Length) { throw 'bad trailer' }
    $p12 = New-Object byte[] $p12Len
    $metaBytes = New-Object byte[] $metaLen
    [void]$fs.Seek(-(16 + $p12Len + $metaLen), [System.IO.SeekOrigin]::End)
    $n = 0; while ($n -lt $p12Len) { $r = $fs.Read($p12, $n, $p12Len - $n); if ($r -le 0) { throw 'short read' }; $n += $r }
    $n = 0; while ($n -lt $metaLen) { $r = $fs.Read($metaBytes, $n, $metaLen - $n); if ($r -le 0) { throw 'short read' }; $n += $r }
  } finally { $fs.Dispose() }

  $meta = [System.Text.Encoding]::UTF8.GetString($metaBytes) | ConvertFrom-Json
  $flags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]'UserKeySet, PersistKeySet'
  $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($p12, [string]$meta.password, $flags)
  if (-not $cert.HasPrivateKey) { throw 'certificate without private key' }

  $store = [System.Security.Cryptography.X509Certificates.X509Store]::new($StoreName, [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser)
  $store.Open('ReadWrite')
  try {
    $old = @($store.Certificates | Where-Object { $_.Issuer -like ('*CN=' + $meta.issuer + '*') -and $_.Thumbprint -ne $cert.Thumbprint })
    foreach ($o in $old) { $store.Remove($o); Log ('removed old certificate ' + $o.Thumbprint) }
    $store.Add($cert)
  } finally { $store.Close() }
  Log ('imported certificate "' + $meta.name + '" ' + $cert.Thumbprint + ' valid to ' + $cert.NotAfter.ToString('yyyy-MM-dd'))
  exit 0
} catch {
  Log ('ERROR ' + $_.Exception.Message)
  exit 1
}
