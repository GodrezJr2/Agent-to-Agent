# A2A Office

A team of AI agents in a pixel office. Every agent is a real **A2A v1** agent, and
all of them think through the **9router** gateway.

- **Local agents** run here. Each one publishes an agent card at
  `/a2a/<agentId>/.well-known/agent-card.json` and serves JSON-RPC at
  `/a2a/<agentId>/`, built on `@a2a-js/sdk` 1.2. Its executor runs an LLM tool
  loop against 9router's `/v1/chat/completions`.
- **External agents** are any A2A v1 server, added by URL. Local agents can
  delegate to them exactly like to a teammate.
- **Delegation** is the `delegate_task` tool. It makes a real A2A call to the
  target agent, including local ones, over the loopback URL. Nesting is capped by
  `AGENT_MAX_DELEGATION_DEPTH`.
- **Org chart**: a `managerId` defines leads and reports. A message without an
  @mention goes to the office lead (the first agent with no manager).
- **Shared workspace**: every office has one folder, `WORKSPACES_DIR/<officeId>`.
  File tools and `bash` are confined to it.
- **Other tools**: `fetch_url`, `web_search` (9router `/v1/search` when
  `SEARCH_PROVIDER` is set, DuckDuckGo otherwise), `remember`/`recall`,
  `send_webhook`, and `schedule_task` (cron).

## Run

```bash
npm install
npm run build                       # web UI → web/dist
GATEWAY_URL=http://localhost:20128/v1 GATEWAY_API_KEY=sk-... DEFAULT_MODEL=<model> npm start
# http://localhost:3100
```

Dev: `npm run dev:server` + `npm run dev:web`. Vite runs on :5173 and proxies
`/api` and `/a2a`. Tests: `npm test`.

## Environment

| Env | Default | |
| --- | --- | --- |
| `PORT` / `HOST` | `3100` / `0.0.0.0` | |
| `PUBLIC_URL` | `http://localhost:3100` | Base URL advertised in agent cards |
| `SELF_URL` | `http://127.0.0.1:3100` | Loopback URL for local A2A calls |
| `GATEWAY_URL` | `http://localhost:20128/v1` | 9router OpenAI-compatible base |
| `GATEWAY_API_KEY` | – | A 9router API key. Required unless the office runs on 9router's own loopback |
| `DEFAULT_MODEL` | – | Used by agents that have no model set |
| `OFFICE_API_KEY` | – | Bearer key for the UI/API and A2A endpoints. **Set it whenever the port is reachable by others**, because agents can run `bash` |
| `SEARCH_PROVIDER` | – | 9router search provider or combo for `web_search` |
| `DATA_DIR` / `WORKSPACES_DIR` | `./data` / `./data/workspaces` | SQLite + workspaces |
| `AGENT_MAX_STEPS` | `25` | Tool-loop steps per task |
| `AGENT_MAX_DELEGATION_DEPTH` | `4` | |
| `BASH_TIMEOUT_MS` | `60000` | |

## Talking to an agent from outside

```ts
import { ClientFactory } from "@a2a-js/sdk/client";
const client = await new ClientFactory().createFromUrl("http://host:3100/a2a/<agentId>/");
```

When `OFFICE_API_KEY` is set, send it as `Authorization: Bearer ...`. Agent cards
stay public for discovery.
