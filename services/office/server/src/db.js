// SQLite persistence (node:sqlite, no native deps). One file per office service.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS offices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  chatEpoch INTEGER NOT NULL DEFAULT 0,         -- bumped by "new conversation"
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  officeId TEXT NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'local',          -- local | remote
  remoteUrl TEXT NOT NULL DEFAULT '',           -- remote agents: A2A base URL
  model TEXT NOT NULL DEFAULT '',               -- 9router model or combo id
  systemPrompt TEXT NOT NULL DEFAULT '',
  managerId TEXT,
  tools TEXT NOT NULL DEFAULT '[]',             -- enabled tool names; [] = defaults
  sprite INTEGER NOT NULL DEFAULT 0,
  seatX INTEGER,
  seatY INTEGER,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agents_office ON agents(officeId);
CREATE TABLE IF NOT EXISTS feed (
  id TEXT PRIMARY KEY,
  officeId TEXT NOT NULL,
  kind TEXT NOT NULL,                           -- user | agent | delegation | tool | status | error
  agentId TEXT,
  fromAgentId TEXT,
  toAgentId TEXT,
  taskId TEXT,
  contextId TEXT,
  content TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feed_office ON feed(officeId, createdAt);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  agentId TEXT NOT NULL,
  contextId TEXT NOT NULL,
  state INTEGER NOT NULL,
  json TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agentId, updatedAt);
CREATE INDEX IF NOT EXISTS idx_tasks_context ON tasks(contextId, createdAt);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  officeId TEXT NOT NULL,
  agentId TEXT NOT NULL,
  key TEXT NOT NULL,
  content TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE(agentId, key)
);
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  officeId TEXT NOT NULL,
  agentId TEXT NOT NULL,
  cron TEXT NOT NULL,
  prompt TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  lastRun TEXT,
  createdAt TEXT NOT NULL
);
`;

const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

const AGENT_FIELDS = ["name", "role", "description", "kind", "remoteUrl", "model", "systemPrompt", "managerId", "tools", "sprite", "seatX", "seatY"];

function rowToAgent(row) {
  if (!row) return null;
  return { ...row, tools: JSON.parse(row.tools || "[]") };
}

function rowToFeed(row) {
  return { ...row, meta: JSON.parse(row.meta || "{}") };
}

export function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);

  const q = (sql) => db.prepare(sql);

  const repo = {
    raw: db,
    close: () => db.close(),

    // ── offices ────────────────────────────────────────────────
    listOffices: () => q("SELECT o.*, (SELECT COUNT(*) FROM agents a WHERE a.officeId = o.id) AS agentCount FROM offices o ORDER BY createdAt").all(),
    getOffice: (id) => q("SELECT * FROM offices WHERE id = ?").get(id) || null,
    createOffice({ name, description = "" }) {
      const row = { id: newId(), name, description, chatEpoch: 0, createdAt: now(), updatedAt: now() };
      q("INSERT INTO offices (id, name, description, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)").run(row.id, row.name, row.description, row.createdAt, row.updatedAt);
      return row;
    },
    updateOffice(id, patch) {
      const cur = repo.getOffice(id);
      if (!cur) return null;
      const next = { ...cur, ...pick(patch, ["name", "description"]), updatedAt: now() };
      q("UPDATE offices SET name = ?, description = ?, updatedAt = ? WHERE id = ?").run(next.name, next.description, next.updatedAt, id);
      return next;
    },
    deleteOffice(id) {
      for (const t of ["feed", "memories", "schedules"]) q(`DELETE FROM ${t} WHERE officeId = ?`).run(id);
      q("DELETE FROM tasks WHERE agentId IN (SELECT id FROM agents WHERE officeId = ?)").run(id);
      return q("DELETE FROM offices WHERE id = ?").run(id).changes > 0;
    },

    // ── agents ─────────────────────────────────────────────────
    listAgents: (officeId) => q("SELECT * FROM agents WHERE officeId = ? ORDER BY createdAt").all(officeId).map(rowToAgent),
    getAgent: (id) => rowToAgent(q("SELECT * FROM agents WHERE id = ?").get(id)),
    createAgent(officeId, input) {
      const row = {
        id: newId(), officeId, name: input.name, role: input.role || "", description: input.description || "",
        kind: input.kind === "remote" ? "remote" : "local", remoteUrl: input.remoteUrl || "", model: input.model || "",
        systemPrompt: input.systemPrompt || "", managerId: input.managerId || null, tools: JSON.stringify(input.tools || []),
        sprite: Number(input.sprite) || 0, seatX: input.seatX ?? null, seatY: input.seatY ?? null, createdAt: now(), updatedAt: now(),
      };
      q(`INSERT INTO agents (id, officeId, name, role, description, kind, remoteUrl, model, systemPrompt, managerId, tools, sprite, seatX, seatY, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        row.id, row.officeId, row.name, row.role, row.description, row.kind, row.remoteUrl, row.model, row.systemPrompt,
        row.managerId, row.tools, row.sprite, row.seatX, row.seatY, row.createdAt, row.updatedAt);
      return rowToAgent(row);
    },
    updateAgent(id, patch) {
      const cur = repo.getAgent(id);
      if (!cur) return null;
      const next = { ...cur, ...pick(patch, AGENT_FIELDS), updatedAt: now() };
      q(`UPDATE agents SET name = ?, role = ?, description = ?, kind = ?, remoteUrl = ?, model = ?, systemPrompt = ?, managerId = ?,
         tools = ?, sprite = ?, seatX = ?, seatY = ?, updatedAt = ? WHERE id = ?`).run(
        next.name, next.role, next.description, next.kind, next.remoteUrl, next.model, next.systemPrompt, next.managerId || null,
        JSON.stringify(next.tools || []), Number(next.sprite) || 0, next.seatX ?? null, next.seatY ?? null, next.updatedAt, id);
      return repo.getAgent(id);
    },
    deleteAgent(id) {
      q("UPDATE agents SET managerId = NULL WHERE managerId = ?").run(id);
      q("DELETE FROM schedules WHERE agentId = ?").run(id);
      q("DELETE FROM memories WHERE agentId = ?").run(id);
      q("DELETE FROM tasks WHERE agentId = ?").run(id);
      return q("DELETE FROM agents WHERE id = ?").run(id).changes > 0;
    },

    // ── feed (office timeline shown in the UI) ─────────────────
    addFeed(entry) {
      const row = {
        id: newId(), officeId: entry.officeId, kind: entry.kind, agentId: entry.agentId || null,
        fromAgentId: entry.fromAgentId || null, toAgentId: entry.toAgentId || null, taskId: entry.taskId || null,
        contextId: entry.contextId || null, content: entry.content || "", meta: JSON.stringify(entry.meta || {}), createdAt: now(),
      };
      q(`INSERT INTO feed (id, officeId, kind, agentId, fromAgentId, toAgentId, taskId, contextId, content, meta, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        row.id, row.officeId, row.kind, row.agentId, row.fromAgentId, row.toAgentId, row.taskId, row.contextId, row.content, row.meta, row.createdAt);
      return rowToFeed(row);
    },
    listFeed(officeId, { limit = 200, before } = {}) {
      const rows = before
        ? q("SELECT * FROM feed WHERE officeId = ? AND createdAt < ? ORDER BY createdAt DESC LIMIT ?").all(officeId, before, limit)
        : q("SELECT * FROM feed WHERE officeId = ? ORDER BY createdAt DESC LIMIT ?").all(officeId, limit);
      return rows.reverse().map(rowToFeed);
    },
    clearFeed: (officeId) => q("DELETE FROM feed WHERE officeId = ?").run(officeId).changes,
    bumpChatEpoch: (officeId) => q("UPDATE offices SET chatEpoch = chatEpoch + 1 WHERE id = ?").run(officeId),

    // ── A2A tasks (backing store for the SDK TaskStore) ────────
    saveTask(agentId, task, json) {
      const ts = now();
      q(`INSERT INTO tasks (id, agentId, contextId, state, json, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET state = excluded.state, json = excluded.json, updatedAt = excluded.updatedAt`).run(
        task.id, agentId, task.contextId || "", task.status?.state ?? 0, json, ts, ts);
    },
    loadTaskJson: (agentId, id) => q("SELECT json FROM tasks WHERE id = ? AND agentId = ?").get(id, agentId)?.json ?? null,
    listTaskJson(agentId, { contextId, state, limit, offset }) {
      const where = ["agentId = ?"];
      const args = [agentId];
      if (contextId) { where.push("contextId = ?"); args.push(contextId); }
      if (state) { where.push("state = ?"); args.push(state); }
      const total = q(`SELECT COUNT(*) AS n FROM tasks WHERE ${where.join(" AND ")}`).get(...args).n;
      const rows = q(`SELECT json FROM tasks WHERE ${where.join(" AND ")} ORDER BY updatedAt DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
      return { total, rows: rows.map((r) => r.json) };
    },
    listContextTaskJson: (agentId, contextId) => q("SELECT json FROM tasks WHERE agentId = ? AND contextId = ? ORDER BY createdAt").all(agentId, contextId).map((r) => r.json),

    // ── memories ───────────────────────────────────────────────
    remember(officeId, agentId, key, content) {
      const ts = now();
      q(`INSERT INTO memories (id, officeId, agentId, key, content, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(agentId, key) DO UPDATE SET content = excluded.content, updatedAt = excluded.updatedAt`).run(newId(), officeId, agentId, key, content, ts, ts);
    },
    recall: (agentId, key) => q("SELECT key, content, updatedAt FROM memories WHERE agentId = ? AND key = ?").get(agentId, key) || null,
    listMemories: (agentId) => q("SELECT key, content, updatedAt FROM memories WHERE agentId = ? ORDER BY updatedAt DESC").all(agentId),
    forget: (agentId, key) => q("DELETE FROM memories WHERE agentId = ? AND key = ?").run(agentId, key).changes > 0,

    // ── schedules ──────────────────────────────────────────────
    listSchedules: (officeId) => q("SELECT * FROM schedules WHERE officeId = ? ORDER BY createdAt").all(officeId),
    listAllSchedules: () => q("SELECT * FROM schedules WHERE enabled = 1").all(),
    getSchedule: (id) => q("SELECT * FROM schedules WHERE id = ?").get(id) || null,
    createSchedule({ officeId, agentId, cron, prompt }) {
      const row = { id: newId(), officeId, agentId, cron, prompt, enabled: 1, lastRun: null, createdAt: now() };
      q("INSERT INTO schedules (id, officeId, agentId, cron, prompt, enabled, lastRun, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        row.id, row.officeId, row.agentId, row.cron, row.prompt, row.enabled, row.lastRun, row.createdAt);
      return row;
    },
    setScheduleEnabled: (id, enabled) => q("UPDATE schedules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id).changes > 0,
    markScheduleRun: (id) => q("UPDATE schedules SET lastRun = ? WHERE id = ?").run(now(), id),
    deleteSchedule: (id) => q("DELETE FROM schedules WHERE id = ?").run(id).changes > 0,
  };
  return repo;
}

function pick(obj = {}, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
