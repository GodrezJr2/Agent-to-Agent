// HTTP surface: dashboard REST API + SSE under /api, A2A servers under /a2a,
// and the built web UI as static files.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import { config } from "./config.js";
import { createGateway } from "./gateway.js";
import { createEventHub } from "./events.js";
import { createToolRunner, workspaceRoot, resolveInWorkspace, DEFAULT_TOOLS, TOOL_DEFINITIONS } from "./tools.js";
import { createAgentHost, createA2AClient, agentBaseUrl } from "./a2a.js";
import { OfficeAgentExecutor } from "./executor.js";
import { createOffice } from "./office.js";

const httpError = (status, message) => Object.assign(new Error(message), { status });

function bearerMatches(req, key) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  const got = Buffer.from(m?.[1]?.trim() || "");
  const want = Buffer.from(key);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/**
 * @param {object} opts
 * @param {ReturnType<import("./db.js").openDb>} opts.db
 */
export function createApp({ db, gateway = createGateway(), apiKey = config.apiKey, publicUrl = config.publicUrl, selfUrl = config.selfUrl, workspacesDir = config.workspacesDir, webDist, executorOptions = {} } = {}) {
  const hub = createEventHub(db);
  const a2a = createA2AClient({ headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
  let office; // assigned below; the tool runner needs delegate() lazily
  const tools = createToolRunner({
    db, gateway, workspacesDir,
    delegate: (args) => office.delegate(args),
    onSchedule: (row) => { office.schedule(row); hub.changed(row.officeId, "schedules"); },
  });
  const host = createAgentHost({
    db,
    baseUrl: publicUrl,
    createExecutor: (agentId) => new OfficeAgentExecutor({ agentId, db, gateway, tools, hub, ...executorOptions }),
  });
  office = createOffice({ db, hub, a2a, selfUrl });

  const app = express();
  app.disable("x-powered-by");

  // Auth: agent cards stay public (discovery); everything else needs the key when set.
  if (apiKey) {
    app.use(["/api", "/a2a"], (req, res, next) => {
      if (req.method === "GET" && (/\/\.well-known\/agent-card\.json$/.test(req.path) || (req.baseUrl === "/api" && req.path === "/health"))) return next();
      if (bearerMatches(req, apiKey) || req.query.key === apiKey) return next();
      res.status(401).json({ error: "Unauthorized" });
    });
  }

  app.use("/a2a", host.router);

  const api = express.Router();
  api.use(express.json({ limit: "5mb" }));
  const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((out) => { if (out !== undefined && !res.headersSent) res.json(out); }).catch(next);

  const mustOffice = (id) => db.getOffice(id) || (() => { throw httpError(404, "Office not found"); })();
  const mustAgent = (id) => db.getAgent(id) || (() => { throw httpError(404, "Agent not found"); })();
  const withCard = (agent) => ({ ...agent, a2aUrl: agent.kind === "remote" ? agent.remoteUrl : agentBaseUrl(agent.id, publicUrl) });

  api.get("/health", (_req, res) => res.json({ status: "ok", service: "a2a-office" }));
  api.get("/config", (_req, res) => res.json({ publicUrl, gateway: gateway.baseUrl, defaultModel: config.gateway.defaultModel, tools: DEFAULT_TOOLS.map((n) => ({ name: n, description: TOOL_DEFINITIONS[n].function.description })) }));
  api.get("/models", route(async () => ({ models: await gateway.listModels() })));

  // offices
  api.get("/offices", route(() => ({ offices: db.listOffices() })));
  api.post("/offices", route((req) => {
    const name = String(req.body?.name || "").trim();
    if (!name) throw httpError(400, "name is required");
    return { office: db.createOffice({ name, description: String(req.body.description || "") }) };
  }));
  api.get("/offices/:id", route((req) => {
    const o = mustOffice(req.params.id);
    return { office: o, agents: db.listAgents(o.id).map(withCard), activity: hub.currentActivity(o.id) };
  }));
  api.patch("/offices/:id", route((req) => ({ office: db.updateOffice(mustOffice(req.params.id).id, req.body || {}) })));
  api.delete("/offices/:id", route((req) => {
    const o = mustOffice(req.params.id);
    for (const a of db.listAgents(o.id)) { office.stopAgent(a.id); host.invalidate(a.id); }
    for (const s of db.listSchedules(o.id)) office.unschedule(s.id);
    return { deleted: db.deleteOffice(o.id) };
  }));

  // agents
  api.post("/offices/:id/agents", route(async (req) => {
    const o = mustOffice(req.params.id);
    const input = { ...(req.body || {}) };
    if (input.kind === "remote") {
      if (!/^https?:\/\//.test(input.remoteUrl || "")) throw httpError(400, "remoteUrl must be an http(s) A2A base URL");
      const card = await a2a.fetchCard(input.remoteUrl).catch((err) => { throw httpError(400, `Could not read agent card: ${err.message}`); });
      input.name ||= card.name;
      input.description ||= card.description || "";
      input.role ||= card.skills?.[0]?.name || "External agent";
    }
    if (!String(input.name || "").trim()) throw httpError(400, "name is required");
    if (db.listAgents(o.id).some((a) => a.name.toLowerCase() === input.name.trim().toLowerCase())) throw httpError(409, "An agent with that name already exists in this office");
    const agent = db.createAgent(o.id, { ...input, name: input.name.trim() });
    hub.changed(o.id, "agents");
    return { agent: withCard(agent) };
  }));
  api.patch("/agents/:id", route((req) => {
    const cur = mustAgent(req.params.id);
    const patch = req.body || {};
    if (patch.managerId === cur.id) throw httpError(400, "An agent cannot manage itself");
    if (patch.name && db.listAgents(cur.officeId).some((a) => a.id !== cur.id && a.name.toLowerCase() === String(patch.name).trim().toLowerCase())) throw httpError(409, "Name already used");
    const agent = db.updateAgent(cur.id, patch);
    host.invalidate(cur.id);
    if (cur.kind === "remote") a2a.forget(cur.remoteUrl);
    hub.changed(cur.officeId, "agents");
    return { agent: withCard(agent) };
  }));
  api.delete("/agents/:id", route((req) => {
    const cur = mustAgent(req.params.id);
    office.stopAgent(cur.id);
    for (const s of db.listSchedules(cur.officeId).filter((s) => s.agentId === cur.id)) office.unschedule(s.id);
    host.invalidate(cur.id);
    const deleted = db.deleteAgent(cur.id);
    hub.changed(cur.officeId, "agents");
    return { deleted };
  }));
  api.post("/agents/:id/stop", route((req) => ({ stopped: office.stopAgent(mustAgent(req.params.id).id) })));
  api.get("/agents/:id/card", route((req) => {
    const a = mustAgent(req.params.id);
    return a.kind === "remote" ? a2a.fetchCard(a.remoteUrl) : host.card(a.id);
  }));
  api.get("/agents/:id/memories", route((req) => ({ memories: db.listMemories(mustAgent(req.params.id).id) })));
  api.delete("/agents/:id/memories/:key", route((req) => ({ deleted: db.forget(mustAgent(req.params.id).id, req.params.key) })));

  // conversation
  api.get("/offices/:id/feed", route((req) => ({ feed: db.listFeed(mustOffice(req.params.id).id, { limit: Math.min(Number(req.query.limit) || 200, 1000), before: req.query.before }) })));
  api.delete("/offices/:id/feed", route((req) => {
    const o = mustOffice(req.params.id);
    db.clearFeed(o.id);
    db.bumpChatEpoch(o.id); // new A2A contexts: agents forget the old conversation
    hub.changed(o.id, "feed");
    return { cleared: true };
  }));
  api.post("/offices/:id/messages", route((req, res) => {
    const content = String(req.body?.content || "").trim();
    if (!content) throw httpError(400, "content is required");
    res.status(202);
    return office.sendUserMessage(mustOffice(req.params.id).id, { content, agentId: req.body.agentId });
  }));
  api.get("/offices/:id/stream", (req, res) => {
    const o = db.getOffice(req.params.id);
    if (!o) return res.status(404).json({ error: "Office not found" });
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const send = (evt) => res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt.data)}\n\n`);
    for (const a of hub.currentActivity(o.id)) send({ type: "activity", data: a });
    const unsubscribe = hub.subscribe(o.id, send);
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => { clearInterval(ping); unsubscribe(); });
  });

  // schedules
  api.get("/offices/:id/schedules", route((req) => ({ schedules: db.listSchedules(mustOffice(req.params.id).id).map((s) => ({ ...s, nextRun: office.nextRun(s.id) })) })));
  api.post("/offices/:id/schedules", route(async (req) => {
    const o = mustOffice(req.params.id);
    const agent = mustAgent(req.body?.agentId);
    if (agent.officeId !== o.id) throw httpError(400, "Agent is not in this office");
    const { Cron } = await import("croner");
    try { new Cron(String(req.body.cron), { paused: true }).stop(); } catch (err) { throw httpError(400, `Invalid cron: ${err.message}`); }
    if (!String(req.body.prompt || "").trim()) throw httpError(400, "prompt is required");
    const row = db.createSchedule({ officeId: o.id, agentId: agent.id, cron: String(req.body.cron), prompt: String(req.body.prompt) });
    office.schedule(row);
    hub.changed(o.id, "schedules");
    return { schedule: { ...row, nextRun: office.nextRun(row.id) } };
  }));
  api.patch("/schedules/:id", route((req) => {
    const row = db.getSchedule(req.params.id) || (() => { throw httpError(404, "Schedule not found"); })();
    db.setScheduleEnabled(row.id, !!req.body?.enabled);
    office.schedule(db.getSchedule(row.id));
    hub.changed(row.officeId, "schedules");
    return { schedule: { ...db.getSchedule(row.id), nextRun: office.nextRun(row.id) } };
  }));
  api.delete("/schedules/:id", route((req) => {
    const row = db.getSchedule(req.params.id) || (() => { throw httpError(404, "Schedule not found"); })();
    office.unschedule(row.id);
    db.deleteSchedule(row.id);
    hub.changed(row.officeId, "schedules");
    return { deleted: true };
  }));

  // workspace files
  api.get("/offices/:id/files", route(async (req) => {
    const root = workspaceRoot(mustOffice(req.params.id).id, workspacesDir);
    await fsp.mkdir(root, { recursive: true });
    const dir = resolveInWorkspace(root, String(req.query.path || "."));
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (e) => {
      const stat = await fsp.stat(path.join(dir, e.name)).catch(() => null);
      return { name: e.name, dir: e.isDirectory(), size: stat?.size ?? 0, modified: stat?.mtime?.toISOString() ?? null };
    }));
    return { path: path.relative(root, dir) || ".", files: files.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)) };
  }));
  api.get("/offices/:id/file", route(async (req, res) => {
    const root = workspaceRoot(mustOffice(req.params.id).id, workspacesDir);
    const file = resolveInWorkspace(root, String(req.query.path || ""));
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile()) throw httpError(404, "File not found");
    res.sendFile(file, { dotfiles: "allow", headers: { "Content-Disposition": req.query.download ? `attachment; filename="${path.basename(file)}"` : "inline" } });
  }));

  api.use((req, res) => res.status(404).json({ error: `No route for ${req.method} /api${req.path}` }));
  api.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error("[api]", err);
    res.status(status).json({ error: err.message || "Internal error" });
  });
  app.use("/api", api);

  if (webDist && fs.existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/|a2a\/).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  return { app, hub, office, host, a2a, db };
}
