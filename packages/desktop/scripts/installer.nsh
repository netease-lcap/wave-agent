; CodeWave IDE — NSIS installer hooks (wired up via `build.nsis.include`).
;
; Windows has no equivalent of macOS's Info.plist URL-type declaration, so the
; `wave://` handler is registered at runtime by the app itself
; (`app.setAsDefaultProtocolClient`, see src/main/index.ts) and the installer
; writes nothing for it. The uninstall path, however, has to clean that entry
; up: leaving `HKCU\Software\Classes\wave` behind makes Windows keep showing the
; browser's "打开 CodeWave IDE？" prompt on every link click and then do nothing,
; because the command it points at is gone (spec
; docs/specs/desktop/desktop-deep-link.md 「协议注册在三端落点不同」).
;
; Electron registers the scheme per-user under HKCU together with
; `\DefaultIcon` and `\shell\open\command`, so deleting the root key takes all
; of it. No-op for a user who never launched the app after installing.

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\wave"
!macroend
