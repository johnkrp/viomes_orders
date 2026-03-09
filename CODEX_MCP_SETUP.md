# Codex MCP Setup

This repo is best served by three MCP servers:

- `github` for repo, issue, PR, and code-search workflows
- `browser` for validating the local Node-served UI
- `mysql` for inspecting the runtime MariaDB/MySQL database

These commands are written for this Windows environment. Use `npx.cmd` instead of `npx` because PowerShell script execution is restricted on this machine.

## 1. GitHub

Install:

```powershell
codex mcp add github --url https://api.githubcopilot.com/mcp/ --bearer-token-env-var GITHUB_TOKEN
```

Required env vars:

```powershell
$env:GITHUB_TOKEN = "YOUR_GITHUB_PAT"
```

Notes:

- No local package install is required because this uses GitHub's hosted MCP endpoint.
- Use a PAT with only the scopes you actually need.

Verify:

```powershell
codex mcp get github
codex mcp list
```

## 2. Browser

Install:

```powershell
codex mcp add browser -- npx.cmd @playwright/mcp@latest
```

Optional browser install if Chromium is missing:

```powershell
npx.cmd playwright install chromium
```

Required env vars:

- None

Notes:

- Start your app first from [`/d:/Desktop/programming/viomes/order_form/site`](/d:/Desktop/programming/viomes/order_form/site):

```powershell
cd site
npm.cmd run dev
```

- Then use the browser MCP against the local site and admin pages.

Verify:

```powershell
codex mcp get browser
codex mcp list
```

## 3. MySQL

Install:

```powershell
codex mcp add mysql `
  --env DOTENV_CONFIG_QUIET=true `
  --env MYSQL_HOST=127.0.0.1 `
  --env MYSQL_PORT=3306 `
  --env MYSQL_DATABASE=YOUR_DB `
  --env MYSQL_USER=YOUR_USER `
  --env MYSQL_PASSWORD=YOUR_PASS `
  -- npx.cmd -y @matpb/mysql-mcp-server
```

Required env vars if you prefer to set them in your shell first:

```powershell
$env:DOTENV_CONFIG_QUIET = "true"
$env:MYSQL_HOST = "127.0.0.1"
$env:MYSQL_PORT = "3306"
$env:MYSQL_DATABASE = "YOUR_DB"
$env:MYSQL_USER = "YOUR_USER"
$env:MYSQL_PASSWORD = "YOUR_PASS"
```

Notes:

- This server is read-only and fits the import, orders, and customer-stats inspection work in this repo.
- Keep `DOTENV_CONFIG_QUIET=true` in the MCP config. Without it, `dotenv` writes a banner to `stdout`, which breaks the MCP stdio handshake on this machine.
- The runtime DB shape is documented in [`/d:/Desktop/programming/viomes/order_form/README.md`](/d:/Desktop/programming/viomes/order_form/README.md).

Verify:

```powershell
codex mcp get mysql
codex mcp list
```

## Minimal Verification Flow

After adding all three:

```powershell
codex mcp list
codex mcp get github
codex mcp get browser
codex mcp get mysql
```

Expected result:

- `github`, `browser`, and `mysql` appear in `codex mcp list`
- `github` shows the hosted URL and bearer-token env var
- `browser` shows the `npx.cmd` Playwright command
- `mysql` shows the `npx.cmd` MySQL server command and masked DB env vars, including `DOTENV_CONFIG_QUIET`

## Management Commands

```powershell
codex mcp remove github
codex mcp remove browser
codex mcp remove mysql
```

```powershell
codex mcp login github
codex mcp logout github
```

## SQLite

Skip SQLite unless you still have a concrete local `.db` file you inspect regularly. This repo's active runtime path is MySQL, so adding SQLite now would add noise without much value.

## Current Status

As of this setup session:

- `github`, `browser`, and `mysql` are registered in the global Codex config at [`C:\Users\Giannis\.codex\config.toml`](C:/Users/Giannis/.codex/config.toml)
- `browser` is configured correctly, but Playwright browser binaries are not installed yet
- `browser` also depends on the Node app being enabled and running; during this session Node was intentionally disabled while DB imports were in progress
- `mysql` is configured, but live MCP queries failed with MySQL `ERROR 1045 (28000)` access denial

## MySQL Findings

The important outcome from the MySQL investigation:

- the MCP entry was intended to match the same host-level MySQL configuration used by the server-side import scripts in [`manual-reload-sales.sh`](/d:/Desktop/programming/viomes/order_form/site/scripts/manual-reload-sales.sh) and [`nightly-import.sh`](/d:/Desktop/programming/viomes/order_form/site/scripts/nightly-import.sh)
- both scripts are clearly written for the Plesk/Linux server environment, not necessarily for the local Windows machine
- direct local login attempts against `127.0.0.1` and `localhost` both failed with the same MySQL access-denied error
- that makes a local/remote DB mismatch the most likely explanation: the stored credentials may be valid on the hosted server DB but not on the current local MySQL instance

Practical implication:

- if future work needs live DB inspection from this Windows machine, update the `mysql` MCP entry to use credentials that are valid for the actual local MySQL server, or point it at the real remote DB host instead

## Security Notes

- Sensitive DB credentials appeared during prior debugging and should be treated as compromised if still active
- Those credentials should be rotated if they are still active
- Do not store raw secrets in repo docs or shell wrappers; prefer environment variables or host-level secret configuration

## Browser Notes

- The Playwright MCP package is available
- Chromium is not installed yet on this machine
- When browser work resumes, install it with:

```cmd
npx.cmd playwright install chromium
```

- When Node is enabled again, the local app should be started from [`site/package.json`](/d:/Desktop/programming/viomes/order_form/site/package.json) with:

```cmd
cd /d D:\Desktop\programming\viomes\order_form\site
set DB_CLIENT=mysql
npm.cmd run dev
```

- Expected app port: `3001`
- Health check: `http://127.0.0.1:3001/api/health`

## Sources

- GitHub remote MCP server docs: https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server
- GitHub official MCP server repo: https://github.com/github/github-mcp-server
- Playwright MCP repo: https://github.com/microsoft/playwright-mcp
- MySQL MCP package: https://www.npmjs.com/package/@matpb/mysql-mcp-server
