# 1.3.0-rc.3 validation

Windows 11 x64, Node 24.15.0. Full regression: 39 passed, 0 failed, 0 skipped.

The added native window test uses its own compiled OpenCode.exe fixture and isolated port 18765. It verifies an unapproved path is ignored; an approved desktop process starts Monitor; explicit quit is respected despite repeated window shows; a new desktop process restarts Monitor with the same persistent plugin host; duplicate event bridges exit; bridge exits with its parent. No real OpenCode application is stopped by the automated suite.

Actual OpenCode V1 1.18.29 and V2 2.0.32 plugin compatibility is tested with isolated config/data/cache and service instances. Existing collection, model isolation, migrations, privacy, updater/rollback, port conflicts, tray lifecycle and UI regressions pass. The updater test also checks backup and replacement of the owned global startup hook. Separate hook tests verify foreign installations are untouched and rollback restores previous bytes.

Production desktop uses Windows SetWinEventHook (out of context), not process polling. Default executable: LOCALAPPDATA/Programs/@opencodedesktop/OpenCode.exe. Custom paths require desktopExecutables. A newly launched desktop process triggers startup; re-showing the same process after explicit Monitor quit does not. Bridges are tied to an OpenCode plugin host and stop when that host exits. Monitor exit stops the tray and collection server; the startup bridge remains available until its host exits or uninstall-hooks.ps1 runs.

Local deployment and real desktop reopening evidence are delivered separately with the release, after installation validation. Live SSH, ARM64, WSL and other OpenCode versions remain uncertified.
