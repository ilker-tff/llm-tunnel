#!/usr/bin/env bash
# ─── llm-tunnel installer ───────────────────────────────────────────────────
# Self-hosted LLM with API key auth. One command to install.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ilker-tff/llm-tunnel/main/install.sh | bash
#
# Or clone first:
#   git clone https://github.com/ilker-tff/llm-tunnel.git && cd llm-tunnel && bash install.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO="https://github.com/ilker-tff/llm-tunnel.git"
INSTALL_DIR="$HOME/llm-tunnel"

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
echo ""

# ── Check Docker ─────────────────────────────────────────────────────────────

if ! command -v docker &> /dev/null; then
  err "Docker is not installed."
  echo ""
  echo "  Install Docker first:"
  echo ""
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "    brew install --cask docker"
    echo "    # or download from https://docker.com/products/docker-desktop"
  elif [[ "$OSTYPE" == "linux"* ]]; then
    echo "    curl -fsSL https://get.docker.com | sh"
  else
    echo "    https://docker.com/products/docker-desktop"
  fi
  echo ""
  exit 1
fi
ok "Docker found"

# Check Docker is running
if ! docker info &> /dev/null 2>&1; then
  err "Docker is installed but not running."
  echo ""
  echo "  Start Docker Desktop and try again."
  echo ""
  exit 1
fi
ok "Docker is running"

# Check docker compose
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
  info "Updating existing installation at $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --quiet 2>/dev/null || true
else
  info "Cloning llm-tunnel to $INSTALL_DIR"
  git clone --quiet "$REPO" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
ok "Repository ready"

# ── Model selection ──────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Select a model:${NC}"
echo ""
echo "  1) gemma4:31b    20GB  - Best quality, video + image          (needs 48GB+ RAM)"
echo "  2) gemma4:26b    18GB  - Fast MoE, video + image              (needs 32GB+ RAM)"
echo "  3) gemma4:e4b    9.6GB - Edge model, audio + image + video    (needs 16GB+ RAM)"
echo "  4) gemma4:e2b    7.2GB - Smallest Gemma, audio + image + video (needs 12GB+ RAM)"
echo "  5) qwen3.5:32b   20GB  - Strong reasoning + tools             (needs 48GB+ RAM)"
echo "  6) mistral       4.1GB - Fast and lightweight                  (needs 8GB+ RAM)"
echo "  7) Custom        Enter any model from ollama.com/library"
echo ""

read -p "Choose [1-7, default=3]: " MODEL_CHOICE
MODEL_CHOICE=${MODEL_CHOICE:-3}

case $MODEL_CHOICE in
  1) MODEL="gemma4:31b" ;;
  2) MODEL="gemma4:26b" ;;
  3) MODEL="gemma4:e4b" ;;
  4) MODEL="gemma4:e2b" ;;
  5) MODEL="qwen3.5:32b" ;;
  6) MODEL="mistral" ;;
  7)
    read -p "Enter model name (e.g. llama4-scout): " MODEL
    if [ -z "$MODEL" ]; then
      err "No model specified"
      exit 1
    fi
    ;;
  *) MODEL="gemma4:e4b" ;;
esac
ok "Model: $MODEL"

# ── Generate API key ─────────────────────────────────────────────────────────

API_KEY=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 64)
ok "API key generated"

# ── Cloudflare Tunnel (optional) ─────────────────────────────────────────────

echo ""
read -p "Expose to internet via Cloudflare Tunnel? [y/N]: " TUNNEL_CHOICE
TUNNEL_CHOICE=${TUNNEL_CHOICE:-n}
TUNNEL_TOKEN=""
USE_TUNNEL=false

if [[ "$TUNNEL_CHOICE" =~ ^[Yy]$ ]]; then
  echo ""
  echo "  To get a tunnel token:"
  echo "  1. Go to https://one.dash.cloudflare.com"
  echo "  2. Networks -> Tunnels -> Create a tunnel"
  echo "  3. Set public hostname -> Service: http://proxy:8080"
  echo "  4. Copy the tunnel token"
  echo ""
  read -p "Paste tunnel token (or press Enter to skip): " TUNNEL_TOKEN
  if [ -n "$TUNNEL_TOKEN" ]; then
    USE_TUNNEL=true
    ok "Tunnel configured"
  else
    warn "Skipped — you can add TUNNEL_TOKEN to .env later"
  fi
fi

# ── Memory limit ─────────────────────────────────────────────────────────────

TOTAL_RAM=$(sysctl -n hw.memsize 2>/dev/null || free -b 2>/dev/null | awk '/Mem:/{print $2}' || echo 0)
TOTAL_RAM_GB=$((TOTAL_RAM / 1073741824))

if [ "$TOTAL_RAM_GB" -gt 0 ]; then
  # Use 75% of total RAM for Ollama
  MEM_LIMIT="$((TOTAL_RAM_GB * 3 / 4))g"
  info "Detected ${TOTAL_RAM_GB}GB RAM, allocating ${MEM_LIMIT} to Ollama"
else
  MEM_LIMIT="16g"
  info "Could not detect RAM, defaulting to ${MEM_LIMIT}"
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

echo ""
info "Starting llm-tunnel..."
echo ""

if [ "$USE_TUNNEL" = true ]; then
  $COMPOSE --profile tunnel up -d 2>&1
else
  $COMPOSE up -d 2>&1
fi

# ── Wait for model download ─────────────────────────────────────────────────

echo ""
info "Downloading model: ${MODEL} (this may take a few minutes...)"
echo ""

# Follow the model-loader logs until it finishes
$COMPOSE logs -f model-loader 2>&1 | while IFS= read -r line; do
  echo "  $line"
  if echo "$line" | grep -q "Model ready\|success\|exited with code 0"; then
    break
  fi
  if echo "$line" | grep -q "error\|Error\|failed"; then
    err "Model download failed. Check: $COMPOSE logs model-loader"
    break
  fi
done

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
