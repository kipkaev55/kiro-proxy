# Install

One-click cross-platform installer for **kiro-proxy**. Detects OS, checks Node, installs dependencies, writes an autostart entry, and runs a smoke test.

## One-liner install

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/bigdata2211it-web/kiro-proxy/main/install/install.sh | bash
```

### Windows (PowerShell)

```powershell
iwr -useb https://raw.githubusercontent.com/bigdata2211it-web/kiro-proxy/main/install/install.ps1 | iex
```

## Install from a local checkout

```bash
# Linux / macOS
bash install/install.sh

# Windows
powershell -ExecutionPolicy Bypass -File install\install.ps1
```

## What the installer does

1. Checks Node.js (>= 18). If missing — prints install command for the current OS and exits.
2. Checks `git` (only when cloning).
3. Clones the repo to a default directory (or reuses local checkout):
   - Linux: `${XDG_DATA_HOME:-$HOME/.local/share}/kiro-proxy`
   - macOS: `~/Library/Application Support/kiro-proxy`
   - Windows: `%LOCALAPPDATA%\kiro-proxy`
4. Runs `npm install --omit=dev`.
5. Checks the Kiro CLI database (needed for authentication). Warns if Kiro is not logged in.
6. Writes autostart:
   - Linux: `~/.config/systemd/user/kiro-proxy.service` (+ `enable --now`, optional `loginctl enable-linger`).
   - macOS: `~/Library/LaunchAgents/com.kiro-proxy.plist` (+ `launchctl load`).
   - Windows: Scheduled Task `kiro-proxy` running at logon (with automatic restart).
7. Smoke-tests `http://127.0.0.1:11436/v1/models`.
8. Prints endpoint and management commands.

## Environment overrides

| Variable | Default | Purpose |
|---|---|---|
| `KIRO_PROXY_PORT` | `11436` | Listen port |
| `KIRO_PROXY_DIR` | OS-specific (see above) | Where to install |
| `KIRO_PROXY_REPO` | `https://github.com/bigdata2211it-web/kiro-proxy.git` | Source repo (useful for forks) |
| `KIRO_PROXY_BRANCH` | `main` | Branch / tag |
| `KIRO_PROXY_NO_AUTOSTART` | `0` | Set to `1` to skip systemd/launchd/Task creation |

Example — install to a custom path, different port, no autostart:

```bash
KIRO_PROXY_DIR=/opt/kiro-proxy \
KIRO_PROXY_PORT=12000 \
KIRO_PROXY_NO_AUTOSTART=1 \
  bash install/install.sh
```

## Manage

### Linux

```bash
systemctl --user status   kiro-proxy
systemctl --user restart  kiro-proxy
systemctl --user stop     kiro-proxy
journalctl  --user -u kiro-proxy -f
```

### macOS

```bash
launchctl list | grep kiro-proxy
launchctl unload ~/Library/LaunchAgents/com.kiro-proxy.plist
launchctl load   ~/Library/LaunchAgents/com.kiro-proxy.plist
tail -f "$HOME/Library/Application Support/kiro-proxy/kiro-proxy.log"
```

### Windows

```powershell
Get-ScheduledTask   -TaskName kiro-proxy
Start-ScheduledTask -TaskName kiro-proxy
Stop-ScheduledTask  -TaskName kiro-proxy
Get-Content "$env:LOCALAPPDATA\kiro-proxy\kiro-proxy.log" -Tail 80 -Wait
```

## Uninstall

```bash
# Linux / macOS — remove autostart, keep files
bash install/uninstall.sh

# also delete install directory
bash install/uninstall.sh --purge
```

```powershell
# Windows — remove Scheduled Task, keep files
powershell -ExecutionPolicy Bypass -File install\uninstall.ps1

# also delete install directory
powershell -ExecutionPolicy Bypass -File install\uninstall.ps1 -Purge
```

## After installation

The proxy listens on `http://127.0.0.1:11436` by default and exposes an OpenAI-compatible API.

Point any OpenAI-compatible client at it:

```bash
OPENAI_BASE_URL=http://127.0.0.1:11436/v1
OPENAI_API_KEY=sk-dummy
```

See the main [README.md](../README.md) for per-client integration examples (OpenCode, Cursor, Cline, Kilo, Roo, Continue).
