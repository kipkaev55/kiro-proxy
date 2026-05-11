# kiro-proxy

OpenAI-compatible local proxy for **Kiro CLI** (Amazon CodeWhisperer / Amazon Q) models.

Expose the free models available through your Kiro login — **Claude Opus 4.7, Sonnet 4.6, Haiku 4.5, DeepSeek, Qwen, GLM, Minimax** — as a standard OpenAI API, so any OpenAI-compatible client can use them: **OpenCode, Cursor, Cline, Kilo Code, Roo Code, Continue**, or your own scripts.

> Works by reading the OAuth access token that Kiro CLI stores locally after login, and translating between OpenAI chat format and Kiro's internal `AmazonCodeWhispererStreamingService.GenerateAssistantResponse` protocol.

## Quick install (OpenAI-compatible)

One-liner, no git clone needed.

**Linux / macOS**

```bash
curl -fsSL https://raw.githubusercontent.com/bigdata2211it-web/kiro-proxy/main/install/install.sh | bash
```

**Windows (PowerShell)**

```powershell
iwr -useb https://raw.githubusercontent.com/bigdata2211it-web/kiro-proxy/main/install/install.ps1 | iex
```

The installer:
- checks Node 18+ (prints install hint if missing),
- clones the repo to a sensible OS-specific location,
- runs `npm install --omit=dev`,
- registers autostart (systemd user unit on Linux, LaunchAgent on macOS, Scheduled Task on Windows),
- smoke-tests `http://127.0.0.1:11436`.

Details, environment overrides, uninstall: see [install/README.md](install/README.md).

---

## Features

- ✅ `/v1/chat/completions` with **real streaming** (SSE) and non-streaming
- ✅ `/v1/models` — OpenAI-style model list
- ✅ **Tool calling** / function calling, full round-trip
- ✅ System prompts, multi-turn history
- ✅ Model name aliases (`sonnet` → `claude-sonnet-4.6`, `opus` → `claude-opus-4.7`, etc.)
- ✅ Bearer auth read directly from Kiro's local SQLite DB — no re-login, no extra setup

## Available models

| Model | Context | Rate |
|---|---|---|
| `auto` | 1M | 1.0x |
| `claude-opus-4.7` | 1M | 2.2x |
| `claude-opus-4.6` | 1M | 2.2x |
| `claude-sonnet-4.6` | 1M | 1.3x |
| `claude-opus-4.5` | 200K | 2.2x |
| `claude-sonnet-4.5` | 200K | 1.3x |
| `claude-sonnet-4` | 200K | 1.3x |
| `claude-haiku-4.5` | 200K | 0.4x |
| `deepseek-3.2` | 164K | 0.25x |
| `minimax-m2.5` | 196K | 0.25x |
| `qwen3-coder-next` | 256K | 0.05x |
| `glm-5` | 200K | 0.5x |

*Rate = credit multiplier in the Kiro subscription.*

## Requirements

- **Node.js 18+**
- **Kiro CLI** installed and logged in (`kiro-cli login` once). Get it from [kiro.dev](https://kiro.dev).
- **Linux, macOS, Windows** — all supported. Kiro SQLite path is auto-detected:
  - Linux: `$XDG_DATA_HOME/kiro-cli/data.sqlite3` or `~/.local/share/kiro-cli/data.sqlite3`
  - macOS: `~/.local/share/kiro-cli/data.sqlite3` (Kiro CLI uses XDG layout)
  - Windows: `%APPDATA%\kiro-cli\data.sqlite3`
  - Override with `KIRO_DB_PATH=/custom/path/data.sqlite3`

## Install

```bash
git clone https://github.com/bigdata2211it-web/kiro-proxy.git
cd kiro-proxy
npm install
```

## Run

### Linux / macOS

```bash
./start.sh
# or
node index.js
```

### Windows

```powershell
# PowerShell
.\start.ps1
```

```cmd
:: cmd.exe
start.cmd
```

Listens on `http://127.0.0.1:11436`. Override port via `KIRO_PROXY_PORT`.

### systemd (Linux, autostart on login)

Create `~/.config/systemd/user/kiro-proxy.service`:

```ini
[Unit]
Description=Kiro → OpenAI Proxy
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /path/to/kiro-proxy/index.js
Restart=on-failure
RestartSec=5
Environment=KIRO_PROXY_PORT=11436

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now kiro-proxy
```

### Token refresh

Kiro access tokens expire roughly every hour, but any `kiro-cli` call refreshes them automatically. A simple cron keeps the token fresh:

```cron
*/45 * * * * /path/to/kiro-cli chat --no-interactive "ping" >/dev/null 2>&1
```

## Use

### OpenCode

In `~/.config/opencode/opencode.json`:

```json
{
  "provider": {
    "kiro": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Kiro (CodeWhisperer)",
      "options": {
        "baseURL": "http://127.0.0.1:11436/v1",
        "apiKey": "dummy"
      },
      "models": {
        "claude-opus-4.7":   { "name": "Claude Opus 4.7 (1M)" },
        "claude-sonnet-4.6": { "name": "Claude Sonnet 4.6 (1M)" },
        "claude-haiku-4.5":  { "name": "Claude Haiku 4.5" },
        "auto":              { "name": "Kiro Auto" }
      }
    }
  },
  "model": "kiro/claude-sonnet-4.6"
}
```

```bash
opencode run --model kiro/claude-opus-4.7 "Refactor this function..."
```

### Cursor / Cline / Kilo Code / Roo Code

Configure an **OpenAI-compatible** provider:

- Base URL: `http://127.0.0.1:11436/v1`
- API key: `dummy` (any string works)
- Model: `claude-sonnet-4.6`, `claude-opus-4.7`, `auto`, …

### Continue

In `~/.continue/config.yaml`:

```yaml
models:
  - name: Kiro Sonnet 4.6
    provider: openai
    model: claude-sonnet-4.6
    apiBase: http://127.0.0.1:11436/v1
    apiKey: dummy
    roles: [chat, edit, apply]
```

### curl

```bash
# Simple chat
curl http://127.0.0.1:11436/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4.6",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# With tools
curl http://127.0.0.1:11436/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4.6",
    "messages": [{"role": "user", "content": "list files in /tmp"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "list_files",
        "description": "List files in a directory",
        "parameters": {
          "type": "object",
          "required": ["path"],
          "properties": {"path": {"type": "string"}}
        }
      }
    }]
  }'
```

## Custom system instructions

The proxy can prepend (or append, or replace) your own system instructions
to every request, loaded from plain markdown files. Handy when the client
doesn't know about your rules, or you want the same persona/rules across
many different clients.

Copy the example config:

```bash
mkdir -p ~/.config/kiro-proxy
cp system-instructions.example.json ~/.config/kiro-proxy/system-instructions.json
# edit it, point `files[].path` at your own .md files
```

Minimal config:

```json
{
  "enabled": true,
  "mode": "prepend",
  "files": [
    { "path": "/abs/path/to/your/AGENTS.md", "required": true }
  ]
}
```

Modes:

- `prepend` — your text before whatever the client sent (default).
- `append` — your text after.
- `replace` — ignore the client's system prompt entirely.
- `off` — pass through untouched.

Per-request override: send `X-Proxy-Instructions: off` (or `replace`, etc.)
with your request to override the configured mode for that call only.

Check what's loaded:

```bash
curl -s http://127.0.0.1:11436/debug/instructions | jq .
```

Force a reload without restart:

```bash
curl -s -X POST http://127.0.0.1:11436/debug/instructions/reload | jq .
```

See `examples/` for three ready-to-use packs: `minimal/`, `coding/`, `persona/`.

Your real `system-instructions.json` and any private rule files are
gitignored by default — the repo only ships the example config and the
generic example packs.

## How it works

```
OpenAI client
    ↓ POST /v1/chat/completions { messages, tools, stream }
kiro-proxy
    ↓ reads access_token from ~/.local/share/kiro-cli/data.sqlite3
    ↓ converts OpenAI format → Kiro conversationState
    ↓ POST https://q.us-east-1.amazonaws.com/
    ↓ Authorization: Bearer <access_token>
    ↓ X-Amz-Target: AmazonCodeWhispererStreamingService.GenerateAssistantResponse
Kiro / AWS CodeWhisperer
    ↓ AWS Event Stream (binary framed)
kiro-proxy
    ↓ parses events (assistantResponseEvent, toolUseEvent, …)
    ↓ converts to OpenAI chat.completion / SSE
OpenAI client
```

See [PROTOCOL.md](./PROTOCOL.md) for the full Kiro wire protocol.

## Limits & known issues

- **Images / vision**: not implemented (Kiro supports `IMAGE` input — PR welcome).
- **Reasoning / thinking tokens** (Opus 4.7 adaptive thinking): not surfaced to clients.
- **Rate limits**: whatever your Kiro subscription credit pool allows.
- **Token refresh**: relies on external `kiro-cli` invocation. Could be replaced by direct OIDC refresh.

## Environment variables

| Name | Default | Description |
|---|---|---|
| `KIRO_PROXY_PORT` | `11436` | Listen port. |
| `KIRO_DB_PATH` | auto | Override path to Kiro CLI SQLite DB. |
| `KIRO_DUMP_DIR` | `os.tmpdir()` | Where 400-error debug dumps are written. |
| `KIRO_PROXY_INSTRUCTIONS_CONFIG` | auto | Path to custom `system-instructions.json`. |

## License

MIT. See [LICENSE](./LICENSE).

## Disclaimer

Unofficial. Not affiliated with Amazon, Kiro, or AWS. Use in accordance with your Kiro subscription terms.
