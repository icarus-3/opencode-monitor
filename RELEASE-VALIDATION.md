# 1.3.0-rc.1 validation — 2026-10-18

Windows 11 x64, Node 24.15.0. Complete suite: **21 passed, 0 failed, 0 skipped**. TEST_PYTHON used Python 3.8 for remote-script protocol tests; actual SSH hosts were not connected. OpenCode binaries tested: V1 1.18.29 and desktop-bundled V2 2.0.32.

Coverage includes legacy migration backups, preservation of unique fields and seeds, restored baselines, late/out-of-order/duplicate V2 timing, V2/log canonical errors, default all, privacy projection, outlier/token retention, remote content hash backwrites, remote log metadata, Windows installation, actual tray/server startup, repeat launch, port conflict diagnostics, cross-origin/control authentication, graceful shutdown, and real V1/V2 plugin loading.

Additional local checks: the old monitor's 12,645 records remain present in the candidate database; no old keys are missing; 20 seed records and 4 baselines remain; PRAGMA integrity_check returns ok. Original install retained. Source and destination backups exist. Real desktop application launch restored Monitor. Notification-region icon was observed, its left action opened the monitor browser tab, right context-menu opening was recorded, and closing that specific browser tab left the backend alive.

Limitations: right-menu opening was observed but individual menu-item invocation was not certified by the automated suite; shutdown was exercised through the same authenticated backend control used by the menu. Persistent V2 project locations may not rerun setup on every desktop reconnect. No live SSH/network identity, ARM64 or other OpenCode versions were certified. See README for boundaries and manual recovery. Raw historical inputs missing from the original sources cannot be reconstructed.

The test package performs no model generations. Python, CLI paths and personal databases are not bundled. Runtime has no npm dependency installation step: install.ps1 validates Node, installs the files/hooks and migrates selected history.

GitHub target repository permission for the available account was READ. Local tag and release assets are prepared; no upstream tag or GitHub Release is claimed.
