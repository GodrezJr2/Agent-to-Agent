# Unreleased

## Fixes
- Anthropic-compatible providers: strip Claude Code `context_management` before forwarding to gateways that reject unknown top-level fields (#1468)

# v0.4.66-fork.2 (2026-06-01)

## Agentic Reliability — Root Cause Fixes

This release addresses a set of compounding issues that caused context window exhaustion, silent failures, and broken tool flows during long agentic coding sessions (Claude Code, Codex, and other agentic clients routed through 9router).


### Context Window & Token Efficiency

- **Reasoning blob accumulation eliminated** — OpenAI/Codex reasoning models (GPT-4.5, GPT-5.x, o3, o4) attach `reasoning_content` summaries to every assistant turn. With `store=false`, these blobs are unverifiable by the server yet consumed context tokens on every subsequent request, causing O(n²) growth across long sessions. Reasoning items are now stripped before forwarding. Estimated **50–80% reduction in input tokens** for reasoning-model agentic sessions with 20+ tool calls. *(upstream PR [#1599](https://github.com/decolua/9router/pull/1599))*

### Proxy Infrastructure

- **10 MB body limit raised to 128 MB** — Next.js silently truncated requests exceeding 10 MB, returning `"Invalid JSON body"` while logging success. Long agentic sessions with many tool results easily hit this limit. Now configurable via `NEXT_MAX_BODY_SIZE` env var (default `128mb`). *(fixes [#1529](https://github.com/decolua/9router/issues/1529), [#1572](https://github.com/decolua/9router/issues/1572))*

- **Stream stall and connect timeouts are now configurable** — `STREAM_STALL_TIMEOUT_MS` and `FETCH_CONNECT_TIMEOUT_MS` were hardcoded, causing premature disconnects on slow-streaming models (Kiro, large reasoning models). Both are now readable from env vars with a minimum floor guard (5 s / 3 s). *(fixes [#1557](https://github.com/decolua/9router/issues/1557))*

### Claude OAuth (`cc/`) Route Fixes

- **Forced `tool_choice` no longer returns 400** — Two bugs in `openai-to-claude.js` and `claudeCloaking.js` caused `{type:"function", function:{name}}` shaped `tool_choice` payloads to fail: (1) the `"function"` type was forwarded verbatim instead of being translated to Claude's `"tool"` type, and (2) `cloakClaudeTools` applied the `_ide` suffix to tool declarations but not to `tool_choice.name`, so the forced tool no longer matched any declaration. Both are fixed. *(fixes [#1592](https://github.com/decolua/9router/issues/1592))*

- **`role: "system"` in messages no longer causes 400** — The Anthropic API rejects `role: "system"` inside the `messages` array; system content must be the top-level `system` field. `prepareClaudeRequest` now promotes any lingering system/developer-role messages to the top-level `system` field as a safety net for both the passthrough path and any translation edge cases. Eliminates the constant fallback from `cc/claude-sonnet-4-6` to Kiro in combos. *(fixes [#1580](https://github.com/decolua/9router/issues/1580))*

### Provider-Specific Fixes

- **DeepSeek: tool count capped at 8** — DeepSeek returns near-empty responses (~25 tokens) when given 10+ tools, while reporting HTTP 200 and causing silent combo failures. Claude Code natively sends 10–15 tools; OpenCode CLI works because it sends 3–5. A `maxTools: 8` cap per DeepSeek model truncates the tool list before dispatch, keeping the core agentic tools (Bash/Read/Edit/Write/Glob/Grep + 2) and dropping the rest. An observable `[TOOLS] cap` log line is emitted when truncation occurs. *(ref [#1382](https://github.com/decolua/9router/issues/1382))*

- **Antigravity/Gemini: invalid tool schema property values fixed** — Claude Code tool schemas sometimes define properties as plain type strings (e.g. `"field": "object"` shorthand instead of `"field": {"type":"object","properties":{}}`). Vertex AI rejected these with a 400 on all Antigravity models. A new `fixInvalidPropertyValues` phase in `cleanJSONSchemaForAntigravity` converts string-shorthand property values to proper schema objects before translation. *(fixes [#1564](https://github.com/decolua/9router/issues/1564))*

## Fork Guardrails

- Preserved all Agent-to-Agent / Office / A2A / cron / memory custom features.
- All fixes submitted upstream as PR [#1599](https://github.com/decolua/9router/pull/1599) and PR [#1600](https://github.com/decolua/9router/pull/1600).

---

# v0.4.66-fork.1 (2026-05-31)

## Targeted upstream backports
- GitHub Copilot: prevent Gemini/Claude models from being escalated to `/responses`, preserving the real `/chat/completions` error instead of misleading `unsupported_api_for_model` responses.
- OpenCode: inject required `reasoning_content` placeholders for DeepSeek/Kimi thinking follow-up turns and make model matching case-insensitive.
- Suggested models: include OpenCode free models that do not use the `-free` suffix.
- Provider tests: add connection probes for OpenCode Go, Xiaomi MiMo, Xiaomi Token Plan, and Qoder device-token userinfo.
- Models: add Claude Opus 4.8, GPT 5.4 Mini, and DeepSeek V4 Flash/Pro entries.

## Fork guardrails
- Preserved Agent-to-Agent README and did not import upstream README changes.
- Preserved Office / Agent OS / A2A / cron / memory custom features.
- Preserved local `STREAM_STALL_TIMEOUT_MS = 10 * 60 * 1000` instead of upstream 30s stall timeout.
- Deferred full Qoder COSY/OAuth provider rewrite to avoid broad conflicts with fork features.

---

# v0.4.63-fork.1 (2026-05-28)

## Targeted upstream backports
- OpenAI-compatible providers: fallback `response_format: json_schema` to `json_object` with schema instructions for backends that reject strict JSON schema.
- Codex: normalize Responses API bodies, strip stored item references with `store=false`, stabilize prompt cache/session headers, and retry overloaded SSE responses.
- Reliability: add upstream fetch connect timeout while preserving fork 10-minute stream stall timeout for silent-thinking models.
- Streams: close gracefully on abort/socket-reset style disconnects instead of surfacing client-visible stream errors.
- Auth: add login lockout and direct Codex refresh-token dedup/recent-result reuse to avoid rotating token reuse.
- Embeddings: forward Gemini `dimensions` as `outputDimensionality`.

## Fork guardrails
- Preserved Office / Agent OS / A2A / cron / memory custom features.
- Preserved DeepSeek Web provider/parser/wasm/tests.
- Preserved local `STREAM_STALL_TIMEOUT_MS = 10 * 60 * 1000` instead of upstream 35s stall timeout.

---

# v0.4.55 (2026-05-21)

## Fork-specific fixes
- Build: remove invalid `GET_DEFAULTS` export from pricing route (Next.js 16 strict route type check)
- Build: add `typescript.ignoreBuildErrors` to next.config.mjs to handle JS route type mismatches from upstream
- Office: add inline edit button for scheduled cron jobs / pipelines (schedule, prompt, pipeline steps)
- DeepSeek Web: full tool-call parser with parallel call fix, PowerShell hint, history truncation, Skill blocking
- Merge: upstream v0.4.55 — Kiro live models, openai-to-kiro translator, blackbox provider, security hardening

---

# v0.4.55 (2026-05-18)

## Features
- Xiaomi MiMo Token Plan: region selector (Singapore / China / Europe) — keys are cluster-specific
- Antigravity: risk confirmation dialog before first connection
- Gemini CLI: surface upstream retry delay on 429 errors

## Fixes
- MITM: cannot kill process on macOS under sudo (lsof not found in PATH)
- Stream: false-positive stall timeout on Claude reasoning / Kiro responses
- Tunnel: cannot re-enable after disable (stuck state)
- Tunnel: cloudflared error messages now include log tail for easier debugging
- Language switcher: applies selected locale immediately on close (#1234)
- Antigravity OAuth: metadata now matches the official client

## Improvements
- Gemini CLI: bump engine to 0.34.0
- Re-hide `qwen` (OAuth EOL) and `iflow` (not ready) providers

# v0.4.52 (2026-05-17)

## Features
- Add Vercel AI Gateway provider support (#1183)
- rtk: Kiro format tool result compression — handle conversationState.history & currentMessage, preserve error results, ~13.6% savings (#1194)

## Fixes
- openclaw: normalize agent.model object form `{primary, fallbacks}` before .startsWith → fix TypeError & 'not configured' status (#1216)
- Usage Details pagination: stay inside mobile viewport <640px (#1218)
- Fix test model error
- Fix MIMO provider in Codex
- Disable log file creation when using MITM AG

# v0.4.50 (2026-05-16)

## Fixes
- Fix duplicate tray icon on macOS when hiding to tray
- Fix tray not showing in background mode on macOS
- Fix hide to tray broken on Windows/Linux
- Fix Shutdown button in web UI not working

# v0.4.49 (2026-05-16)

## Features
- Add Kiro provider support: full request/response translation, live model listing, reasoning content support
- Add `buildOutput` RTK filter with autodetect for npm/yarn/cargo build logs
- Add MITM warning notification in tray and dashboard

## Improvements
- Add modalities (input/output) to model configuration for OpenCode
- Fix tray hide-to-tray: keep current process alive instead of spawning detached child (fixes macOS NSStatusItem ghost icon)
- Fix tray kill: graceful shutdown with SIGTERM/SIGKILL escalation
- Fix SIGHUP handling so macOS terminal close doesn't kill tray process
- Hide deprecated providers (qwen, iflow, antigravity)
- Update i18n across 32 languages

## Fixes
- Fix model check (test-models) blocked by dashboardGuard: pass machineId-based CLI token in internal self-calls

# v0.4.46 (2026-05-15)

## Breaking Changes
- Tunnel public URL changed — old tunnel links no longer work, please reconnect to get the new URL

# v0.4.44 (2026-05-15)

## Features
- Add Blackbox provider with `bb` alias (#1143)
- Add Xiaomi token plan provider
- Enhance model select modal UX + modal traffic lights (#1111)
- Default Usage dashboard period to Today (#1141)

## Fixes
- Fix Cowork model selection and Windows CLI packaging (#1129)
- Update provider name retrieval for compatibility provider (#1135)
- Update JWT_SECRET handling

# v0.4.41 (2026-05-14)

## Features
- Add jcode CLI tool integration with auto-configuration (#1047)
- Redesign CLI Tools dashboard: grid layout (1/2/3 cols) + dedicated detail page per tool
- Add drag-and-drop reordering for combo models (#1108)
- Add Today period option to Usage & Analytics (#1063)
- Add DeepSeek V4 Pro effort aliases (#950)

## Fixes
- fix(autostart): work on nvm + npm 9/10, actually register with launchctl (#1104, fixes #1082)
- Fix Ollama usage not tracked/shown in UI (#1102)
- fix(opencode): preserve DeepSeek reasoning content (#1099, fixes #1093)
- Fix TUI input lag (replace enquirer with native readline, persistent raw mode)
- fix(ui): show API key row actions on mobile (#1112)

## Improvements
- Sync DeepSeek TUI card style with other CLI tools (badges, layout, manual config modal)
- Add official logos for Amp CLI, jcode, Qwen Code (replace generic icons)
- Resize deepseek-tui icon 1024→128 with padding for visual consistency

# v0.4.39 (2026-05-14)

## Fixes
- fix(docker): restore `/app/server.js` (v0.4.38 regression)

# v0.4.38 (2026-05-13)

## Features
- Add DeepSeek TUI as CLI tool in dashboard (#1088)

## Fixes
- Fix broken Docker image in v0.4.36/v0.4.37 (#1096, #1097)

## Improvements
- Clean Docker tags + clearer pulls badge

# v0.4.37 (2026-05-13)

## Improvements
- Security hardening — upgrade recommended

# v0.4.36 (2026-05-13)

## Features
- Add MiniMax TTS provider support (#1043)
- Docker images now published on both Docker Hub (`decolua/9router`) and GHCR — pull from your preferred registry

## Improvements
- Replace browser confirm dialogs with custom ConfirmModal (#1060)

## Fixes
- Fix Docker `Cannot find module 'next'` error in standalone build
- Restore /app/server.js in Docker standalone build (#1064, #1067)
- Fix CLI TUI menu arrow-key escape sequences leaking (^[[A^[[B)
- Switch macOS/Linux tray to systray2 fork (fixes Kaspersky AV false-positive) (#1080)
- Fix zoom controls contrast in topology view (#1066)

# v0.4.33 (2026-05-12)

## Improvements
- Windows: replace systray (Go binary, AV flagged) with native PowerShell NotifyIcon
- Auto-cleanup legacy `tray_windows.exe` on install/startup

# v0.4.31 (2026-05-12)

## Features
- OIDC dashboard login: Authentik/Keycloak/Google/Okta SSO with password-only, OIDC-only, or both modes (#1020)
- Linux/arm64 Docker image support (#979)
- Codex GPT 5.5 image support (#991)
- Done button in ModelSelectModal during combo creation (#1031)
- CLI: reset auth mode to password (emergency OIDC lockout recovery)

## Fixes
- DATA_DIR: graceful fallback to ~/.9router on EACCES/EPERM (#1005)
- React hooks: variable declaration order & lazy initialization (#1017)

## Improvements
- Profile page: OIDC settings card collapsed by default to reduce clutter
- Header: user pill only shown when logged in via OIDC

# v0.4.30 (2026-05-11)

## Features
- MCP stdio→SSE bridge: expose local stdio MCP plugins over SSE (api/mcp/[plugin]/sse, /message)
- Dynamic Linux cert resolution + NSS DB injection (Debian/Arch/Fedora/openSUSE, Chrome/Chromium/Firefox incl. snap) (#1010)
- Cowork tool: expanded settings UI & API
- GitBook docs (DocsContent, DocsLayout)

## Fixes
- OAuth callback postMessage scoped to expected origins (CWE-1385) (#998)
- Re-enable TLS verification on DNS-bypass fetch (CWE-295) (#998)
- Normalize `developer` role → `system` for OpenAI-format providers (Deepseek, Groq, …) (#1011, closes #773)
- Respect `PORT` env in internal model-test fetch (#1014)
- Dropdown text readability in dark theme on usage page (#997)

## Improvements
- Refactor Claude CLI spoof headers into shared constant
- Tool deduper utility in open-sse handlers

# v0.4.29 (2026-05-10)

## Features
- Add Cline & Kilo Code tool cards
- Tailscale TUN mode for stable Funnel TLS
- Sort APIKEY providers by usage, collapse to top 20

## Improvements
- Local Material Symbols font (no Google Fonts)
- Docker base: Bun → Node 22-alpine
- MITM reads aliases from JSON cache (no native sqlite)
- Stream stall timeout (3 min) in open-sse

## Fixes
- Fal.ai key test: use stable models endpoint

# v0.4.28 (2026-05-10)

## Features
- Add bun:sqlite adapter with automatic runtime detection (Bun/Node)
- Add bulk API key import (format: `name|sk-key`, one per line)

## Fixes
- Fix add API key for custom providers

# v0.4.27 (2026-05-09)

## Features
- Add 3-tier DB driver fallback: better-sqlite3 → node:sqlite (Node ≥22.5) → sql.js

## Fixes
- Fix authentication logic for several providers

# v0.4.25 (2026-05-09)

## Features
- Add MCP Marketplace Modal to Cowork Tool Card for easier plugin management
- Migrate DB layer from lowdb to SQLite with modular repos pattern (better-sqlite3 / sql.js adapters, migrations, helpers)
- Add Tailscale tunnel integration with status check API
- Add `/api/cli-tools/all-statuses` aggregated endpoint
- Add Cloudflare Workers AI image generation support (#973)
- Add DeepSeek V4 Pro model and update V4 pricing (#938)
- Add captain-definition for Caprover deployment (#954)

## Improvements
- Optimize slow page load performance
- Refactor connection proxy configuration logic (#970)

## Fixes
- Prevent cached settings responses (#951)
- Normalize Ollama Local provider input (#955)

## Docs
- Add Chinese translation of README (#957)
- Fix localized README links (#956)

# v0.4.20 (2026-05-07)

## Features
- Add CommandCode provider support

# v0.4.19 (2026-05-07)

## Features
- Add OllamaLocalExecutor cho local Ollama provider
- Add audio input support cho Gemini translation
- Add configurable tunnel transport protocols
- Add model deselection trong ComboFormModal & ComboDetailPage
- ComboFormModal/BaseUrlSelect: cloud endpoint option, custom URL local state, default first option
- New API: `/v1/audio/voices`, `/v1/models/info`; `/v1/models` filter disabled models
- CLI tool cards refactor dùng BaseUrlSelect

## Fixes
- Fix compatible provider API key setup
- Fix usage: filter `totalRequests` theo time period đã chọn
- Fix Kiro IDE MITM handler bugs (AWS CodeWhisperer translation)
- geminiHelper: `ensureObjectType` cho schemas có properties nhưng thiếu type
- initializeApp: guard tunnel/tailscale auto-resume once-per-process

# v0.4.18 (2026-05-05)

## Features
- Speech-to-Text: full pipeline with sttCore + /v1/audio/transcriptions; configs for OpenAI, Gemini, Groq, Deepgram, AssemblyAI, HuggingFace, NVIDIA Parakeet; new 9router-stt skill
- Gemini TTS: dedicated provider with 30 prebuilt voices
- Usage quotas: GLM (intl/cn) and MiniMax (intl/cn) fetchers; Gemini CLI usage via retrieveUserQuota per-model buckets
- Disabled models: lowdb-backed disabledModelsDb + /api/models/disabled route
- Header search: reusable Zustand store wired into Header
- CLI tools: Claude Cowork tool card + cowork-settings API
- Providers: mediaPriority sorting in getProvidersByKind, add Kimi K2.6

## Improvements
- Expand media-providers/[kind]/[id] page; enhance OAuthModal, ModelSelectModal, ProviderTopology, ProxyPools, ProviderLimits
- Refresh provider icons (alicode, byteplus, cloudflare-ai, nvidia, ollama, vertex, volcengine-ark); add aws-polly, fal-ai, jina-ai, recraft, runwayml, stability-ai, topaz, black-forest-labs
- Reorder hermes provider, drop qwen STT kind

## Fixes
- Fix skills metadata/text in 9router, chat, embeddings, image, tts, web-fetch, web-search SKILL.md and skills page

# v0.4.16 (2026-05-04)

## Features
- Skills system: manage and execute custom AI skills

## Fixes
- Fix input fields in tool cards

# v0.4.14 (2026-05-03)

## Improvements
- Token refresh: in-flight request caching to prevent race conditions & reduce duplicate API calls
- Token refresh: handle unrecoverable errors with token reuse/invalidation
- MITM server: handle port 443 conflicts (kill occupying process before start)
- Better UX feedback in MitmServerCard for port conflicts & admin privileges
- Refactor ComboList for streamlined media provider combos display

# v0.4.13 (2026-05-03)

## Features
- Add Azure OpenAI as dedicated provider (endpoint/deployment/API version/organization config)
- Add browser-local endpoint presets for CLI tools (Claude, Codex, OpenCode, Droid, OpenClaw, Hermes, Copilot)
- Add Codex review model quota support
- Add DNS tool state persistence in MITM manager

## Improvements
- New brand color palette with better light/dark theme consistency
- Improve mobile layouts and restore Cloudflare provider
- Improve zh-CN translations
- Better admin privilege feedback in MitmServerCard
- Refined APIPageClient layout
- Filter LLM combos to show only relevant data

## Fixes
- Include alias-backed models in /v1/models listing
- Improve cloudflared exit code error messages
- Redirect ~/.9router to DATA_DIR in Docker (persist usage across updates)
- Prevent SSE listener leak in console-logs stream
- Gate MITM sudo prompts on server platform
- Fix Azure validation and persistence (providerSpecificData, Organization required)

# v0.4.12 (2026-05-01)

## Features
- Add Xiaomi MiMo provider support
- Add sticky round-robin strategy for combos

## Improvements
- Refactor proxyFetch and enhance MediaProviderDetailPage layout
- Improve dashboard responsive layouts
- Update provider models list

## Fixes
- Fix custom provider prefix conflicts with built-in alias
- Strip output_config for MiniMax requests

# v0.4.11 (2026-04-30)

## Features
- Add Caveman feature: terse-style system prompts to reduce output token usage with configurable compression levels
- Add Caveman settings UI in Endpoint dashboard (enable/disable, compression level)

## Improvements
- Consolidate AntigravityExecutor function declarations for Gemini compatibility
- Clean up translator initialization logs across API routes

# v0.4.10 (2026-04-29)

## Features
- Add new embedding models and Voyage AI provider support
- Add Coqui, Inworld, Tortoise TTS providers
- Add Deepgram and Inworld TTS voices API endpoints

## Improvements
- Enhance MITM Antigravity handler with improved cert install and DNS config
- Refactor TTS handling to support additional providers
- Improve API key validation for media providers
- Enhance MITM logger with better diagnostics
- Add Windows elevated permissions support for MITM

## Fixes
- Fix Antigravity MITM connection and handler issues
- Fix cloudflared tunnel integration with MITM

# v0.4.8 (2026-04-28)

## Features
- Add Web Search & Web Fetch providers with Combo support — chain multiple search/fetch providers as a single virtual provider
- Add Cloudflare AI provider support
- Add provider filter and expiry sorting to quota dashboard (#769)

## Improvements
- Proxy-aware token refresh across executors (Antigravity, Base, Default, Github, Kiro)

## Fixes
- Fix granular `reasoning_effort` handling for Claude models on Copilot & Anthropic backend (#791)
- Fix Antigravity INVALID_ARGUMENT errors and Copilot agent mode parity
- Fix quota reset timestamp parsing (#768)

# v0.4.6 (2026-04-25)

## Features
- Add BytePlus Provider
- Add Codex support to image providers
- Enhance image and embedding provider support

## Improvements
- Cap maximum cooldown for rate limit handling in account unavailability and single-model chat flows
- Dynamic custom model fetching for model selection

# v0.4.5 (2026-04-24)

## Improvements
- Cap maximum cooldown for rate limit handling in account unavailability and single-model chat flows
- Dynamic custom model fetching for model selection

# v0.4.3 (2026-04-24)

## Improvements
- Improve in-app download/update UX on dashboard
- Improve Codex provider rate limit handling with precise cooldown (`resetsAtMs`) and email backfill for OAuth accounts

# v0.4.2 (2026-04-24)

## Features
- Add Azure OpenAI provider support
- Add built-in Volcengine Ark provider support (#741)
- Add GPT 5.5 model

## Fixes
- Enhance retry logic and configuration for HTTP status codes

# v0.4.1 (2026-04-23)

## Features
- Add Hermes CLI tool with settings management and integration
- Add in-app version update mechanism (appUpdater + /api/version/update)

## Improvements
- Strengthen CLI token validation for enhanced security
- Enhance Sidebar layout for CLI tools
- Update executors and runtime config

# v0.3.98 (2026-04-22)

## Features
- Add RTK — filter context (ls/grep/find/.....) before sending to LLM to save tokens

# v0.3.97 (2026-04-22)

## Features
- Add OpenCode Go provider and support for custom models
- Add Text To Image provider
- Support custom host URL for remote Ollama servers

## Fixes
- Fix copy to clipboard issue

# v0.3.96 (2026-04-17)

## Features
- Add marked package for Markdown rendering
- Enhance changelog styles

## Improvements
- Refactor error handling to config-driven approach with centralized error rules
- Refactor localDb structure
- Update Qwen executor for OAuth handling
- Enhance error formatting to include low-level cause details
- Refactor HeaderMenu to use MenuItem component
- Improve LanguageSwitcher to support controlled open state
- Update backoff configuration and improve CLI detection messages
- Add installation guides for manual configuration in tool cards (Droid, Claude, OpenClaw)

## Fixes
- Fix Codex image URL fetches to await before sending upstream (#575)
- Strip thinking/reasoning_effort for GitHub Copilot chat completions (#623)
- Enable Codex Apply/Reset buttons when CLI is installed (#591)
- Show manual config option when Claude CLI detection fails (#589)
- Show manual config option when OpenClaw detection fails (#579)
- Ensure LocalMutex acquire returns release callback correctly (#569)
- Strip enumDescriptions from tool schema in antigravity-to-openai (#566)
- Strip temperature parameter for gpt-5.4 model (#536)
- Add Blackbox AI as a supported provider (#599)
- Add multi-model support for Factory Droid CLI tool (#521)
- Add GLM-5 and MiniMax-M2.5 models to Kiro provider (#580)
- Fix usage tracking bug

# v0.3.91 (2026-04-15)

## Features
- Add Kiro AWS Identity Center device flow for provider OAuth
- Add TTS (Text-to-Speech) core handler and TTS models config
- Add media providers dashboard page
- Add suggested models API endpoint

## Improvements
- Refactor error handling to config-driven approach with centralized error rules
- Refactor localDb and usageDb for cleaner structure

## Fixes
- Fix usage tracking bug

# v0.3.90 (2026-04-14)

## Features
- Add proactive token refresh lead times for providers and Codex proxy management
- Enhance CodexExecutor with compact URL support

## Improvements
- Enhance Windows Tailscale installation with curl support and fallback to well-known Windows path
- Refactor execSync and spawn calls with windowsHide option for better Windows compatibility

## Fixes
- Fix noAuth support for providers and adjusted MITM restart settings
- Bug fixes

# v0.3.89 (2026-04-13)

## Improvements
- Improved dashboard access control by blocking tunnel/Tailscale access when disabled