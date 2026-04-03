#!/usr/bin/env node
// ─── llm-tunnel interactive installer ──────────────────────────────────────
// Usage:
//   npx github:ilker-tff/llm-tunnel
//
// No Docker required. Installs Ollama natively + a lightweight auth proxy.
// ────────────────────────────────────────────────────────────────────────────

import { execSync, spawn, fork } from "child_process";
import { existsSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

const INSTALL_DIR = join(homedir(), "llm-tunnel");
const REPO = "https://github.com/ilker-tff/llm-tunnel.git";
const IS_MAC = platform() === "darwin";

// ── Colors ──────────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m",
  cyan: "\x1b[36m", red: "\x1b[31m", white: "\x1b[37m",
};

const ok = (msg) => console.log(`  ${c.green}✔${c.reset} ${msg}`);
const info = (msg) => console.log(`  ${c.blue}ℹ${c.reset} ${msg}`);
const err = (msg) => console.log(`  ${c.red}✘${c.reset} ${msg}`);
const br = () => console.log();

// ── Models ──────────────────────────────────────────────────────────────────

const MODELS = [
  { id: "gemma4:31b", size: "20GB", desc: "Best quality — video + image", ram: "48GB+" },
  { id: "gemma4:26b", size: "18GB", desc: "Fast MoE — video + image", ram: "32GB+" },
  { id: "gemma4:e4b", size: "9.6GB", desc: "Edge — audio + image + video", ram: "16GB+" },
  { id: "gemma4:e2b", size: "7.2GB", desc: "Smallest — audio + image + video", ram: "12GB+" },
  { id: "qwen3.5:32b", size: "20GB", desc: "Strong reasoning + tools", ram: "48GB+" },
  { id: "mistral", size: "4.1GB", desc: "Fast and lightweight", ram: "8GB+" },
];

// ── Interactive menu ────────────────────────────────────────────────────────

function createMenu(title, items, formatItem) {
  return new Promise((resolve) => {
    let selected = 0;
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();

    function render() {
      if (selected >= 0) process.stdout.write(`\x1b[${items.length + 2}A`);
      console.log(`\n  ${c.bold}${title}${c.reset}`);
      items.forEach((item, i) => {
        const prefix = i === selected ? `${c.cyan}❯${c.reset}` : " ";
        console.log(`  ${prefix} ${formatItem(item, i === selected)}`);
      });
    }

    console.log(`\n  ${c.bold}${title}${c.reset}`);
    items.forEach((item, i) => {
      const prefix = i === selected ? `${c.cyan}❯${c.reset}` : " ";
      console.log(`  ${prefix} ${formatItem(item, i === selected)}`);
    });

    function onKey(key) {
      if (key[0] === 27 && key[1] === 91 && key[2] === 65) { selected = Math.max(0, selected - 1); render(); }
      else if (key[0] === 27 && key[1] === 91 && key[2] === 66) { selected = Math.min(items.length - 1, selected + 1); render(); }
      else if (key[0] === 13) { stdin.removeListener("data", onKey); stdin.setRawMode(false); stdin.pause(); resolve(items[selected]); }
      else if (key[0] === 3) { stdin.setRawMode(false); process.exit(0); }
    }
    stdin.on("data", onKey);
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function runLive(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: true, ...opts });
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Exit code ${code}`)));
  });
}

function runQuiet(cmd) {
  try { return execSync(cmd, { encoding: "utf8", stdio: "pipe" }).trim(); } catch { return null; }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.clear();
  br();
  console.log(`  ${c.cyan}${c.bold}╔═══════════════════════════════════════╗${c.reset}`);
  console.log(`  ${c.cyan}${c.bold}║           llm-tunnel                  ║${c.reset}`);
  console.log(`  ${c.cyan}${c.bold}║   Self-hosted LLM in one command      ║${c.reset}`);
  console.log(`  ${c.cyan}${c.bold}╚═══════════════════════════════════════╝${c.reset}`);
  br();

  // ── Check/Install Ollama ──────────────────────────────────────────────
  const ollamaInstalled = runQuiet("ollama --version");
  if (!ollamaInstalled) {
    info("Installing Ollama...");
    br();
    if (IS_MAC) {
      await runLive("brew", ["install", "ollama"]);
    } else {
      await runLive("sh", ["-c", "curl -fsSL https://ollama.com/install.sh | sh"]);
    }
    br();
    ok("Ollama installed");
  } else {
    ok("Ollama found");
  }

  // ── Start Ollama ──────────────────────────────────────────────────────
  const ollamaRunning = runQuiet("curl -sf http://localhost:11434/");
  if (!ollamaRunning) {
    info("Starting Ollama...");
    if (IS_MAC) {
      runQuiet("brew services start ollama");
    } else {
      spawn("ollama", ["serve"], { stdio: "ignore", detached: true }).unref();
    }
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (runQuiet("curl -sf http://localhost:11434/")) break;
    }
  }
  ok("Ollama running (native GPU acceleration)");

  // ── Detect RAM ────────────────────────────────────────────────────────
  let totalRamGB = 0;
  const ramBytes = runQuiet("sysctl -n hw.memsize") || runQuiet("free -b | awk '/Mem:/{print $2}'");
  if (ramBytes) totalRamGB = Math.floor(parseInt(ramBytes) / 1073741824);
  if (totalRamGB > 0) info(`Detected ${c.bold}${totalRamGB}GB${c.reset} RAM`);

  // ── Model selection ───────────────────────────────────────────────────
  const model = await createMenu(
    "Select a model (↑↓ arrows, Enter to confirm):",
    MODELS,
    (m, active) => {
      const name = active ? `${c.bold}${c.cyan}${m.id}${c.reset}` : m.id;
      const size = `${c.dim}${m.size}${c.reset}`;
      const desc = active ? `${c.white}${m.desc}${c.reset}` : `${c.dim}${m.desc}${c.reset}`;
      const ram = `${c.dim}(${m.ram} RAM)${c.reset}`;
      return `${name.padEnd(active ? 35 : 20)} ${size.padEnd(15)} ${desc} ${ram}`;
    }
  );
  br();
  ok(`Model: ${c.bold}${model.id}${c.reset} (${model.size})`);

  // ── Pull model ────────────────────────────────────────────────────────
  info(`Downloading ${c.bold}${model.id}${c.reset}...`);
  br();
  await runLive("ollama", ["pull", model.id]);
  br();
  ok(`Model ready`);

  // ── Generate API key ──────────────────────────────────────────────────
  const apiKey = randomBytes(32).toString("hex");
  ok("API key generated");

  // ── Clone repo (for proxy server) ─────────────────────────────────────
  if (existsSync(INSTALL_DIR)) {
    runQuiet(`git -C "${INSTALL_DIR}" pull`);
  } else {
    runQuiet(`git clone --quiet "${REPO}" "${INSTALL_DIR}"`);
  }
  ok("Repository ready");

  // ── Write config ──────────────────────────────────────────────────────
  const config = {
    apiKey,
    model: model.id,
    ollamaUrl: "http://localhost:11434",
    port: 8080,
    rateLimitRpm: 60,
  };
  writeFileSync(join(INSTALL_DIR, "config.json"), JSON.stringify(config, null, 2) + "\n");
  ok("Config written");

  // ── Start auth proxy as background process ────────────────────────────
  info("Starting auth proxy...");

  // Kill any existing proxy
  runQuiet("lsof -ti:8080 | xargs kill -9 2>/dev/null");

  const proxyScript = join(INSTALL_DIR, "proxy", "server.js");
  const proxyEnv = {
    ...process.env,
    API_KEY: apiKey,
    OLLAMA_URL: "http://localhost:11434",
    DEFAULT_MODEL: model.id,
    PORT: "8080",
    RATE_LIMIT_RPM: "60",
  };

  const proxy = spawn("node", [proxyScript], {
    stdio: "ignore",
    detached: true,
    env: proxyEnv,
  });
  proxy.unref();

  // Write PID for stop command
  writeFileSync(join(INSTALL_DIR, "proxy.pid"), String(proxy.pid));

  await new Promise((r) => setTimeout(r, 2000));
  const health = runQuiet("curl -sf http://localhost:8080/health");
  if (health) {
    ok(`Auth proxy running on port 8080`);
  } else {
    err("Proxy failed to start. Run manually: node ~/llm-tunnel/proxy/server.js");
  }

  // ── Done ──────────────────────────────────────────────────────────────
  br();
  console.log(`  ${c.green}${c.bold}╔═══════════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`  ${c.green}${c.bold}║              llm-tunnel is running!                       ║${c.reset}`);
  console.log(`  ${c.green}${c.bold}╚═══════════════════════════════════════════════════════════╝${c.reset}`);
  br();
  console.log(`  ${c.bold}Model:${c.reset}    ${model.id} (native, GPU accelerated)`);
  console.log(`  ${c.bold}API Key:${c.reset}  ${apiKey}`);
  console.log(`  ${c.bold}Local:${c.reset}    http://localhost:8080`);
  br();
  console.log(`  ${c.bold}Test it:${c.reset}`);
  br();
  console.log(`    curl http://localhost:8080/v1/chat/completions \\`);
  console.log(`      -H "Authorization: Bearer ${apiKey}" \\`);
  console.log(`      -H "Content-Type: application/json" \\`);
  console.log(`      -d '{"messages": [{"role": "user", "content": "Hello!"}]}'`);
  br();
  console.log(`  ${c.bold}Expose to internet:${c.reset}`);
  console.log(`    cloudflared tunnel --url http://localhost:8080`);
  br();
  console.log(`  ${c.bold}Stop:${c.reset}     kill $(cat ~/llm-tunnel/proxy.pid)`);
  console.log(`  ${c.bold}Restart:${c.reset}  node ~/llm-tunnel/proxy/server.js &`);
  br();
  console.log(`  ${c.yellow}Save your API key — you need it for every request.${c.reset}`);
  br();

  process.exit(0);
}

main().catch((e) => {
  err(e.message);
  process.exit(1);
});
