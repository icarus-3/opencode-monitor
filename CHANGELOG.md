# Changelog

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
