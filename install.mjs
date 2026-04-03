#!/usr/bin/env node
// ─── llm-tunnel interactive installer ──────────────────────────────────────
// Usage:
//   npx llm-tunnel
//   OR: git clone ... && node install.mjs
// ────────────────────────────────────────────────────────────────────────────

import { createInterface } from "readline";
import { execSync, spawn } from "child_process";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

const INSTALL_DIR = join(homedir(), "llm-tunnel");
const REPO = "https://github.com/ilker-tff/llm-tunnel.git";

// ── Colors ──────────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m",
  white: "\x1b[37m",
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

function createMenu(rl, title, items, formatItem) {
  return new Promise((resolve) => {
    let selected = 0;
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();

    function render() {
      // Move cursor up to redraw
      if (selected >= 0) process.stdout.write(`\x1b[${items.length + 2}A`);
      console.log(`\n  ${c.bold}${title}${c.reset}`);
      items.forEach((item, i) => {
        const prefix = i === selected ? `${c.cyan}❯${c.reset}` : " ";
        const text = formatItem(item, i === selected);
        console.log(`  ${prefix} ${text}`);
      });
    }

    // Initial render
    console.log(`\n  ${c.bold}${title}${c.reset}`);
    items.forEach((item, i) => {
      const prefix = i === selected ? `${c.cyan}❯${c.reset}` : " ";
      const text = formatItem(item, i === selected);
      console.log(`  ${prefix} ${text}`);
    });

    function onKey(key) {
      // Up arrow or k
      if (key[0] === 27 && key[1] === 91 && key[2] === 65) {
        selected = Math.max(0, selected - 1);
        render();
      }
      // Down arrow or j
      else if (key[0] === 27 && key[1] === 91 && key[2] === 66) {
        selected = Math.min(items.length - 1, selected + 1);
        render();
      }
      // Enter
      else if (key[0] === 13) {
        stdin.removeListener("data", onKey);
        stdin.setRawMode(false);
        stdin.pause();
        resolve(items[selected]);
      }
      // Ctrl+C
      else if (key[0] === 3) {
        stdin.setRawMode(false);
        process.exit(0);
      }
    }

    stdin.on("data", onKey);
  });
}

// ── Run command with live output ────────────────────────────────────────────

function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: true, ...opts });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: ${cmd} ${args.join(" ")}`));
    });
  });
}

function runQuiet(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe" }).trim();
  } catch {
    return null;
  }
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

  // ── Check Docker ──────────────────────────────────────────────────────
  const dockerVersion = runQuiet("docker --version");
  if (!dockerVersion) {
    err("Docker is not installed.");
    console.log(`\n  Install: ${c.cyan}https://docker.com/products/docker-desktop${c.reset}\n`);
    process.exit(1);
  }
  ok(`Docker found`);

  const dockerRunning = runQuiet("docker info");
  if (!dockerRunning) {
    err("Docker is not running. Start Docker Desktop and try again.");
    process.exit(1);
  }
  ok("Docker is running");

  const composeVersion = runQuiet("docker compose version");
  if (!composeVersion) {
    err("Docker Compose not found.");
    process.exit(1);
  }
  ok("Docker Compose found");

  // ── Detect RAM ────────────────────────────────────────────────────────
  let totalRamGB = 0;
  const ramBytes = runQuiet("sysctl -n hw.memsize") || runQuiet("free -b | awk '/Mem:/{print $2}'");
  if (ramBytes) totalRamGB = Math.floor(parseInt(ramBytes) / 1073741824);
  if (totalRamGB > 0) {
    info(`Detected ${c.bold}${totalRamGB}GB${c.reset} RAM`);
  }

  // ── Model selection ───────────────────────────────────────────────────
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const model = await createMenu(
    rl,
    "Select a model (↑↓ arrows, Enter to confirm):",
    MODELS,
    (m, active) => {
      const name = active ? `${c.bold}${c.cyan}${m.id}${c.reset}` : `${m.id}`;
      const size = `${c.dim}${m.size}${c.reset}`;
      const desc = active ? `${c.white}${m.desc}${c.reset}` : `${c.dim}${m.desc}${c.reset}`;
      const ram = `${c.dim}(${m.ram} RAM)${c.reset}`;
      return `${name.padEnd(active ? 35 : 20)} ${size.padEnd(15)} ${desc} ${ram}`;
    }
  );
  br();
  ok(`Model: ${c.bold}${model.id}${c.reset} (${model.size})`);

  // ── Generate API key ──────────────────────────────────────────────────
  const apiKey = randomBytes(32).toString("hex");
  ok("API key generated");

  // ── Memory ────────────────────────────────────────────────────────────
  const memLimit = totalRamGB > 0 ? `${Math.floor(totalRamGB / 2)}g` : "16g";
  info(`Allocating ${memLimit} to Ollama`);

  // ── Clone/update repo ─────────────────────────────────────────────────
  if (existsSync(INSTALL_DIR)) {
    info("Updating existing installation...");
    runQuiet(`git -C "${INSTALL_DIR}" pull`);
  } else {
    info("Cloning llm-tunnel...");
    runQuiet(`git clone --quiet "${REPO}" "${INSTALL_DIR}"`);
  }
  ok("Repository ready");

  // ── Write .env ────────────────────────────────────────────────────────
  const envContent = [
    `API_KEY=${apiKey}`,
    `MODEL=${model.id}`,
    `TUNNEL_TOKEN=unused`,
    `RATE_LIMIT_RPM=60`,
    `OLLAMA_MEMORY_LIMIT=${memLimit}`,
  ].join("\n") + "\n";

  writeFileSync(join(INSTALL_DIR, ".env"), envContent);
  ok(".env written");

  // ── Start services ────────────────────────────────────────────────────
  br();
  info("Starting containers...");
  br();
  await run("docker", ["compose", "up", "-d"], { cwd: INSTALL_DIR });

  // ── Wait for Ollama ───────────────────────────────────────────────────
  br();
  info("Waiting for Ollama to start...");
  for (let i = 0; i < 30; i++) {
    const ready = runQuiet("docker exec llm-tunnel-ollama ollama list");
    if (ready !== null) {
      ok("Ollama is ready");
      break;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 2000));
  }
  br();

  // ── Pull model ────────────────────────────────────────────────────────
  info(`Downloading ${c.bold}${model.id}${c.reset} (${model.size}) — this may take a few minutes...`);
  br();
  await run("docker", ["exec", "llm-tunnel-ollama", "ollama", "pull", model.id]);
  br();
  ok(`Model ${c.bold}${model.id}${c.reset} ready`);

  // ── Done ──────────────────────────────────────────────────────────────
  br();
  console.log(`  ${c.green}${c.bold}╔═══════════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`  ${c.green}${c.bold}║              llm-tunnel is running!                       ║${c.reset}`);
  console.log(`  ${c.green}${c.bold}╚═══════════════════════════════════════════════════════════╝${c.reset}`);
  br();
  console.log(`  ${c.bold}Model:${c.reset}    ${model.id}`);
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
  console.log(`  ${c.bold}Stop:${c.reset}     cd ~/llm-tunnel && docker compose down`);
  console.log(`  ${c.bold}Restart:${c.reset}  cd ~/llm-tunnel && docker compose up -d`);
  br();
  console.log(`  ${c.yellow}Save your API key — you need it for every request.${c.reset}`);
  br();

  rl.close();
  process.exit(0);
}

main().catch((e) => {
  err(e.message);
  process.exit(1);
});
