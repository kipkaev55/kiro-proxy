const http = require("http");
const https = require("https");
const crypto = require("crypto");
const path = require("path");
const Database = require("better-sqlite3");

const PORT = parseInt(process.env.KIRO_PROXY_PORT || "11436");
const HOST = "q.us-east-1.amazonaws.com";
const DB_PATH = path.join(process.env.HOME, ".local/share/kiro-cli/data.sqlite3");

function getToken() {
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare("SELECT value FROM auth_kv WHERE key='kirocli:social:token'").get();
  db.close();
  if (!row) throw new Error("No token in Kiro DB. Run: kiro-cli login");
  return JSON.parse(row.value);
}

// ─────────────────────────────────────────────────────────────
// Incremental AWS Event Stream parser (для стриминга)
// ─────────────────────────────────────────────────────────────
class EventStreamParser {
  constructor() { this.buf = Buffer.alloc(0); }
  
  feed(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const events = [];
    while (this.buf.length >= 12) {
      const totalLen = this.buf.readUInt32BE(0);
      if (this.buf.length < totalLen) break;
      
      const headersLen = this.buf.readUInt32BE(4);
      const headerEnd = 12 + headersLen;
      const payloadEnd = totalLen - 4;
      
      let hp = 12;
      const headers = {};
      while (hp < headerEnd) {
        const nl = this.buf[hp++];
        const name = this.buf.slice(hp, hp + nl).toString(); hp += nl;
        const vt = this.buf[hp++];
        if (vt === 7) {
          const vl = this.buf.readUInt16BE(hp); hp += 2;
          headers[name] = this.buf.slice(hp, hp + vl).toString(); hp += vl;
        } else break;
      }
      events.push({ type: headers[":event-type"], payload: this.buf.slice(headerEnd, payloadEnd).toString() });
      this.buf = this.buf.slice(totalLen);
    }
    return events;
  }
}

const VALID_MODELS = new Set([
  "auto","claude-opus-4.7","claude-opus-4.6","claude-sonnet-4.6","claude-opus-4.5",
  "claude-sonnet-4.5","claude-sonnet-4","claude-haiku-4.5","claude-haiku-4",
  "deepseek-3.2","minimax-m2.5","minimax-m2.1","qwen3-coder-next","glm-5"
]);
function normalizeModel(m) {
  if (!m) return "auto";
  if (VALID_MODELS.has(m)) return m;
  if (/opus.*4\.?7/i.test(m)) return "claude-opus-4.7";
  if (/opus.*4\.?6/i.test(m)) return "claude-opus-4.6";
  if (/opus.*4\.?5/i.test(m)) return "claude-opus-4.5";
  if (/opus/i.test(m)) return "claude-opus-4.7";
  if (/sonnet.*4\.?6/i.test(m)) return "claude-sonnet-4.6";
  if (/sonnet.*4\.?5/i.test(m)) return "claude-sonnet-4.5";
  if (/sonnet/i.test(m)) return "claude-sonnet-4.6";
  if (/haiku/i.test(m)) return "claude-haiku-4.5";
  if (/deepseek/i.test(m)) return "deepseek-3.2";
  if (/qwen/i.test(m)) return "qwen3-coder-next";
  if (/glm/i.test(m)) return "glm-5";
  if (/minimax/i.test(m)) return "minimax-m2.5";
  return "auto";
}

function openaiToolsToKiro(tools) {
  if (!tools || !tools.length) return undefined;
  return tools.map(t => {
    const fn = t.function || t;
    return { toolSpecification: { name: fn.name, description: fn.description || "", inputSchema: { json: fn.parameters || { type: "object", properties: {} } } } };
  });
}

function flattenContent(c) {
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c.map(x => typeof x === "string" ? x : (x.type === "text" ? x.text : "")).join("\n");
}

function tryParseJson(s) { try { return JSON.parse(s); } catch { return { result: s }; } }

function openaiToKiro(body) {
  const { messages, tools: openaiTools } = body;
  const model = normalizeModel(body.model);
  const history = [];
  let systemPrompt = "";
  let pendingToolResults = [];
  let pendingUserMessage = null;
  let pendingAssistantMessage = null;

  for (const msg of messages) {
    if (msg.role === "system") systemPrompt += flattenContent(msg.content) + "\n";
  }
  const nonSystem = messages.filter(m => m.role !== "system");

  for (const msg of nonSystem) {
    if (msg.role === "user") {
      // Flush pending assistant + tool results as a pair before new user message
      if (pendingAssistantMessage) {
        history.push({ assistantResponseMessage: pendingAssistantMessage });
        pendingAssistantMessage = null;
      }
      if (pendingToolResults.length) {
        history.push({ userInputMessage: { content: "", userInputMessageContext: { toolResults: pendingToolResults }, origin: "KIRO_CLI", modelId: model } });
        pendingToolResults = [];
      }
      // If there's already a pending user message, flush it (shouldn't happen normally)
      if (pendingUserMessage) { history.push({ userInputMessage: pendingUserMessage }); pendingUserMessage = null; }
      pendingUserMessage = { content: flattenContent(msg.content), userInputMessageContext: {}, origin: "KIRO_CLI", modelId: model };
    } else if (msg.role === "assistant") {
      // Flush pending assistant + tool results as a pair, then pending user
      if (pendingAssistantMessage) {
        history.push({ assistantResponseMessage: pendingAssistantMessage });
        pendingAssistantMessage = null;
      }
      if (pendingToolResults.length) {
        history.push({ userInputMessage: { content: pendingUserMessage ? pendingUserMessage.content : "", userInputMessageContext: { toolResults: pendingToolResults }, origin: "KIRO_CLI", modelId: model } });
        pendingToolResults = [];
        pendingUserMessage = null;
      } else if (pendingUserMessage) {
        history.push({ userInputMessage: pendingUserMessage }); pendingUserMessage = null;
      }
      const assistantMsg = { content: flattenContent(msg.content) };
      if (msg.tool_calls?.length) {
        assistantMsg.toolUses = msg.tool_calls.map(tc => ({
          toolUseId: tc.id, name: tc.function?.name || tc.name,
          input: typeof tc.function?.arguments === "string" ? JSON.parse(tc.function.arguments || "{}") : (tc.function?.arguments || tc.input || {})
        }));
      }
      pendingAssistantMessage = assistantMsg;
    } else if (msg.role === "tool") {
      pendingToolResults.push({ toolUseId: msg.tool_call_id, content: [{ json: typeof msg.content === "string" ? tryParseJson(msg.content) : msg.content }], status: "success" });
    }
  }
  if (pendingAssistantMessage) { history.push({ assistantResponseMessage: pendingAssistantMessage }); pendingAssistantMessage = null; }

  const userContext = { envState: { operatingSystem: "linux", currentWorkingDirectory: process.cwd() } };
  if (openaiTools) userContext.tools = openaiToolsToKiro(openaiTools);

  let currentMessage;
  if (pendingToolResults.length) {
    userContext.toolResults = pendingToolResults;
    currentMessage = { userInputMessage: { content: pendingUserMessage ? pendingUserMessage.content : "", userInputMessageContext: userContext, origin: "KIRO_CLI", modelId: model } };
  } else if (pendingUserMessage) {
    let content = pendingUserMessage.content;
    if (systemPrompt) content = systemPrompt + content;
    currentMessage = { userInputMessage: { content, userInputMessageContext: userContext, origin: "KIRO_CLI", modelId: model } };
  } else {
    currentMessage = { userInputMessage: { content: systemPrompt, userInputMessageContext: userContext, origin: "KIRO_CLI", modelId: model } };
  }

  return { conversationState: { conversationId: crypto.randomUUID(), history, currentMessage, chatTriggerType: "MANUAL", agentTaskType: "vibe" } };
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  if (req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [...VALID_MODELS].map(id => ({ id, object: "model", owned_by: "kiro", created: Math.floor(Date.now()/1000) })) }));
    return;
  }
  if (req.url === "/health") { res.writeHead(200); res.end("ok"); return; }

  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    console.log("[REQ]", new Date().toISOString(), req.headers["user-agent"] || "?");
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      let parsed;
      try { parsed = JSON.parse(raw); } catch { res.writeHead(400); res.end('{"error":"bad json"}'); return; }
      console.log("[DEBUG] model:", parsed.model, "msgs:", parsed.messages?.length, "tools:", parsed.tools?.length || 0, "stream:", parsed.stream);

      let tokenData;
      try { tokenData = getToken(); } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: { message: e.message } })); return; }

      const kiroReq = openaiToKiro(parsed);
      kiroReq.profileArn = tokenData.profile_arn;
      const body = JSON.stringify(kiroReq);
      console.log("[DEBUG] kiroReq body (first 800):", body.slice(0, 800));
      const model = normalizeModel(parsed.model);
      const id = `chatcmpl-kiro-${Date.now()}`;
      const streaming = parsed.stream;

      const opts = {
        hostname: HOST, port: 443, path: "/", method: "POST",
        headers: {
          "content-type": "application/x-amz-json-1.0",
          "x-amz-target": "AmazonCodeWhispererStreamingService.GenerateAssistantResponse",
          "authorization": `Bearer ${tokenData.access_token}`,
          "content-length": Buffer.byteLength(body)
        }
      };

      const proxyReq = https.request(opts, (proxyRes) => {
        if (proxyRes.statusCode !== 200) {
          let err = "";
          proxyRes.on("data", d => err += d);
          proxyRes.on("end", () => {
            console.error(`[KIRO] ${proxyRes.statusCode}: ${err.slice(0,300)}`);
            res.writeHead(proxyRes.statusCode, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: err.slice(0,400), code: proxyRes.statusCode } }));
          });
          return;
        }

        if (streaming) {
          // РЕАЛЬНЫЙ streaming — прокидываем chunks по мере получения
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
          const parser = new EventStreamParser();
          const toolCallsById = new Map();
          let toolCallIndex = 0;

          proxyRes.on("data", (chunk) => {
            const events = parser.feed(chunk);
            for (const e of events) {
              if (e.type === "assistantResponseEvent") {
                try {
                  const d = JSON.parse(e.payload);
                  if (d.content) {
                    res.write(`data: ${JSON.stringify({
                      id, object: "chat.completion.chunk", model, created: Math.floor(Date.now()/1000),
                      choices: [{ index: 0, delta: { content: d.content }, finish_reason: null }]
                    })}\n\n`);
                  }
                } catch {}
              } else if (e.type === "toolUseEvent") {
                try {
                  const d = JSON.parse(e.payload);
                  if (!toolCallsById.has(d.toolUseId)) {
                    // Первый chunk — отправляем начало tool call с id+name
                    toolCallsById.set(d.toolUseId, { index: toolCallIndex++, sent_name: false });
                    const tc = toolCallsById.get(d.toolUseId);
                    res.write(`data: ${JSON.stringify({
                      id, object: "chat.completion.chunk", model, created: Math.floor(Date.now()/1000),
                      choices: [{ index: 0, delta: { tool_calls: [{ index: tc.index, id: d.toolUseId, type: "function", function: { name: d.name, arguments: "" } }] }, finish_reason: null }]
                    })}\n\n`);
                    tc.sent_name = true;
                  }
                  if (d.input !== undefined && d.input !== "") {
                    const tc = toolCallsById.get(d.toolUseId);
                    res.write(`data: ${JSON.stringify({
                      id, object: "chat.completion.chunk", model, created: Math.floor(Date.now()/1000),
                      choices: [{ index: 0, delta: { tool_calls: [{ index: tc.index, function: { arguments: d.input } }] }, finish_reason: null }]
                    })}\n\n`);
                  }
                } catch {}
              }
            }
          });

          proxyRes.on("end", () => {
            const finishReason = toolCallsById.size > 0 ? "tool_calls" : "stop";
            res.write(`data: ${JSON.stringify({
              id, object: "chat.completion.chunk", model, created: Math.floor(Date.now()/1000),
              choices: [{ index: 0, delta: {}, finish_reason: finishReason }]
            })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
          });

          proxyRes.on("error", (e) => { console.error("[KIRO] stream err:", e.message); try { res.end(); } catch {} });
        } else {
          // Non-stream — буферизуем всё
          const chunks = [];
          proxyRes.on("data", d => chunks.push(d));
          proxyRes.on("end", () => {
            const parser = new EventStreamParser();
            const events = parser.feed(Buffer.concat(chunks));
            const contentParts = [];
            const toolCallsById = new Map();
            for (const e of events) {
              if (e.type === "assistantResponseEvent") {
                try { const d = JSON.parse(e.payload); if (d.content) contentParts.push(d.content); } catch {}
              } else if (e.type === "toolUseEvent") {
                try {
                  const d = JSON.parse(e.payload);
                  if (!toolCallsById.has(d.toolUseId)) toolCallsById.set(d.toolUseId, { id: d.toolUseId, name: d.name, parts: [] });
                  if (d.input !== undefined) toolCallsById.get(d.toolUseId).parts.push(d.input);
                } catch {}
              }
            }
            const toolCalls = [...toolCallsById.values()].map(tc => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.parts.join("") || "{}" } }));
            const content = contentParts.join("");
            const message = { role: "assistant", content: content || null };
            if (toolCalls.length) message.tool_calls = toolCalls;
            const finishReason = toolCalls.length ? "tool_calls" : "stop";
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              id, object: "chat.completion", model, created: Math.floor(Date.now()/1000),
              choices: [{ index: 0, message, finish_reason: finishReason }],
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
            }));
          });
        }
      });
      proxyReq.on("error", e => { console.error("[KIRO] err:", e.message); res.writeHead(502); res.end(JSON.stringify({ error: { message: e.message } })); });
      proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }
  res.writeHead(404); res.end('{"error":"not found"}');
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[kiro-proxy] v3 http://127.0.0.1:${PORT} (real streaming + tool calls)`);
});
