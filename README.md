# kiro-proxy

OpenAI-compatible local proxy for **Kiro CLI** (Amazon CodeWhisperer / Amazon Q) models.

Expose the free models available through your Kiro login — **Claude Opus 4.7, Sonnet 4.6, Haiku 4.5, DeepSeek, Qwen, GLM, Minimax** — as a standard OpenAI API, so any OpenAI-compatible client can use them: **OpenCode, Cursor, Cline, Kilo Code, Roo Code, Continue**, or your own scripts.

> Works by reading the OAuth access token that Kiro CLI stores locally after login, and translating between OpenAI chat format and Kiro's internal `AmazonCodeWhispererStreamingService.GenerateAssistantResponse` protocol.

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
- Linux/macOS (Windows may need path adjustments — Kiro SQLite path differs).

## Install

```bash
git clone https://github.com/bigdata2211it-web/kiro-proxy.git
cd kiro-proxy
npm install
```

## Run

### Manual

```bash
node index.js
```

Listens on `http://127.0.0.1:11436`.

Override port: `KIRO_PROXY_PORT=12000 node index.js`.

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
- **Kiro SQLite path** is hardcoded to `~/.local/share/kiro-cli/data.sqlite3` (Linux). macOS/Windows paths may differ.

## License

MIT. See [LICENSE](./LICENSE).

## Disclaimer

Unofficial. Not affiliated with Amazon, Kiro, or AWS. Use in accordance with your Kiro subscription terms.
