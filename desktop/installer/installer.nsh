; WISE CONSULTING - electron-builder NSIS include (package.json build.nsis.include).
; After the files are installed, import this computer's certificate from the installer's own trailer (per-device
; installer = generic WISE-Setup.exe + .p12 appended by the server, see wise-device.ps1). Hidden, no prompts.
; The generic installer and auto-updates carry no trailer: the script just logs and returns.
; The log is %LOCALAPPDATA%\WISE CONSULTING\device-install.log.

!macro customInstall
  InitPluginsDir
  File "/oname=$PLUGINSDIR\wise-device.ps1" "${__FILEDIR__}\wise-device.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\wise-device.ps1" -Installer "$EXEPATH"'
  Pop $0
  DetailPrint "WISE device certificate: $0"
!macroend
