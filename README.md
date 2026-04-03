# llm-tunnel

Self-hosted LLM server with API key auth and Cloudflare Tunnel. One command to run, one command to expose.

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
curl -fsSL https://raw.githubusercontent.com/ilker-tff/llm-tunnel/main/install.sh | bash
```

That's it. The installer will:
- Check Docker is installed and running
- Let you pick a model (Gemma 4, Qwen, Llama, Mistral, etc.)
- Generate a secure API key
- Optionally set up Cloudflare Tunnel for remote access
- Download the model and start everything

## Manual Setup

### 1. Clone and configure

```bash
git clone https://github.com/ilker-tff/llm-tunnel.git
cd llm-tunnel
cp .env.example .env
```

Edit `.env`:
```bash
API_KEY=your-secret-key-here    # generate with: openssl rand -hex 32
MODEL=gemma4:31b                # or gemma4:e4b, qwen3.5:32b, etc.
```

### 2. Start (local only)

```bash
docker compose up -d
```

The model downloads automatically on first start. This takes a few minutes depending on model size and your internet speed.

### 3. Test

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma4:31b",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Expose to Internet (Cloudflare Tunnel)

### 1. Create a tunnel

Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com) -> Networks -> Tunnels -> Create a tunnel.

Set the tunnel's public hostname to point to `http://proxy:8080`.

Copy the tunnel token and add to `.env`:
```bash
TUNNEL_TOKEN=your-cloudflare-tunnel-token
```

### 2. Start with tunnel

```bash
docker compose --profile tunnel up -d
```

Your LLM is now available at `https://your-tunnel-hostname.yourdomain.com`.

### 3. Test remotely

```bash
curl https://your-tunnel-hostname.yourdomain.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello!"}]}'
```

## Available Models

Any model from [ollama.com/library](https://ollama.com/library) works. Set `MODEL` in `.env`:

| Model | Size | Best for |
|-------|------|----------|
| `gemma4:31b` | 20GB | Best quality, video + image understanding |
| `gemma4:26b` | 18GB | MoE, fast inference, video + image |
| `gemma4:e4b` | 9.6GB | Edge, supports audio + image + video |
| `gemma4:e2b` | 7.2GB | Smallest, audio + image + video |
| `qwen3.5:32b` | 20GB | Strong reasoning, tools, vision |
| `llama4-scout` | 30GB | Meta's latest, multilingual |
| `mistral` | 4.1GB | Fast, lightweight |

## API Endpoints

All endpoints require `Authorization: Bearer <API_KEY>` header.

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | OpenAI-compatible chat (auto-maps to Ollama) |
| `GET /v1/models` | List available models |
| `POST /api/chat` | Ollama native chat |
| `POST /api/generate` | Ollama native generate |
| `GET /health` | Health check (no auth needed) |

### Streaming

Add `"stream": true` to your request:

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello!"}], "stream": true}'
```

### Vision (Image Input)

```bash
curl http://localhost:8080/api/chat \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma4:31b",
    "messages": [{
      "role": "user",
      "content": "What is in this image?",
      "images": ["base64-encoded-image-data"]
    }]
  }'
```

## Security

Three layers of protection:

1. **API Key** - Every request must include a valid key. Without it, requests are rejected with 401.
2. **Rate Limiting** - Configurable per-minute limit (default: 60 req/min) prevents abuse.
3. **Cloudflare Access** (optional) - Add Zero Trust rules for additional IP/email/device restrictions.

Ollama only listens on `127.0.0.1` (localhost) - it's never directly exposed to the internet.

## Configuration

All configuration via `.env` file:

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | required | API key for authentication |
| `MODEL` | `gemma4:31b` | Model to download and serve |
| `TUNNEL_TOKEN` | optional | Cloudflare Tunnel token |
| `RATE_LIMIT_RPM` | `60` | Rate limit (requests/minute) |
| `OLLAMA_MEMORY_LIMIT` | `32g` | Max memory for Ollama |

## Use with OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-tunnel.yourdomain.com/v1",
    api_key="your-api-key"
)

response = client.chat.completions.create(
    model="gemma4:31b",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

## Use with OpenClaw

Configure your OpenClaw instance to use llm-tunnel as the LLM provider:

```bash
openclaw config set models.providers.tunnel '{
  "baseUrl": "https://your-tunnel.yourdomain.com",
  "apiKey": "your-api-key",
  "api": "openai-completions",
  "models": [{"id": "gemma4:31b", "name": "Gemma 4 31B"}]
}' --strict-json

openclaw config set agents.defaults.model.primary tunnel/gemma4:31b
```

## Hardware Requirements

| Users | RAM | CPU | Recommended Model |
|-------|-----|-----|-------------------|
| 1-3 | 16GB | 8 cores | gemma4:e4b (9.6GB) |
| 1-5 | 32GB | 8 cores | gemma4:26b (18GB) |
| 1-5 | 48GB+ | 10 cores | gemma4:31b (20GB) |

Apple Silicon Macs are ideal - Metal acceleration makes inference fast without a GPU.

## License

MIT
