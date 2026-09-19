// End-to-end over real HTTP: user → lead agent → delegate_task (A2A JSON-RPC to
// the worker's own endpoint) → worker writes a file → result flows back.
// The 9router gateway is replaced by a scripted fake keyed on the agent name.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";

function scriptedGateway(scripts) {
  const calls = [];
  return {
    baseUrl: "http://fake-gateway/v1",
    calls,
    async listModels() { return [{ id: "fake/model", owned_by: "test" }]; },
    async status() { return { ok: true, baseUrl: "http://fake-gateway/v1", modelCount: 1, providers: [{ prefix: "fake", models: ["fake/model"] }], combos: [], defaultModel: "", defaultModelAvailable: true }; },
    async ping(model) { return { ok: true, model, latencyMs: 1, reply: "ready" }; },
    async chat({ model, messages, tools }) {
      const system = messages[0].content;
      const who = Object.keys(scripts).find((name) => system.includes(`You are ${name}`));
      calls.push({ who, model, tools: (tools || []).map((t) => t.function.name), messages: [...messages] });
      const turn = messages.filter((m) => m.role === "tool").length;
      return { message: scripts[who](turn, messages), finishReason: "stop" };
    },
  };
}

const toolCall = (name, args, id = `call_${name}`) => ({ role: "assistant", content: "", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

async function waitFor(fn, timeoutMs = 10000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("office end-to-end", () => {
  let server, base, db, tmp, gateway;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "office-e2e-"));
    db = openDb(":memory:");
    gateway = scriptedGateway({
      Maya: (turn, messages) => (turn === 0
        ? toolCall("delegate_task", { agent: "Kevin", task: "Write hello.txt containing 'Hello A2A'" })
        : { role: "assistant", content: `Team done. Kevin said: ${messages.at(-1).content}` }),
      Kevin: (turn) => (turn === 0
        ? toolCall("write_file", { path: "hello.txt", content: "Hello A2A" })
        : { role: "assistant", content: "Wrote hello.txt" }),
    });
    // Port 0 → learn the port, then build the app with matching self/public URLs.
    const probe = (await import("node:http")).createServer();
    await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    base = `http://127.0.0.1:${port}`;
    const { app } = createApp({ db, gateway, apiKey: "", publicUrl: base, selfUrl: base, workspacesDir: tmp, executorOptions: { defaultModel: "fake/model" } });
    server = await new Promise((resolve) => { const s = app.listen(port, "127.0.0.1", () => resolve(s)); });
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    db.close();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const api = async (method, p, body) => {
    const res = await fetch(`${base}/api${p}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };

  it("delegates from lead to worker over A2A and reports back", async () => {
    const { body: { office } } = await api("POST", "/offices", { name: "Test Office" });
    const { body: { agent: maya } } = await api("POST", `/offices/${office.id}/agents`, { name: "Maya", role: "Lead" });
    const { body: { agent: kevin } } = await api("POST", `/offices/${office.id}/agents`, { name: "Kevin", role: "Engineer", managerId: maya.id });

    // Every local agent publishes a real A2A agent card.
    const card = await (await fetch(`${kevin.a2aUrl}.well-known/agent-card.json`)).json();
    expect(card.name).toBe("Kevin");
    expect(card.supportedInterfaces[0].url).toBe(kevin.a2aUrl);

    const sent = await api("POST", `/offices/${office.id}/messages`, { content: "Please greet the world" });
    expect(sent.status).toBe(202);
    expect(sent.body.targets).toEqual([maya.id]); // no mention → office lead

    const reply = await waitFor(async () => (await api("GET", `/offices/${office.id}/feed`)).body.feed.find((f) => f.kind === "agent" && f.agentId === maya.id));
    expect(reply.content).toContain("Team done");
    expect(reply.content).toContain("Wrote hello.txt");

    const feed = (await api("GET", `/offices/${office.id}/feed`)).body.feed;
    const kinds = feed.map((f) => `${f.kind}:${f.agentId === maya.id ? "maya" : f.agentId === kevin.id ? "kevin" : "-"}`);
    expect(kinds).toContain("delegation:maya");
    expect(kinds).toContain("tool:kevin");
    expect(kinds).toContain("agent:kevin");

    expect(await fs.readFile(path.join(tmp, office.id, "hello.txt"), "utf8")).toBe("Hello A2A");

    // Lead saw delegate_task; the worker (a leaf) could still delegate to peers but got write tools.
    expect(gateway.calls.find((c) => c.who === "Maya").tools).toContain("delegate_task");
    expect(gateway.calls.find((c) => c.who === "Kevin").tools).toContain("write_file");
  });

  it("routes @mentions directly and keeps conversation memory per context", async () => {
    const { body: { office } } = await api("POST", "/offices", { name: "Memory Office" });
    await api("POST", `/offices/${office.id}/agents`, { name: "Maya", role: "Lead" });
    const { body: { agent: kevin } } = await api("POST", `/offices/${office.id}/agents`, { name: "Kevin", role: "Engineer" });

    const before = gateway.calls.length;
    await api("POST", `/offices/${office.id}/messages`, { content: "@Kevin first question" });
    await waitFor(async () => (await api("GET", `/offices/${office.id}/feed`)).body.feed.some((f) => f.kind === "agent" && f.agentId === kevin.id));
    await api("POST", `/offices/${office.id}/messages`, { content: "@kevin second question" });
    await waitFor(async () => (await api("GET", `/offices/${office.id}/feed`)).body.feed.filter((f) => f.kind === "agent" && f.agentId === kevin.id).length >= 2);

    const kevinCalls = gateway.calls.slice(before).filter((c) => c.who === "Kevin");
    const lastFirstTurn = kevinCalls.filter((c) => c.messages.at(-1).role === "user").at(-1);
    const texts = lastFirstTurn.messages.map((m) => m.content);
    expect(texts).toContain("@Kevin first question"); // prior turn replayed from the A2A context
    expect(texts.at(-1)).toBe("@kevin second question");
  });

  it("rejects workspace path escapes", async () => {
    const { body: { office } } = await api("POST", "/offices", { name: "Safe Office" });
    const res = await api("GET", `/offices/${office.id}/files?path=${encodeURIComponent("../../")}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/escapes the workspace/);
  });

  it("creates an office from a team template and persists its layout", async () => {
    const layout = { version: 1, cols: 3, rows: 2, tiles: [0, 1, 0, 0, 1, 0], furniture: [] };
    const { status, body: { office } } = await api("POST", "/offices", { name: "Tpl Office", team: "research-squad", model: "fake/model", layout });
    expect(status).toBe(200);
    const agents = (await api("GET", `/offices/${office.id}`)).body.agents;
    expect(agents.map((a) => a.name)).toEqual(["Nadia", "Dimas", "Ayu"]);
    const lead = agents.find((a) => a.name === "Nadia");
    expect(agents.filter((a) => a.managerId === lead.id)).toHaveLength(2);
    expect(agents.every((a) => a.model === "fake/model")).toBe(true);

    expect((await api("GET", `/offices/${office.id}/layout`)).body.layout).toEqual(layout);
    await api("PUT", `/offices/${office.id}/layout`, { seats: { [lead.id]: { seatId: "s1" } } });
    const saved = (await api("GET", `/offices/${office.id}/layout`)).body;
    expect(saved.layout).toEqual(layout);
    expect(saved.seats[lead.id].seatId).toBe("s1");

    const bad = await api("PUT", `/offices/${office.id}/layout`, { layout: { version: 2 } });
    expect(bad.status).toBe(400);
    expect((await api("POST", "/offices", { name: "x", team: "nope" })).status).toBe(400);
  });

  it("reports gateway status and lists templates", async () => {
    const gw = (await api("GET", "/gateway")).body;
    expect(gw.ok).toBe(true);
    expect(gw.providers[0].prefix).toBe("fake");
    expect((await api("POST", "/gateway/test", { model: "fake/model" })).body.reply).toBe("ready");
    const teams = (await api("GET", "/templates")).body.teams;
    expect(teams.map((t) => t.id)).toContain("web-studio");
  });
});
