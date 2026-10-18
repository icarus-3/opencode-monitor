# Changelog

## 1.3.0-rc.3 — 2026-10-18

- Fix desktop reopening against a persistent OpenCode backend with a user-session Windows window event bridge owned by the plugin host. No process polling, scheduled tasks or login startup. Match approved executable paths and deduplicate desktop process identities; respect explicit Monitor quit until the next desktop process launch.
- Run the bridge from a content-addressed copy so updates can replace binaries. Stop with its plugin host or hook removal; retain startup diagnostics.
- Back up and refresh owned generated startup plugins during updates, preserve other installations and restore hooks on rollback.
- Add isolated window restart/quit, duplicate bridge, approved-path, parent-lifetime and plugin-update regressions. Preserve model isolation, configuration and history.

## 1.3.0-rc.2 — 2026-10-18

- Fresh measurement epochs exclude auto-discovered/imported history from the homepage without deleting history. Exact model switches start a new run, including switches back to a previously used model.
- Current-model speed, 20-sample mean, curve, tokens, interval progress and measurement records share the same run. Missing timing never falls back to the previous model. Manual reset preserves the archive.
- Add compact current records, expandable performance details and model-filtered historical details. Fix long token totals overflowing cards.
- Keep the system default browser (including Chrome) for normal opening. Add an optional Chrome/Edge App window entry to the tray without changing browser defaults.
- Add GitHub update detection, visible update prompts and one-click apply/restart, plus an offline local update package. Verify GitHub asset SHA256 and per-file manifest; reject archive traversal and personal config/data entries. Back up SQLite and replaced files; attempt program rollback on failure.

## 1.3.0-rc.1 — 2026-10-18

- Restore legacy benchmark import, frozen baselines and explicit history migration. Back up SQLite consistently before upgrades/imports; archive previous derived records and preserve legacy-only fields and frozen seed metrics.
- Separate privacy-projected source telemetry (`telemetry_v1`) from current metrics (`records`) and immutable metric versions (`record_versions_v1`). Attach source, observation time, extractor version and confidence.
- Recompute V2 messages when timing arrives behind the source watermark; retain SSH metadata snapshots for late recomputation. Rescan changed remote projections; hash projected content instead of count/max watermarks.
- Canonicalize V2/log errors for summaries while retaining both raw observations. Honor `defaultModel=all`. Report insufficient evidence when benchmarks or samples are missing.
- Add optional SSH log projection for stream starts, errors and compaction. Fail log collection independently of database collection. Preserve message/tool content privacy.
- Add paginated history/telemetry/version and diagnostic APIs, plus consistent SQLite snapshot JSONL export.
- Add native Windows Forms tray application using Windows' .NET Framework and Node 24, with hidden startup, single-instance control, open/status/exit menu and authenticated graceful shutdown.
- Add direct OpenCode V1/V2 global plugins using server/setup lifecycle hooks. Timing is forwarded from the plugin; Monitor no longer starts an OpenCode service to obtain events by default.
- Preserve the compact frontend. Add migration, timing, privacy, SSH protocol, installer, real Windows lifecycle and actual V1/V2 compatibility regressions.

This is a release candidate. Live SSH hosts, Windows ARM64 and additional OpenCode versions are not certified by the local tests.
