<div align="center">

  <img src="./images/office-preview.png" alt="Agent-to-Agent Office" width="900"/>

  # 🏢 Agent-to-Agent Office

  **A living, breathing AI workspace where agents collaborate, delegate tasks, write code, and think together — in real time.**

  [![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
  [![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
  [![Powered by 9Router](https://img.shields.io/badge/Powered%20by-9Router-orange)](https://github.com/decolua/9router)

  [✨ Features](#-features) • [🚀 Quick Start](#-quick-start) • [🤖 How Agents Talk](#-how-agents-talk-to-each-other) • [🛠️ Tools](#-agent-tools) • [🧪 Tested Models](#-tested-models)

</div>

---

## 🤔 What is this?

Instead of chatting with a single AI, you manage a **team of AI agents** dropped into a retro pixel-art office. Each agent has a name, a role, a personality, and a desk. They talk to each other, delegate tasks, run code, read and write files — all visible in real-time.

Built on top of [9Router](https://github.com/decolua/9router)'s battle-tested LLM routing engine, this project adds a full multi-agent orchestration layer with the [A2A protocol](https://google.github.io/A2A/).

---

## ✨ Features

### 🤖 True Agent-to-Agent Delegation
Agents don't just chat — they actually **call each other**. When a manager agent needs something done, it delegates via `[A2A:AgentName:task]` and the target agent runs its own LLM, executes tools, and replies as a separate bubble.

```
You → @Thinker: tell Kevin to write a summary report
Thinker → [delegates] → Kevin → writes report.md → reports back
```

### 🛠️ Real Tool Execution
Agents don't *pretend* to use tools. They actually:
- **Write and read files** on your filesystem
- **Run bash commands** inside the workspace
- **Search the web** for live information
- **Remember facts** persistently across sessions
- **Schedule cron tasks** to run autonomously later

### 👑 Org Chart Hierarchy
Assign managers and direct reports. Agents know who they report to, who they can delegate to, and who their peers are — context is injected automatically into every prompt.

### 🛋️ Pixel Art Office
A fully interactive 2D office you can customize:
- Place agents at desks, in meeting rooms, the lounge
- Drag and drop furniture
- Multiple office layouts per project

### 💬 @Mention Routing
```
@Kevin write the landing page HTML
@Thinker review Kevin's work and give feedback
```
Direct a specific agent or broadcast to everyone.

### ⚡ 40+ LLM Providers via 9Router
Connect agents to OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, local Ollama — with automatic fallback if one fails.

---

## 🚀 Quick Start

### Docker (recommended)

```bash
git clone https://github.com/GodrezJr2/Agent-to-Agent.git
cd Agent-to-Agent
cp .env.example .env       # set JWT_SECRET and INITIAL_PASSWORD
docker compose up -d
```

Open **http://localhost:20128** → log in → create an Office → add Agents → start chatting.

### From Source

```bash
npm install
npm run build
npm start
```

---

## 🤖 How Agents Talk to Each Other

When an agent wants to delegate, it writes a tag in its reply:

```
[A2A:Kevin:write a file called report.md with a project summary]
```

The system intercepts this, calls Kevin's A2A endpoint (`/api/agents/{id}/a2a`), Kevin runs its own LLM with full tool access and office history, and the response appears as Kevin's own bubble in the chat.

The UI shows `*(asking Kevin...)*` while the delegation is in-flight.

---

## 🛠️ Agent Tools

Every agent has access to these tools out of the box:

| Tool | What it does |
|------|-------------|
| `write_file` | Write a file to the office workspace |
| `read_file` | Read any file from the workspace |
| `list_dir` | List files and folders |
| `bash` | Run shell commands |
| `web_search` | Search the web |
| `fetch_url` | Fetch content from a URL |
| `remember` | Store a key-value fact persistently |
| `recall` | Retrieve a stored fact |
| `grep_file` | Search inside files |
| `delete_file` | Delete a file |
| `generate_file` | Generate a file with AI-written content |
| `schedule_task` | Schedule a cron job for future autonomous execution |

---

## 🧪 Tested Models

All models below confirmed working with tool use and A2A delegation:

| Model | Provider | Notes |
|-------|----------|-------|
| `openrouter/openai/gpt-oss-120b:free` | OpenRouter | Best free model — sharp, reliable |
| `openrouter/nvidia/nemotron-3-super-120b-a12b:free` | OpenRouter | Strong free option |
| `openrouter/minimax-m2.5:free` | OpenRouter | Fast, good for simple tasks |
| `openrouter/z-ai/glm-4.5-air:free` | OpenRouter | Solid bilingual |
| `kr/claude-sonnet-4.5` | Kiro AI | Reliable Anthropic |
| `kr/deepseek-3.2` | Kiro AI | Strong coding |
| `ocg/deepseek-v4-pro` | OpenCode Go | Best for reasoning |
| `ocg/kimi-k2.6` | OpenCode Go | Long context |

**You can run a full multi-agent team for free using OpenRouter free models.**

---

## 🔧 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `20128` | Server port |
| `JWT_SECRET` | — | **Required.** Auth cookie signing secret |
| `INITIAL_PASSWORD` | `123456` | Dashboard login password |
| `DATA_DIR` | `~/.9router/` | SQLite database location |
| `API_KEY_SECRET` | — | Local API key generation secret |

---

## 🐳 Docker Workspace

Agents run tools inside the container. Mount a host directory to persist output files:

```yaml
# docker-compose.yml
volumes:
  - /your/host/path/workspaces:/workspaces
```

Set each Office's **Workspace Path** in settings to the container path (e.g. `/workspaces/my-project`).

---

## 📐 Architecture

```
User message
    ↓
@mention routing → target agent(s)
    ↓
callAgentLLM (stream route)
  → tool-use loop (up to 6 iterations)
  → parse [A2A:Name:task] tags
    ↓
callAgentA2A → POST /api/agents/{id}/a2a (JSON-RPC 2.0)
  → target agent runs own LLM + tool-use loop
  → result streamed back as separate bubble
```

Each agent also exposes a standard A2A discovery card:
```
GET /api/agents/{id}/.well-known/agent.json
```

---

## 💡 Use Cases

- **Software Team in a Box** — Manager breaks features into tasks, Developer writes code, Reviewer checks the diff
- **Research Squad** — Agents browse the web, synthesize findings, write reports to your folder
- **Autonomous Automation** — Use `schedule_task` for nightly agents that check APIs, run tests, generate reports
- **Model A/B Testing** — Assign different LLMs to each agent and compare their approaches side-by-side

---

## 🙏 Credits

Built on top of [9Router](https://github.com/decolua/9router) by [@decolua](https://github.com/decolua) — the best open-source AI router out there.

---

## License

MIT
