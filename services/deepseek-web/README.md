# deepseek-web-api

OpenAI-compatible API in front of the **chat.deepseek.com web app**. It handles the
web app's chat-session chaining, proof-of-work challenge (WASM solver), SSE parsing,
and text-based tool-call detection, and exposes the result as plain
`/v1/chat/completions`.

It used to live inside the 9router engine as the `deepseek-web` provider executor.
It now runs as its own container, so the engine can track upstream 9router with
no fork patches.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Liveness |
| `GET` | `/v1/models` | `instant`, `expert`, `-deepthink`, `-search` combos, plus `-agentic` variants |
| `POST` | `/v1/chat/completions` | OpenAI chat format, `stream: true` supported, `tools` supported |
| `GET` | `/v1/token/check` | Validates the bearer token against DeepSeek |

Model flags:
- `instant` / `expert`: the DeepSeek web model type.
- `-deepthink`: turns reasoning on. Reasoning streams back as `reasoning_content`.
- `-search`: turns web search on.
- `-agentic`: prepends a chunked-write protocol for coding agents.

## Auth

The caller's `Authorization: Bearer <token>` **is the DeepSeek web token**. To get
one, open chat.deepseek.com, go to DevTools → Network, pick any `/api/v0/...`
request, and copy the `authorization` header value without the `Bearer ` part.

For standalone use without exposing the token, set both `DEEPSEEK_TOKEN` and
`ACCESS_KEY`. Callers then send `Bearer <ACCESS_KEY>`.

| Env | Default | |
| --- | --- | --- |
| `PORT` | `8790` | |
| `HOST` | `0.0.0.0` | |
| `DEEPSEEK_TOKEN` | – | Fallback token |
| `ACCESS_KEY` | – | Required bearer when `DEEPSEEK_TOKEN` is set |
| `MAX_BODY_BYTES` | 20 MB | |

## Using it from 9router

In the 9router dashboard:
1. Go to Providers → Add OpenAI Compatible, and set:
   - Name: `DeepSeek Web`
   - Prefix: `dsw`
   - API type: Chat
   - Base URL: `http://deepseek-web:8790/v1`
2. Add one connection per DeepSeek account, with the web token as the API key.
   9router handles account rotation and fallback.
3. Call it as `dsw/expert-deepthink`, `dsw/instant-agentic`, and so on.

## Develop

```bash
npm install
npm test          # vitest
npm start         # http://localhost:8790
```
