<div align="center">

  <img src="./images/demo.gif" alt="Agent-to-Agent Office Demo" width="900"/>

  # 🏢 Agent-to-Agent Office

  **A team of AI agents in a pixel-art office. They delegate, write code and run tools, talking to each other over the real A2A v1 protocol, with 9Router as the AI gateway behind all of them.**

  [![GitHub stars](https://img.shields.io/github/stars/GodrezJr2/Agent-to-Agent?style=social)](https://github.com/GodrezJr2/Agent-to-Agent/stargazers)
  [![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
  [![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
  [![A2A Protocol v1](https://img.shields.io/badge/A2A-v1.0-6f42c1)](https://a2a-protocol.org/)
  [![Powered by 9Router](https://img.shields.io/badge/Powered%20by-9Router-orange)](https://github.com/decolua/9router)
  [![Inspired by Pixel Agents](https://img.shields.io/badge/Inspired%20by-Pixel%20Agents-brightgreen)](https://github.com/pablodelucca/pixel-agents)

  [✨ Features](#-features) • [🚀 Quick Start](#-quick-start) • [📐 Architecture](#-architecture) • [🤖 How Agents Talk](#-how-agents-talk-to-each-other) • [🛠️ Tools](#-agent-tools) • [📡 A2A Protocol](#-a2a-protocol) • [🐋 DeepSeek Web API](#-deepseek-web-api)

</div>

---

## ✅ Proof it works

A live run on the self-hosted stack. Maya (lead) delegates to Kevin over A2A, Kevin writes the file, Maya verifies it:

```
user       Ask Kevin to create hello.html: a minimal HTML page with an h1 saying Hello from A2A. Then confirm the file exists.
delegation Maya → Kevin: Create a minimal HTML page called hello.html in the office workspace…
tool       Kevin  write_file(hello.html)
agent      Kevin: Created `hello.html` in the workspace root with an `<h1>Hello from A2A</h1>` element.
tool       Maya   read_file(hello.html)
tool       Maya   list_dir(.)
agent      Maya:  `hello.html` created and confirmed.
```

The file is **actually on disk**. Agents don't simulate tool use; they execute it.

---

## 🤔 What is this?

Instead of chatting with a single AI, you manage a **team of AI agents** in a retro pixel-art office. Each agent has a name, a role, a model and a desk. They delegate to each other, run code, and read and write files in a shared workspace, and you watch all of it live.

This repo holds three services:

| Service | Path | What it is |
| --- | --- | --- |
| **Office** | [`services/office`](services/office) | The A2A v1 multi-agent office: UI + agents |
| **9Router gateway** | repo root | Fork of [9Router](https://github.com/decolua/9router), tracked close to upstream. Routes every agent's LLM call across 40+ providers with fallback |
| **DeepSeek Web API** | [`services/deepseek-web`](services/deepseek-web) | Wraps chat.deepseek.com as an OpenAI-compatible API |

---

## ✨ Features

### 🤖 Real A2A v1 agents
Every agent is a standards-compliant **A2A v1** server, built on the official `@a2a-js/sdk`. Each one has its own agent card and JSON-RPC endpoint. Delegation is a real A2A call too, so an agent in your office and an external A2A agent on another server are interchangeable.

### 🛠️ Real tool execution
Agents don't *pretend* to use tools. They:
- **write, edit and read files** in the office workspace
- **run bash** (builds, tests, git, scripts)
- **search and fetch** the web
- **remember** facts across conversations
- **schedule** their own recurring work with cron
- **notify** Discord, Slack or any webhook

### 👑 Org chart
Set a manager for each agent. Leads get delegation instructions and a list of their reports. A message without an @mention goes to the office lead.

### 💬 @mention routing
```
@Kevin write the landing page HTML
@Maya review Kevin's work
```

### 🛋️ Pixel-art office
A live 2D office based on [Pixel Agents](https://github.com/pablodelucca/pixel-agents) art. Agents light up when they think, use tools or delegate.

### ⚡ 40+ LLM providers via 9Router
Give each agent any model or **combo** from 9Router: OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Kiro, local LM Studio/Ollama and more. When a provider fails, the combo falls back automatically.

---

## 🚀 Quick Start

```bash
git clone https://github.com/GodrezJr2/Agent-to-Agent.git
cd Agent-to-Agent
cp .env.example .env            # 9Router: set JWT_SECRET and INITIAL_PASSWORD
cat > office.env <<'EOF'
OFFICE_API_KEY=<long random string>
GATEWAY_API_KEY=
DEFAULT_MODEL=
PUBLIC_URL=http://localhost:3100
EOF
docker compose up -d
```

1. Open **http://localhost:20128** (9Router), log in, connect a provider, and create an **API key**.
2. Put that key in `office.env` as `GATEWAY_API_KEY` and pick a `DEFAULT_MODEL` (a model id or a combo name). Then run `docker compose up -d office`.
3. Open **http://localhost:3100** (Office) and enter your `OFFICE_API_KEY`. Create an office, hire a lead, then hire reports under the lead.

First thing to try:
```
Ask Kevin to create hello.html with an h1 saying hi, then confirm the file exists.
```

---

## 📐 Architecture

```
            ┌────────────── Office :3100 ───────────────┐
 Browser ──►│ UI (Vite/React) ── REST + SSE ── Office API │
            │                                              │
 External ─►│ /a2a/<agent>/  A2A v1 JSON-RPC + agent card  │◄── other A2A agents
 A2A client │     │                                        │
            │  AgentExecutor: LLM tool loop ─ delegate_task ┼──► A2A call to another agent
            └─────┼────────────────────────────────────────┘
                  │ OpenAI-compatible /v1/chat/completions
            ┌─────▼──────── 9Router :20128 ────────────────┐
            │ combos · fallback · account rotation · usage  │──► OpenAI, Anthropic, Gemini, …
            └─────┬────────────────────────────────────────┘
                  │ openai-compatible provider node
            ┌─────▼─────── deepseek-web :8790 ─────────────┐
            │ chat.deepseek.com → OpenAI API (PoW, SSE, tools)│
            └───────────────────────────────────────────────┘
```

- An office's state lives in SQLite (`office-data/`). Each office has one shared workspace folder, and agents' file and bash tools are confined to it.
- The gateway stays close to upstream 9Router, which keeps upstream syncs cheap.

---

## 🤖 How Agents Talk to Each Other

A lead gets a `delegate_task` tool:

```json
{ "agent": "Kevin", "task": "Write hello.html with an h1 saying Hello from A2A" }
```

The office turns that into an **A2A `SendStreamingMessage`** to Kevin's endpoint. Kevin runs his own LLM tool loop and streams `working` status updates, then returns his answer as a task artifact. That artifact becomes the tool result in Maya's loop. A delegation depth limit carried in message metadata stops agents from delegating in endless loops.

Remote agents work the same way. Add one by its A2A URL and your agents can delegate to it by name.

---

## 🛠️ Agent Tools

| Tool | What it does |
|------|-------------|
| `read_file` / `write_file` / `edit_file` | Work with files in the office workspace |
| `list_dir` / `grep` / `delete_file` | Browse, search and clean up |
| `bash` | Run shell commands in the workspace (git, python, node available) |
| `fetch_url` | Fetch a page or API as text |
| `web_search` | Search via 9Router `/v1/search` (set `SEARCH_PROVIDER`) or DuckDuckGo |
| `remember` / `recall` | Long-term per-agent memory |
| `delegate_task` | Hand work to another agent over A2A |
| `send_webhook` | Notify Discord, Slack or any webhook |
| `schedule_task` | Schedule a recurring prompt with cron |

You can enable or disable tools per agent.

---

## 📡 A2A Protocol

Every local agent is an A2A v1 server:

```
GET  /a2a/<agentId>/.well-known/agent-card.json      # discovery (public)
POST /a2a/<agentId>/                                 # JSON-RPC: SendMessage, SendStreamingMessage, GetTask, ListTasks, CancelTask
```

```ts
import { ClientFactory } from "@a2a-js/sdk/client";
const kevin = await new ClientFactory().createFromUrl("http://localhost:3100/a2a/<agentId>/");
```

When `OFFICE_API_KEY` is set, A2A calls need `Authorization: Bearer <key>`. Agent cards stay public so other agents can discover yours.

---

## 🐋 DeepSeek Web API

[`services/deepseek-web`](services/deepseek-web) turns a chat.deepseek.com login into an OpenAI-compatible API. It handles:
- chat-session chaining
- the web app's proof-of-work challenge
- streaming reasoning
- tool calls

Models: `instant` / `expert`, each with optional `-deepthink`, `-search` and `-agentic`.

To use it in 9Router, add an **OpenAI Compatible** provider:
- base URL: `http://deepseek-web:8790/v1`
- API key: your DeepSeek web token (one connection per account)

---

## 🔧 Environment Variables

**Office** (`office.env`): `OFFICE_API_KEY`, `GATEWAY_API_KEY`, `DEFAULT_MODEL`, `PUBLIC_URL`, `SEARCH_PROVIDER`, `AGENT_MAX_STEPS`, `AGENT_MAX_DELEGATION_DEPTH`. The full list is in [services/office/README.md](services/office/README.md).

**9Router** (`.env`): `JWT_SECRET` (required), `INITIAL_PASSWORD` (default `123456`, so change it), `API_KEY_SECRET`, `DATA_DIR`. See `.env.example`.

> ⚠️ Agents can run `bash`. Always set `OFFICE_API_KEY` when port 3100 is reachable by anyone but you.

---

## 💡 Use Cases

- **Software team in a box**: the lead splits a feature into tasks, an engineer writes the code, a reviewer checks it
- **Research squad**: agents browse the web, synthesize what they find, and write reports to the workspace
- **Autonomous automation**: scheduled agents check APIs, run tests and post to Discord
- **Model A/B testing**: give each agent a different model or combo and compare the results
- **Cross-system agents**: plug in external A2A agents and let your team delegate to them

---

## 🙏 Credits

- [9Router](https://github.com/decolua/9router) by [@decolua](https://github.com/decolua): the AI gateway underneath
- [Pixel Agents](https://github.com/pablodelucca/pixel-agents): pixel office concept and art
- [A2A Protocol](https://a2a-protocol.org/) and [`@a2a-js/sdk`](https://github.com/a2aproject/a2a-js)

---

## License

MIT
