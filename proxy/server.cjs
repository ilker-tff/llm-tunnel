const http = require("http");
const fs = require("fs");
const path = require("path");

// Load config from config.json (written by installer) or fall back to env vars
let config = {};
try {
  const configPath = path.join(__dirname, "..", "config.json");
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch {}

const API_KEY = process.env.API_KEY || config.apiKey;
const OLLAMA_URL = process.env.OLLAMA_URL || config.ollamaUrl || "http://localhost:11434";
const PORT = parseInt(process.env.PORT || config.port || "8080");
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || config.model || "gemma4:e4b";
const RATE_LIMIT_RPM = parseInt(process.env.RATE_LIMIT_RPM || config.rateLimitRpm || "60");

if (!API_KEY) {
  console.error("No API key found. Run the installer: npx github:ilker-tff/llm-tunnel");
  process.exit(1);
}

// ── Rate limiter (per-key, per-minute) ────────────────────────────────────────

const rateBuckets = new Map();

function checkRateLimit(key) {
  const now = Date.now();
  const windowMs = 60_000;
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_LIMIT_RPM;
}

// ── Proxy handler ─────────────────────────────────────────────────────────────

function proxyToOllama(req, res, path, body, isChat) {
  const url = new URL(path, OLLAMA_URL);
  const proxyReq = http.request(
    url,
    {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
      },
    },
    (proxyRes) => {
      if (!isChat) {
        // Non-chat endpoints: pass through as-is
        res.writeHead(proxyRes.statusCode, {
          "Content-Type": proxyRes.headers["content-type"] || "application/json",
        });
        proxyRes.pipe(res);
        return;
      }

      // Chat endpoints: convert Ollama NDJSON stream → OpenAI SSE format
      res.writeHead(proxyRes.statusCode, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      let buffer = "";
      proxyRes.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ollamaMsg = JSON.parse(line);
            if (ollamaMsg.done) {
              // Final message — include usage stats
              const openaiDone = {
                id: "chatcmpl-" + Date.now(),
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: ollamaMsg.model || DEFAULT_MODEL,
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                usage: {
                  prompt_tokens: ollamaMsg.prompt_eval_count || 0,
                  completion_tokens: ollamaMsg.eval_count || 0,
                  total_tokens: (ollamaMsg.prompt_eval_count || 0) + (ollamaMsg.eval_count || 0),
                },
              };
              res.write(`data: ${JSON.stringify(openaiDone)}\n\n`);
              res.write("data: [DONE]\n\n");
            } else {
              // Streaming token
              const content = ollamaMsg.message?.content || "";
              if (content) {
                const openaiChunk = {
                  id: "chatcmpl-" + Date.now(),
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: ollamaMsg.model || DEFAULT_MODEL,
                  choices: [{ index: 0, delta: { content }, finish_reason: null }],
                };
                res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
              }
            }
          } catch {}
        }
      });

      proxyRes.on("end", () => {
        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const ollamaMsg = JSON.parse(buffer);
            if (ollamaMsg.done) {
              res.write("data: [DONE]\n\n");
            }
          } catch {}
        }
        res.end();
      });
    }
  );
  proxyReq.on("error", (err) => {
    console.error(`[proxy] ERROR ${path}: ${err.message}`);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "LLM backend unavailable", detail: err.message }));
  });
  if (body) {
    if (isChat) console.log(`[proxy] ${path} body=${body.substring(0, 300)}`);
    proxyReq.write(body);
  }
  proxyReq.end();
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // Health check (no auth needed)
  if (req.url === "/health" || req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "ok", model: DEFAULT_MODEL }));
  }

  // ── Auth check ────────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (token !== API_KEY) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Unauthorized", message: "Invalid or missing API key" }));
  }

  // ── Rate limit ────────────────────────────────────────────────────────────
  if (!checkRateLimit(token)) {
    res.writeHead(429, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Rate limit exceeded", limit: RATE_LIMIT_RPM + "/min" }));
  }

  // ── Collect body and proxy ────────────────────────────────────────────────
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    // Inject default model if not specified
    if (body && (req.url === "/v1/chat/completions" || req.url === "/chat/completions" || req.url === "/api/chat" || req.url === "/api/generate")) {
      try {
        const parsed = JSON.parse(body);
        if (!parsed.model) parsed.model = DEFAULT_MODEL;
        parsed.stream = true; // Always stream to avoid Cloudflare timeout
        body = JSON.stringify(parsed);
      } catch {}
    }

    // Map OpenAI-compatible paths to Ollama
    let ollamaPath = req.url;
    let isChat = false;
    if (req.url === "/v1/chat/completions" || req.url === "/chat/completions") { ollamaPath = "/api/chat"; isChat = true; }
    if (req.url === "/api/chat" || req.url === "/api/generate") { isChat = true; }
    if (req.url === "/v1/models" || req.url === "/models") ollamaPath = "/api/tags";

    proxyToOllama(req, res, ollamaPath, body || undefined, isChat);
  });
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.log(`llm-tunnel proxy already running on port ${PORT}`);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`llm-tunnel proxy listening on :${PORT}`);
  console.log(`  Auth: API key required`);
  console.log(`  Backend: ${OLLAMA_URL}`);
  console.log(`  Default model: ${DEFAULT_MODEL}`);
  console.log(`  Rate limit: ${RATE_LIMIT_RPM} req/min`);
});
