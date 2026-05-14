# Agent-to-Agent (A2A) Office

A multi-agent AI office system built on top of [9Router](https://github.com/decolua/9router). Agents live in a pixel-art office, talk to each other, and delegate tasks using the [A2A protocol](https://google.github.io/A2A/).

---

## What it does

- **Multi-agent office** — create agents with names, roles, system prompts, and seat positions in a 2D pixel office
- **Agent-to-agent delegation** — an agent can assign tasks to other agents by writing `[A2A:AgentName:task]` in its reply; the system calls the target agent and streams its response as a separate bubble
- **Hierarchy** — agents have managers and direct reports; context is automatically injected so agents know who they can delegate to
- **Tool use** — agents can use tools: `web_search`, `fetch_url`, `remember`, `recall`, `generate_file`, `schedule_task`
- **OpenAI-compatible API** — routes to 40+ providers (OpenRouter, Gemini, Claude, etc.) with auto-fallback
- **Real-time streaming** — all agent responses stream live via SSE

---

## Quick Start

### Docker (recommended)

```bash
git clone https://github.com/GodrezJr2/Agent-to-Agent
cd Agent-to-Agent
cp .env.example .env   # add your API keys
docker compose up -d
```

Open `http://localhost:20128`

### Local

```bash
npm install
npm run dev
```

---

## How agent delegation works

When an agent writes `[A2A:Kevin:write a README]` in its reply:

1. The system detects the tag and replaces it with `*(asking Kevin...)*` in the UI
2. A JSON-RPC 2.0 request is sent to Kevin's A2A endpoint (`/api/agents/{id}/a2a`)
3. Kevin runs its own LLM with full office history as context
4. Kevin's response appears as a separate bubble in the chat

### Delegation syntax

```
[A2A:AgentName:task description]
```

Agents are told about this format automatically via their system prompt context.

### Mention routing

```
@Thinker figure out the architecture
@Kevin write the code
```

Prefix with `@AgentName` to route to specific agents. No mention = broadcast to all.

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: `20128`) |
| `DATA_DIR` | Database path (default: `~/.9router/`) |
| `JWT_SECRET` | Dashboard auth secret |
| `INITIAL_PASSWORD` | Default login password (default: `123456`) |
| `API_KEY_SECRET` | HMAC secret for API key generation |

---

## Project structure

```
src/
  app/
    api/
      agents/[id]/a2a/      # A2A JSON-RPC endpoint (message/send, tasks/get)
      offices/[id]/chat/    # Office chat + SSE stream orchestration
      v1/                   # OpenAI-compatible API routes
  lib/
    db/                     # SQLite repositories (agents, tasks, messages)
    agentTools.js           # Tool definitions
  office/                   # Pixel office UI components
  components/               # Dashboard UI
open-sse/                   # Provider translation layer (OpenAI ↔ Claude ↔ Gemini)
```

---

## A2A Protocol

Each agent exposes a standard A2A endpoint:

- `POST /api/agents/{id}/a2a` — JSON-RPC 2.0 (`message/send`, `tasks/get`, `tasks/cancel`)
- `GET /api/agents/{id}/.well-known/agent.json` — agent discovery card

---

## License

MIT
