# llm-tunnel

Self-hosted LLM with API key auth. No Docker required.

Run open-source models like Gemma 4, Qwen, Llama on your own hardware and access them securely from anywhere via an OpenAI-compatible API.

```
Your app (anywhere)
     |
     | Authorization: Bearer <API_KEY>
     v
Cloudflare Tunnel (optional, encrypted)
     |
     v
Auth Proxy (validates key, rate limits)
     |
     v
Ollama (native, GPU accelerated)
```

## Install

```bash
npx github:ilker-tff/llm-tunnel
```

The interactive installer will:
- Install Ollama (if not present)
- Let you pick a model with arrow keys
- Download the model with native GPU acceleration
- Generate a secure API key
- Start the auth proxy
- Print a ready-to-use test command

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- macOS (Apple Silicon) or Linux

No Docker needed.

## Test

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello!"}]}'
```

## Expose to Internet

### Quick (no account needed)

```bash
cloudflared tunnel --url http://localhost:8080
```

Gives you a random `https://xxx.trycloudflare.com` URL instantly.

### Permanent (free Cloudflare account)

1. [Create a tunnel](https://one.dash.cloudflare.com) -> Networks -> Tunnels
2. Add public hostname -> Service: `http://localhost:8080`
3. Install the connector on your machine

## Available Models

| Model | Size | Modality | RAM | Best for |
|-------|------|----------|-----|----------|
| `gemma4:e4b` | 9.6GB | Text, Image, Video, Audio | 16GB+ | Default — does everything |
| `gemma4:e2b` | 7.2GB | Text, Image, Video, Audio | 12GB+ | Lightweight multimodal |
| `gemma4:26b` | 18GB | Text, Image, Video | 32GB+ | Fast MoE, high quality |
| `gemma4:31b` | 20GB | Text, Image, Video | 48GB+ | Best quality (no audio) |
| `qwen3.5:32b` | 20GB | Text, Vision, Tools | 48GB+ | Strong reasoning |
| `mistral` | 4.1GB | Text | 8GB+ | Fast and lightweight |

Any model from [ollama.com/library](https://ollama.com/library) works.

## API

All endpoints require `Authorization: Bearer <API_KEY>` (except health).

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | OpenAI-compatible chat |
| `GET /v1/models` | List models |
| `POST /api/chat` | Ollama native chat |
| `GET /health` | Health check (no auth) |

### Streaming

```json
{"messages": [...], "stream": true}
```

### Vision

```json
{
  "model": "gemma4:e4b",
  "messages": [{
    "role": "user",
    "content": "Describe this image",
    "images": ["base64-encoded-image"]
  }]
}
```

## Use with OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="your-api-key"
)

response = client.chat.completions.create(
    model="gemma4:e4b",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

## Use with OpenClaw

```bash
openclaw config set models.providers.tunnel '{
  "baseUrl": "https://your-tunnel-url.com",
  "apiKey": "your-api-key",
  "api": "openai-completions",
  "models": [{"id": "gemma4:e4b", "name": "Gemma 4 E4B"}]
}' --strict-json

openclaw config set agents.defaults.model.primary tunnel/gemma4:e4b
```

## Security

1. **API Key** — every request validated, rejected without it
2. **Rate Limiting** — 60 req/min default
3. **Cloudflare Access** (optional) — Zero Trust rules

Ollama listens on localhost only — never exposed directly.

## Managing

```bash
# Stop proxy
kill $(cat ~/llm-tunnel/proxy.pid)

# Restart proxy
API_KEY=your-key node ~/llm-tunnel/proxy/server.js &

# Pull a different model
ollama pull gemma4:26b

# List models
ollama list

# Stop Ollama
brew services stop ollama   # macOS
```

## License

MIT
