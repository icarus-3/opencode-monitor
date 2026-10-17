# OpenCode Monitor

A small local dashboard for OpenCode generation speed and token usage. It reads your OpenCode database and logs in read-only mode and can also aggregate databases from SSH hosts. The dashboard is served only on `127.0.0.1`; there is no telemetry or model/API call.

This is a user-maintained version based on [icarus-3/opencode-monitor](https://github.com/icarus-3/opencode-monitor). The original MIT license is retained.

## Quick start

Requirements: Node.js 24 or newer. No `npm install` is needed.

```sh
git clone https://github.com/yanchun2530/opencode-monitor.git
cd opencode-monitor
node server.mjs
```

Open <http://127.0.0.1:8765>. On Windows, you can double-click `start.cmd` and `stop.cmd`; Node.js must be installed and available on `PATH`. The server refreshes its data every 8 seconds.

The default `config.example.json` automatically discovers common local OpenCode database and log locations. Copy it to `config.json` only when you need custom paths, model, port, or SSH sources. `config.json` and collected data are excluded from Git.

## Add SSH sources

Edit your local `config.json` and add one entry per SSH host:

```json
{
  "id": "my-server",
  "host": "user@server.example.com",
  "path": "~/.local/share/opencode/opencode.db"
}
```

For example, the complete field is:

```json
"sshDatabases": [
  { "id": "server-1", "host": "user@server1", "path": "~/.local/share/opencode/opencode.db" },
  { "id": "server-2", "host": "user@server2", "path": "~/.local/share/opencode/opencode.db" }
]
```

Use hosts already configured in your SSH config or `user@host` names. SSH authentication uses your normal OpenSSH setup; this project does not store SSH passwords or keys. Remote hosts need Python 3 and permission to read the OpenCode database. Restart the monitor after editing the configuration.

## Privacy

- The source database is opened read-only. The monitor does not modify OpenCode settings or database files.
- Local derived metrics are stored under `data/`; that directory is ignored by Git.
- SSH sources are read through your existing SSH connection. A temporary normalized snapshot is stored locally and removed after ingestion.
- Prompts, generated text, API keys, SSH credentials, and personal database files are not included in this repository.
- The listener accepts requests only from localhost.

## What it shows

- Current generation speed and the average of the latest 20 valid calls. Extreme speed outliers are excluded from these speed statistics.
- A time-series chart of recent valid speeds.
- Cumulative input and output token counts across all models and configured sources. Output includes reasoning tokens.
- An arithmetic average of valid per-call generation speeds for each configurable token-usage interval (10 million tokens by default). Speed outliers are excluded, and calls crossing an interval boundary contribute in proportion to their token share.

## Configuration

`config.example.json` is the safe default. The main fields are:

- `databases`: local database paths, or `"auto"` for discovery.
- `logDirectories`: local log folders, or `"auto"` for discovery.
- `sshDatabases`: optional SSH host/database entries.
- `pollSeconds`: refresh interval (minimum 5 seconds).
- `defaultModel`: model to display, or `"all"` to select the latest model when records exist.
- `tokenSpeedBucketSize`: total input-plus-output tokens per average-speed interval; defaults to `10000000`.

## Development

```sh
npm test
npm start
```

The project uses Node.js built-in modules only. See [LICENSE](LICENSE) for the MIT license.
