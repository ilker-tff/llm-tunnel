# llm-tunnel

Self-hosted LLM server with API key auth and Cloudflare Tunnel. One command to install.

Run open-source models like Gemma 4, Qwen, Llama on your own hardware and access them securely from anywhere via an OpenAI-compatible API.

```
Your app (anywhere)
     |
     | Authorization: Bearer <API_KEY>
     v
Cloudflare Tunnel (encrypted, no open ports)
     |
     v
Auth Proxy (validates key, rate limits)
     |
     v
Ollama (your hardware, your models)
```

## Install

```bash
npx github:ilker-tff/llm-tunnel
```

That's it. The interactive installer will:
- Check Docker is installed and running
- Let you pick a model with arrow keys (Gemma 4, Qwen, Llama, Mistral)
- Auto-detect RAM and set memory limits
- Generate a secure API key
- Download the model and start all services
- Print your API key and a ready-to-use test command

### Prerequisites

- [Node.js](https://nodejs.org) 18+ (for the installer)
- [Docker Desktop](https://docker.com/products/docker-desktop) (includes Docker Compose)

## Manual Setup

```bash
git clone https://github.com/ilker-tff/llm-tunnel.git
cd llm-tunnel
cp .env.example .env
# Edit .env with your API_KEY and MODEL
docker compose up -d
# Wait for Ollama to start, then pull the model:
docker exec llm-tunnel-ollama ollama pull gemma4:e4b
```

## Test

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello!"}]}'
```

## Expose to Internet (Cloudflare Tunnel)

Cloudflare Tunnels are **free** — no custom domain required.

### Option A: Quick test (no account needed)

```bash
docker run --rm --net=host cloudflare/cloudflared:latest tunnel --url http://localhost:8080
```

Gives you a random `https://xxx.trycloudflare.com` URL instantly.

### Option B: Permanent tunnel (free Cloudflare account)

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com) -> Networks -> Tunnels -> Create
2. Name your tunnel (e.g. "llm-tunnel")
3. Install the connector on your machine (Cloudflare shows the command)
4. Add a public hostname -> Service type: `HTTP` -> URL: `localhost:8080`
5. Done — your LLM is at `https://your-hostname.yourdomain.com`

You can also run the tunnel via Docker Compose by setting `TUNNEL_TOKEN` in `.env` and using:

```bash
docker compose --profile tunnel up -d
```

### Option C: Install via script

```bash
MODEL=gemma4:e4b TUNNEL_TOKEN=your-token curl -fsSL .../install.sh | bash
```

## Available Models

Any model from [ollama.com/library](https://ollama.com/library) works. Default: `gemma4:e4b`.

| Model | Size | Modality | RAM needed | Best for |
|-------|------|----------|------------|----------|
| `gemma4:e4b` | 9.6GB | Text, Image, Video, **Audio** | 16GB+ | Default — does everything |
| `gemma4:e2b` | 7.2GB | Text, Image, Video, **Audio** | 12GB+ | Lightweight, still multimodal |
| `gemma4:26b` | 18GB | Text, Image, Video | 32GB+ | Fast MoE, high quality |
| `gemma4:31b` | 20GB | Text, Image, Video | 48GB+ | Best quality (no audio) |
| `qwen3.5:32b` | 20GB | Text, Vision, Tools | 48GB+ | Strong reasoning |
| `llama4-scout` | 30GB | Text, Multilingual | 48GB+ | Meta's latest |
| `mistral` | 4.1GB | Text | 8GB+ | Fast and lightweight |

**Note:** Only the Gemma 4 edge models (e2b, e4b) support audio input. The larger 26B/31B models handle text, image, and video but not audio.

## API Endpoints

All endpoints require `Authorization: Bearer <API_KEY>` header (except health check).

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | OpenAI-compatible chat (auto-maps to Ollama) |
| `GET /v1/models` | List available models |
| `POST /api/chat` | Ollama native chat |
| `POST /api/generate` | Ollama native generate |
| `GET /health` | Health check (no auth) |

### Streaming

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello!"}], "stream": true}'
```

### Vision (Image/Video)

```bash
curl http://localhost:8080/api/chat \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma4:e4b",
    "messages": [{
      "role": "user",
      "content": "Describe this image",
      "images": ["base64-encoded-image-data"]
    }]
  }'
```

## Security

Three layers of protection:

1. **API Key** — every request must include a valid key. Rejected with 401 without it.
2. **Rate Limiting** — configurable per-minute limit (default: 60 req/min).
3. **Cloudflare Access** (optional) — add Zero Trust rules for IP/email/device restrictions.

Ollama only listens on `127.0.0.1` — never directly exposed to the internet.

## Configuration

All configuration via environment variables or `.env` file:

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | auto-generated | API key for authentication |
| `MODEL` | `gemma4:e4b` | Model to download and serve |
| `TUNNEL_TOKEN` | unused | Cloudflare Tunnel token (optional) |
| `RATE_LIMIT_RPM` | `60` | Rate limit (requests/minute) |
| `OLLAMA_MEMORY_LIMIT` | 50% of RAM | Max memory for Ollama container |

## Use with OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",  # or your tunnel URL
    api_key="your-api-key"
)

response = client.chat.completions.create(
    model="gemma4:e4b",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

## Use with OpenClaw

Configure your OpenClaw instance to use llm-tunnel as the LLM provider:

```bash
openclaw config set models.providers.tunnel '{
  "baseUrl": "https://your-tunnel-url.com",
  "apiKey": "your-api-key",
  "api": "openai-completions",
  "models": [{"id": "gemma4:e4b", "name": "Gemma 4 E4B"}]
}' --strict-json

openclaw config set agents.defaults.model.primary tunnel/gemma4:e4b
```

## Hardware Requirements

| RAM | Recommended Model | Notes |
|-----|-------------------|-------|
| 8GB | `mistral` (4.1GB) | Text only, fast |
| 12-16GB | `gemma4:e2b` or `gemma4:e4b` | Full multimodal including audio |
| 32GB | `gemma4:26b` | High quality, video + image |
| 48GB+ | `gemma4:31b` or `qwen3.5:32b` | Best quality |

Apple Silicon Macs are ideal — Metal acceleration makes inference fast without a discrete GPU.

## Managing

```bash
# Stop
cd ~/llm-tunnel && docker compose down

# Restart
cd ~/llm-tunnel && docker compose up -d

# View logs
cd ~/llm-tunnel && docker compose logs -f

# Pull a different model
docker exec llm-tunnel-ollama ollama pull gemma4:31b

# Check what's running
docker exec llm-tunnel-ollama ollama list

# Full reset (removes model data)
cd ~/llm-tunnel && docker compose down -v && rm -rf ~/llm-tunnel
```

## License

MIT
