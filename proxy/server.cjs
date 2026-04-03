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

function proxyToOllama(req, res, path, body) {
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
      res.writeHead(proxyRes.statusCode, {
        "Content-Type": proxyRes.headers["content-type"] || "application/json",
        "Transfer-Encoding": proxyRes.headers["transfer-encoding"] || "",
      });
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "LLM backend unavailable", detail: err.message }));
  });
  if (body) proxyReq.write(body);
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
        body = JSON.stringify(parsed);
      } catch {}
    }

    // Map OpenAI-compatible paths to Ollama
    let ollamaPath = req.url;
    if (req.url === "/v1/chat/completions" || req.url === "/chat/completions") ollamaPath = "/api/chat";
    if (req.url === "/v1/models" || req.url === "/models") ollamaPath = "/api/tags";

    proxyToOllama(req, res, ollamaPath, body || undefined);
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
