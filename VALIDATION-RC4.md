# 1.3.0-rc.4 validation

Windows 11 x64 / Node 24.15.0. New-install default port: 28765. Existing installations retain config.json; user installation moved explicitly from 8765 to free port 28765. The old port has no redirect or leftover Monitor listener. OpenCode and its running tasks are not restarted during the port change or Monitor update.

Update regressions simulate API 403/429, X-RateLimit-Reset, Retry-After, manual checks, process restart, API network failure, malformed success responses, official Atom parsing, foreign links, stable/RC channels, duplicate/missing checksums and modified ZIP bytes. The frontend displays a successful public-feed fallback and hides stale install actions on failure. Both unavailable sources remain a visible error.

Full tests also cover collectors, model isolation, migrations, privacy, real Windows tray lifecycle, port conflicts, installer, program/hook rollback, native desktop window startup and isolated V1 1.18.29/V2 2.0.32 plugin compatibility. Release assets include the complete test results and separate local/network validation.

Real GitHub API returned 403 with x-ratelimit-remaining=0. Same-repository releases.atom and SHA256SUMS assets returned HTTP 200 without credentials. Safe download checks continue to require trusted release checksums and the package manifest. No private database/configuration or GitHub token is packaged.
