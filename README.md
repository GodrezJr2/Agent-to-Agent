<div align="center">
  <img src="./images/office.png" alt="Agent Office Dashboard" width="1000"/>
  
  # 🏢 Agent-to-Agent (A2A) Office
  
  **Stop talking to a blank chatbox. Step into a living, breathing 2D digital workspace where your AI agents collaborate, move, write code, and think together.**
  
  [![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
  
  [🚀 Quick Start](#-quick-start) • [✨ Killer Features](#-killer-features) • [🛋️ Custom Workspaces](#-unlimited-custom-workspaces) • [👑 Role Hierarchy](#-agent-role-hierarchy)
</div>

---

## 🤔 What is this?

**Agent-to-Agent Office** is a revolutionary approach to AI interaction. We took the robust LLM routing engine of **9Router**, combined it with a retro 2D pixel-art environment, and added advanced multi-agent communication logic.

Instead of sending prompts into a void, you hire a team of AI agents, drop them into a virtual office, and watch them work. They have desks, they walk around, they brainstorm in the lounge, and they talk to *each other* to solve your complex problems.

---

## ✨ Killer Features

### 🛠️ Agent Sandbox Workspace
Your agents aren't just chatting; they have their own secure workspace filesystem to actually build things for you. Agents come equipped with tools to:
- **`bash`**: Run terminal commands, compile code, and install packages.
- **`read_file` / `write_file` / `list_dir`**: Read and modify the codebase in real-time.
- **`web_search` & `fetch_url`**: Browse the live internet for documentation and current events.
- **`remember` / `recall` / `schedule_task`**: Agents have persistent memory and can schedule their own cron jobs to run autonomously in the future.

### 👑 Agent Role Hierarchy
Not all agents are created equal. You can assign specific roles and hierarchies to your digital team:
- **The Manager**: Takes your high-level prompt, breaks it down into sub-tasks, and delegates it to the right team members.
- **The Specialists** (Developers, Designers, Thinkers): Receive delegated tasks, execute them using their specialized system prompts, and report back.
- **Peer-to-Peer Review**: Watch agents debate and review each other's code and ideas in real-time before presenting the final result to you.

### 🛋️ Unlimited Custom Workspaces
Every project deserves its own vibe. You aren't limited to a single room:
- **Multiple Offices / Workspaces**: Create unlimited, isolated office instances. Bind an office to a specific local folder (`workspacePath`) so agents can directly edit your real project files safely!
- **Interactive Layout Editor**: Drag and drop furniture, build walls, change floor tiles, and design the ultimate productivity space.
- **Dynamic Assets**: The engine dynamically loads pixel-art assets (plants, coffee machines, computers, couches) at runtime.

### 💬 The "Watercooler" Group Chat
- **Unified A2A Chat**: A master chat interface where you can talk to the whole room.
- **Direct Mentions**: Use `@AgentName` to pull a specific agent into focus while the rest of the room listens for context.
- **Overheard Conversations**: Read the internal dialogues as agents collaborate autonomously.

### 🧠 Powered by 9Router (40+ LLMs)
- **Universal API**: Connect your agents to OpenAI, Anthropic, Gemini, DeepSeek, or local Ollama models.
- **Cost-Effective**: Built-in RTK token saving compresses inputs, saving you 20-40% on API costs.
- **Smart Fallbacks**: If your premium Claude API hits a rate limit, the router automatically fails over to a cheaper model without interrupting the agents' workflow.

### 🗂️ Docker Workspace Setup

Agents run tools (bash, write_file, read_file) inside the container. Mount a host directory so output files persist:

```yaml
# docker-compose.yml
services:
  app:
    volumes:
      - /your/host/path/workspaces:/workspaces
```

Set each Office's **Workspace Path** to the container path (e.g. `/workspaces/My Project`), not the host path.

---

## 💡 Use Cases

- **Software Team in a Box** — Manager agent breaks your feature into tasks, Developer agents write code in the workspace, Reviewer agent checks the diff. All visible in real-time.

- **Research Squad** — Agents with `web_search` + `fetch_url` browse the internet, synthesize findings, and write reports directly to your workspace folder.

- **AI Roleplay / Dungeon Master** — Give each agent a personality and role (Wizard, Rogue, Merchant). They talk to each other while you steer the story with `@mentions`.

- **Cron Automation** — Use `schedule_task` to have agents run nightly: check APIs, generate reports, run tests. Agents have persistent memory across sessions.

- **Model A/B Testing** — Assign different models to agents in one office, give them the same task, and watch how each approaches it differently.

---

## 🧪 Community-Tested Models

Tested via 9Router API (`/v1/chat/completions` with `tools` param). All models below successfully executed agent tool calls (write_file, bash, web_search, etc.):

| Model | Provider | Notes |
|-------|----------|-------|
| `openrouter/openai/gpt-oss-120b:free` | OpenRouter | Best free model — 120B, sharp responses, zero API key |
| `openrouter/nvidia/nemotron-3-super-120b-a12b:free` | OpenRouter | Strong performance, free |
| `openrouter/minimax-m2.5:free` | OpenRouter | Fast, good for simple tasks |
| `openrouter/z-ai/glm-4.5-air:free` | OpenRouter | Solid Chinese/English bilingual |
| `kr/claude-sonnet-4.5` | Kiro AI | Reliable Anthropic model |
| `kr/deepseek-3.2` | Kiro AI | Strong coding performance |
| `kr/qwen3-coder-next` | Kiro AI | Coding specialist |
| `ocg/deepseek-v4-pro` | OpenCode Go | Recommended for reasoning tasks |
| `ocg/kimi-k2.6` | OpenCode Go | Long context, good memory |
| `ocg/glm-5.1` | OpenCode Go | Strong multilingual |

**7 of 7 tested free OpenRouter models support tool calling.** Your agents can work at zero cost.

---

## ⚡ Quick Start (Docker Compose)

Deploy your virtual office in 3 minutes flat.

```bash
# 1. Clone the repository
git clone https://github.com/GodrezJr2/Agent-to-Agent.git
cd Agent-to-Agent

# 2. Setup Environment
cp .env.example .env
# Edit .env to set your INITIAL_PASSWORD and JWT_SECRET

# 3. Start the application
docker compose up -d
```

The workspace will be available at `http://localhost:20128`.

---

## 🔧 Running from Source

```bash
# Install dependencies
npm install

# Build the Next.js application
npm run build

# Start the server
npm run start
```

---

## 🎨 Customizing the Game Assets

You can deeply customize the visual look of your office by modifying the assets in the `public/assets/` directory.

- **Furniture**: Add new pixel-art furniture by placing PNG sprites and a `manifest.json` inside `public/assets/furniture/<ITEM_NAME>/`.
- **Characters**: Replace agent avatars by updating the sprite sheets in `public/assets/characters/`. Each character sheet requires specific walk/type/read animation frames.
- **Floors & Walls**: Add new tilesets to `public/assets/floors/` and `public/assets/walls/`.

---

## 🔐 Environment Variables & Privacy

**This project is Local-First.** Your chats, office layouts, and databases are stored locally in SQLite. No data is sent to central tracking servers.

Key variables in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | `change-me` | Secret for signing auth cookies. **Must change.** |
| `INITIAL_PASSWORD` | `123456` | Default login password. **Must change.** |
| `DATABASE_URL` | `file:./data/data.sqlite` | Path to the SQLite database. |
| `API_KEY_SECRET` | `change-me` | Secret for local API key generation. |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:20128` | The URL the app is accessed from. |

---

## 🙏 Attributions & Open Source Credits

This project stands on the shoulders of giants and is a combination of several incredible open-source repositories:

- **[9Router](https://github.com/decolua/9router)**: Provided the robust LLM routing backend, provider management, RTK token saving, and the base dashboard UI framework.
- **[pixel-agents](https://github.com/pablodelucca/pixel-agents)**: Provided the beautiful 2D pixel-art assets, character sprites, and isometric office environment inspiration.
- **[A2A (Agent-to-Agent)](https://github.com/a2aproject/A2A)**: Inspired the multi-agent communication architecture and group chat interaction flows.

This project is licensed under the MIT License. See the `THIRD_PARTY_NOTICES.md` and `LICENSE` files for detailed license information and copyrights of the upstream projects.