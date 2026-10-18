# 1.3.0-rc.2 validation — 2026-10-18

Platform: Windows 11 x64, Node 24.15.0. OpenCode V1 1.18.29 and desktop-bundled V2 2.0.32. Python 3.8 is used only to execute the SSH-side projection tests locally. No model generations or real SSH host connections are performed by the suite.

The full suite contains 37 tests: previous collection/migration/privacy coverage, A→B and B→A run resets, empty timing on a new model, fresh installs excluding imported/future-dated existing history, reset/restart persistence, independent outlier thresholds, frontend escaping/rendering, version/channel selection, trusted update origin and digests, per-file manifest checks, archive traversal rejection, actual successful Windows update and actual startup-failure rollback, installer, tray lifecycle, cross-origin controls and real V1/V2 plugin loading. See test-results.txt for final counts.

The real update test preserves custom user settings and an old-only metric, creates a SQLite backup, replaces files, waits for both the new server and tray, and verifies database integrity. The rollback test substitutes a no-op test tray, verifies failed readiness, restores the original executable and program version, restarts the old server, and verifies its retained history. All these operations use isolated test directories and ports.

Chrome rendered the new interface with synthetic A/B data: the page showed only B's three current records, average 25 tok/s and 900 tokens, while the A result remained outside the current run. Card text did not overflow, and history was collapsed by default. The screenshot is a demonstration fixture, not production telemetry.

Release archives must contain no data/, seed/, personal config.json, database, browser profile or credential. The per-file update manifest is generated from the exact packaged bytes. Online updates require a matching SHA256 digest provided by GitHub for the pinned repository asset. Local updates verify the manifest and reject downgrades. No default-browser preference is changed.

Remaining scope limits: live SSH hosts and ARM64 are not certified. V2 can reuse a loaded project location without rerunning setup on every desktop reconnection. Current model detection follows newly observed assistant calls, not a model merely selected in the OpenCode UI. Concurrent sources interleaving different models start separate chronological runs. Browser App mode requires a compatible installed Chrome/Edge engine; ordinary default-browser opening remains supported.
