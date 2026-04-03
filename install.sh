#!/usr/bin/env bash
# ─── llm-tunnel installer ───────────────────────────────────────────────────
# Self-hosted LLM with API key auth. One command to install.
#
# Usage:
#   curl -fsSL .../install.sh | bash -s -- gemma4:31b
#   curl -fsSL .../install.sh | bash -s -- gemma4:e4b
#   curl -fsSL .../install.sh | bash              # defaults to gemma4:e4b
#
# Available models:
#   gemma4:31b  (20GB)  - Best quality, video + image
#   gemma4:26b  (18GB)  - Fast MoE, video + image
#   gemma4:e4b  (9.6GB) - Edge, audio + image + video  [default]
#   gemma4:e2b  (7.2GB) - Smallest, audio + image + video
#   qwen3.5:32b (20GB)  - Strong reasoning + tools
#   mistral     (4.1GB) - Fast and lightweight
#   Or any model from ollama.com/library
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO="https://github.com/ilker-tff/llm-tunnel.git"
INSTALL_DIR="$HOME/llm-tunnel"
MODEL="${1:-gemma4:e4b}"
TUNNEL_TOKEN="${TUNNEL_TOKEN:-unused}"
API_KEY="${API_KEY:-$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 64)}"

# ── Colors ───────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${BLUE}[info]${NC}  $1"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $1"; }
err()   { echo -e "${RED}[error]${NC} $1"; }

# ── Banner ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}${BOLD}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║           llm-tunnel                  ║"
echo "  ║   Self-hosted LLM in one command      ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"

# ── Check Docker ─────────────────────────────────────────────────────────────

if ! command -v docker &> /dev/null; then
  err "Docker is not installed."
  echo ""
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "  Install: brew install --cask docker"
  elif [[ "$OSTYPE" == "linux"* ]]; then
    echo "  Install: curl -fsSL https://get.docker.com | sh"
  else
    echo "  Install: https://docker.com/products/docker-desktop"
  fi
  echo ""
  exit 1
fi
ok "Docker found"

if ! docker info &> /dev/null 2>&1; then
  err "Docker is not running. Start Docker Desktop and try again."
  exit 1
fi
ok "Docker is running"

if docker compose version &> /dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose &> /dev/null; then
  COMPOSE="docker-compose"
else
  err "Docker Compose not found. Install Docker Desktop (includes Compose)."
  exit 1
fi
ok "Docker Compose found"

# ── Clone or update repo ─────────────────────────────────────────────────────

if [ -d "$INSTALL_DIR" ]; then
  info "Updating existing installation..."
  git -C "$INSTALL_DIR" pull --quiet 2>/dev/null || true
else
  info "Cloning llm-tunnel..."
  git clone --quiet "$REPO" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
ok "Repository ready"

# ── Config ───────────────────────────────────────────────────────────────────

ok "Model: $MODEL"
ok "API key generated"

# Detect RAM
TOTAL_RAM=$(sysctl -n hw.memsize 2>/dev/null || free -b 2>/dev/null | awk '/Mem:/{print $2}' || echo 0)
TOTAL_RAM_GB=$((TOTAL_RAM / 1073741824))
if [ "$TOTAL_RAM_GB" -gt 0 ]; then
  MEM_LIMIT="$((TOTAL_RAM_GB / 2))g"
  info "Detected ${TOTAL_RAM_GB}GB RAM, allocating ${MEM_LIMIT} to Ollama"
else
  MEM_LIMIT="16g"
fi

USE_TUNNEL=false
if [ "$TUNNEL_TOKEN" != "unused" ]; then
  USE_TUNNEL=true
  ok "Cloudflare Tunnel configured"
fi

# ── Write .env ───────────────────────────────────────────────────────────────

cat > .env << ENVEOF
API_KEY=${API_KEY}
MODEL=${MODEL}
TUNNEL_TOKEN=${TUNNEL_TOKEN}
RATE_LIMIT_RPM=60
OLLAMA_MEMORY_LIMIT=${MEM_LIMIT}
ENVEOF
ok ".env written"

# ── Start services ───────────────────────────────────────────────────────────

info "Starting llm-tunnel..."
echo ""

if [ "$USE_TUNNEL" = true ]; then
  $COMPOSE --profile tunnel up -d 2>&1
else
  $COMPOSE up -d 2>&1
fi

# ── Wait for Ollama ──────────────────────────────────────────────────────────

echo ""
info "Waiting for Ollama to start..."
for i in $(seq 1 30); do
  if docker exec llm-tunnel-ollama ollama list &> /dev/null 2>&1; then
    ok "Ollama is ready"
    break
  fi
  echo -n "."
  sleep 2
done
echo ""

# ── Download model ───────────────────────────────────────────────────────────

info "Downloading model: ${MODEL} (this may take a few minutes...)"
echo ""
docker exec llm-tunnel-ollama ollama pull "$MODEL" 2>&1

if [ $? -eq 0 ]; then
  ok "Model ${MODEL} ready"
else
  err "Model download failed. Try: docker exec llm-tunnel-ollama ollama pull ${MODEL}"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║              llm-tunnel is running!                       ║${NC}"
echo -e "${GREEN}${BOLD}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Model:${NC}    $MODEL"
echo -e "  ${BOLD}API Key:${NC}  $API_KEY"
echo -e "  ${BOLD}Local:${NC}    http://localhost:8080"
if [ "$USE_TUNNEL" = true ]; then
  echo -e "  ${BOLD}Tunnel:${NC}   Check your Cloudflare dashboard for the public URL"
fi
echo ""
echo -e "  ${BOLD}Test it:${NC}"
echo ""
echo "    curl http://localhost:8080/v1/chat/completions \\"
echo "      -H \"Authorization: Bearer ${API_KEY}\" \\"
echo "      -H \"Content-Type: application/json\" \\"
echo "      -d '{\"messages\": [{\"role\": \"user\", \"content\": \"Hello!\"}]}'"
echo ""
echo -e "  ${BOLD}Stop:${NC}     cd $INSTALL_DIR && docker compose down"
echo -e "  ${BOLD}Restart:${NC}  cd $INSTALL_DIR && docker compose up -d"
echo -e "  ${BOLD}Logs:${NC}     cd $INSTALL_DIR && docker compose logs -f"
echo ""
echo -e "  ${YELLOW}Save your API key somewhere safe — you'll need it for every request.${NC}"
echo ""
