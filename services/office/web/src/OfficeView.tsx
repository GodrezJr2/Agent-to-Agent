import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type Activity, type Agent, type FeedEntry, type FileEntry, type Office, type Schedule, type ToolInfo } from "./api";
import { AgentModal } from "./AgentModal";
import { KeyPrompt, Modal, RichText, TopBar, clock, timeAgo } from "./shared";
import { OfficeCanvas } from "./office/components/OfficeCanvas";
import { useOfficeStore } from "./office/engine/officeStore";

type Tab = "agents" | "schedules" | "files";

export function OfficeView({ officeId }: { officeId: string }) {
  const [office, setOffice] = useState<Office | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [activity, setActivity] = useState<Record<string, Activity>>({});
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [needKey, setNeedKey] = useState(false);
  const [tab, setTab] = useState<Tab>("agents");
  const [editing, setEditing] = useState<Agent | null | undefined>(undefined); // undefined = closed, null = new
  const [cardFor, setCardFor] = useState<Agent | null>(null);

  const loadOffice = useCallback(() =>
    api.office(officeId).then((r) => {
      setOffice(r.office);
      setAgents(r.agents);
      setActivity(Object.fromEntries(r.activity.map((a) => [a.agentId, a])));
      setNeedKey(false);
    }).catch((e) => (e instanceof ApiError && e.status === 401 ? setNeedKey(true) : setError(e.message))), [officeId]);

  useEffect(() => {
    loadOffice();
    api.feed(officeId).then((r) => setFeed(r.feed)).catch(() => {});
    api.config().then((c) => { setTools(c.tools); setDefaultModel(c.defaultModel); }).catch(() => {});
  }, [officeId, loadOffice, needKey]);

  useEffect(() => {
    if (needKey) return;
    return api.stream(officeId, {
      open: () => setConnected(true),
      error: () => setConnected(false),
      feed: (entry) => setFeed((f) => (f.some((x) => x.id === entry.id) ? f : [...f, entry])),
      activity: (a) => setActivity((cur) => {
        const next = { ...cur };
        if (a.state === "idle") delete next[a.agentId];
        else next[a.agentId] = a;
        return next;
      }),
      changed: (what) => {
        if (what === "agents") loadOffice();
        if (what === "feed") setFeed([]);
      },
    });
  }, [officeId, needKey, loadOffice]);

  // Keep the pixel office in sync with agents and their live activity.
  useEffect(() => {
    const store = useOfficeStore.getState();
    const ids = new Set(agents.map((a) => a.id));
    for (const id of store.characters.keys()) if (!ids.has(id)) store.removeAgent(id);
    for (const a of agents) store.addAgent({ id: a.id, name: a.name });
  }, [agents]);
  useEffect(() => {
    const store = useOfficeStore.getState();
    for (const a of agents) {
      const act = activity[a.id];
      if (act) store.setAgentActive(a.id, act.detail || act.state);
      else store.setAgentIdle(a.id);
    }
  }, [activity, agents]);
  useEffect(() => () => {
    const store = useOfficeStore.getState();
    for (const id of [...store.characters.keys()]) store.removeAgent(id);
  }, []);

  const byId = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);

  return (
    <>
      <TopBar>
        <span className="crumb">/ <b>{office?.name || "…"}</b></span>
        <span className="grow" />
        <span className="row muted" style={{ fontSize: 12.5 }}>
          <span className={`dot ${connected ? "on" : ""}`} /> {connected ? "live" : "connecting"}
        </span>
      </TopBar>
      {needKey && <KeyPrompt onSaved={() => setNeedKey(false)} />}
      {error && <div className="page err">{error}</div>}

      <div className="office">
        <section className="stage">
          <div className="canvas-wrap">
            <OfficeCanvas onAgentClick={(id) => { setTab("agents"); document.getElementById(`agent-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} />
          </div>
          <Conversation officeId={officeId} agents={agents} byId={byId} feed={feed} activity={activity} />
        </section>

        <aside className="side">
          <nav className="tabs">
            {(["agents", "schedules", "files"] as Tab[]).map((t) => (
              <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
            ))}
          </nav>
          <div className="side-body">
            {tab === "agents" && <AgentsPanel agents={agents} activity={activity} onNew={() => setEditing(null)} onEdit={setEditing} onCard={setCardFor} onChanged={loadOffice} />}
            {tab === "schedules" && <SchedulesPanel officeId={officeId} agents={agents} byId={byId} />}
            {tab === "files" && <FilesPanel officeId={officeId} feed={feed} />}
          </div>
        </aside>
      </div>

      {editing !== undefined && (
        <AgentModal officeId={officeId} agent={editing} agents={agents} tools={tools} defaultModel={defaultModel}
          onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); loadOffice(); }} />
      )}
      {cardFor && <CardModal agent={cardFor} onClose={() => setCardFor(null)} />}
    </>
  );
}

/* ── conversation ─────────────────────────────────────────── */

function Conversation({ officeId, agents, byId, feed, activity }: { officeId: string; agents: Agent[]; byId: Record<string, Agent>; feed: FeedEntry[]; activity: Record<string, Activity> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [mention, setMention] = useState<{ query: string; sel: number } | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = feedRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [feed, activity]);

  const candidates = mention ? agents.filter((a) => a.name.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 6) : [];
  const lead = agents.find((a) => !a.managerId) || agents[0];

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setText(value);
    const upto = value.slice(0, e.target.selectionStart);
    const m = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(upto);
    setMention(m ? { query: m[2], sel: 0 } : null);
  }

  function pick(agent: Agent) {
    const el = inputRef.current!;
    const upto = text.slice(0, el.selectionStart).replace(/@[\p{L}\p{N}_-]*$/u, `@${agent.name} `);
    setText(upto + text.slice(el.selectionStart));
    setMention(null);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = upto.length; });
  }

  async function send() {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setError("");
    try {
      await api.send(officeId, content);
      setText("");
      stick.current = true;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (mention && candidates.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMention({ ...mention, sel: (mention.sel + 1) % candidates.length }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMention({ ...mention, sel: (mention.sel - 1 + candidates.length) % candidates.length }); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(candidates[mention.sel]); return; }
      if (e.key === "Escape") { setMention(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const working = Object.values(activity).filter((a) => byId[a.agentId]);

  return (
    <div className="conversation">
      <div className="conv-head">
        <span className="grow">{working.length ? `${working.map((a) => byId[a.agentId].name).join(", ")} working…` : "Office is quiet"}</span>
        {feed.length > 0 && <button className="btn ghost sm" onClick={() => api.clearFeed(officeId)} title="Clear the timeline and start fresh A2A conversations">New conversation</button>}
      </div>

      <div className="feed" ref={feedRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
        {feed.length === 0 && (
          <div className="empty" style={{ marginTop: 0 }}>
            {agents.length ? <>Message the office. Without an @mention it goes to {lead ? <b>{lead.name}</b> : "the lead"}; use <code>@Name</code> to talk to someone directly.</> : "Hire your first agent from the Agents tab."}
          </div>
        )}
        {feed.map((f) => <FeedItem key={f.id} entry={f} byId={byId} />)}
      </div>

      <div className="composer">
        {mention && candidates.length > 0 && (
          <div className="mention-pop">
            {candidates.map((a, i) => (
              <button key={a.id} className={i === mention.sel ? "sel" : ""} onMouseDown={(e) => { e.preventDefault(); pick(a); }}>
                <b>{a.name}</b><span className="muted">{a.role}</span>
              </button>
            ))}
          </div>
        )}
        <div className="row" style={{ alignItems: "flex-end" }}>
          <textarea ref={inputRef} className="textarea grow" rows={1} value={text} onChange={onChange} onKeyDown={onKeyDown}
            placeholder={agents.length ? `Message the office… (@ to mention, Enter to send)` : "Hire an agent first"} disabled={!agents.length} />
          <button className="btn primary" onClick={send} disabled={sending || !text.trim()}>Send</button>
        </div>
        {error && <div className="err" style={{ fontSize: 12.5, marginTop: 4 }}>{error}</div>}
      </div>
    </div>
  );
}

function FeedItem({ entry: f, byId }: { entry: FeedEntry; byId: Record<string, Agent> }) {
  const name = (id: string | null) => (id && byId[id]?.name) || "removed agent";
  if (f.kind === "user") {
    return (
      <div className="msg user">
        <div className="msg-head"><span className="faint">{f.meta?.source === "schedule" ? "schedule" : "you"} · {clock(f.createdAt)}</span></div>
        <div className="msg-body">{f.content}</div>
      </div>
    );
  }
  if (f.kind === "delegation") {
    return (
      <div className="event delegation">
        <span>{clock(f.createdAt)}</span>
        <span><b>{name(f.fromAgentId)}</b> <span className="arrow">→</span> <b>{name(f.toAgentId)}</b></span>
        <span className="clip" title={f.content}>{f.content}</span>
      </div>
    );
  }
  if (f.kind === "tool") {
    return (
      <div className="event">
        <span>{clock(f.createdAt)}</span>
        <span>{name(f.agentId)}</span>
        <span className="clip" title={f.content}>{f.content}</span>
      </div>
    );
  }
  const a = f.agentId ? byId[f.agentId] : null;
  const to = f.toAgentId ? ` → ${name(f.toAgentId)}` : "";
  return (
    <div className={`msg ${f.kind === "error" ? "agent error" : "agent"}`}>
      <div className="msg-head">
        <b>{a?.name || "Office"}</b>
        <span className="faint">{a?.role}{to} · {clock(f.createdAt)}</span>
        {f.meta?.state && f.meta.state !== "completed" && <span className="tag">{f.meta.state}</span>}
      </div>
      <div className="msg-body"><RichText text={f.content} /></div>
    </div>
  );
}

/* ── agents ───────────────────────────────────────────────── */

function AgentsPanel({ agents, activity, onNew, onEdit, onCard, onChanged }: { agents: Agent[]; activity: Record<string, Activity>; onNew: () => void; onEdit: (a: Agent) => void; onCard: (a: Agent) => void; onChanged: () => void }) {
  const roots = agents.filter((a) => !a.managerId || !agents.some((m) => m.id === a.managerId));
  const children = (id: string) => agents.filter((a) => a.managerId === id);

  async function remove(a: Agent) {
    if (!window.confirm(`Remove ${a.name}? Their tasks and memories are deleted.`)) return;
    await api.deleteAgent(a.id);
    onChanged();
  }

  const render = (a: Agent, depth = 0): React.ReactNode => {
    const act = activity[a.id];
    return (
      <div key={a.id} className={depth ? "indent" : ""}>
        <div className="agent" id={`agent-${a.id}`}>
          <div className="agent-top">
            <span className={`dot ${act ? "busy" : "on"}`} />
            <span className="agent-name">{a.name}</span>
            {a.kind === "remote" && <span className="tag remote">external</span>}
            <span className="grow" />
            <span className="muted" style={{ fontSize: 12 }}>{a.role}</span>
          </div>
          <div className="agent-meta mono">{a.kind === "remote" ? a.remoteUrl : a.model || "default model"}</div>
          {act && <div className="agent-activity">{act.state}{act.detail ? ` · ${act.detail}` : ""}</div>}
          <div className="agent-actions">
            <button className="btn sm" onClick={() => onEdit(a)}>Edit</button>
            <button className="btn sm" onClick={() => onCard(a)}>Agent card</button>
            {act && <button className="btn sm" onClick={() => api.stopAgent(a.id)}>Stop</button>}
            <button className="btn sm ghost danger" onClick={() => remove(a)}>Remove</button>
          </div>
        </div>
        {children(a.id).map((c) => render(c, depth + 1))}
      </div>
    );
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="muted grow" style={{ fontSize: 12.5 }}>{agents.length} agent{agents.length === 1 ? "" : "s"}</span>
        <button className="btn primary sm" onClick={onNew}>Hire agent</button>
      </div>
      {agents.length === 0 && <div className="empty" style={{ marginTop: 0 }}>Start with a lead (reports to nobody), then add reports under them.</div>}
      {roots.map((a) => render(a))}
    </>
  );
}

function CardModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [card, setCard] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.agentCard(agent.id).then(setCard).catch((e) => setError(e.message)); }, [agent.id]);
  return (
    <Modal title={`${agent.name} · A2A agent card`} subtitle={agent.a2aUrl} onClose={onClose}>
      <div className="hint" style={{ margin: "10px 0" }}>Any A2A v1 client can reach this agent at the URL above (JSON-RPC). The card is public at <code>{agent.a2aUrl}.well-known/agent-card.json</code>.</div>
      {error ? <p className="err">{error}</p> : <pre className="viewer">{card ? JSON.stringify(card, null, 2) : "Loading…"}</pre>}
      <div className="modal-actions">
        <button className="btn" onClick={() => navigator.clipboard?.writeText(agent.a2aUrl)}>Copy URL</button>
        <button className="btn primary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

/* ── schedules ────────────────────────────────────────────── */

function SchedulesPanel({ officeId, agents, byId }: { officeId: string; agents: Agent[]; byId: Record<string, Agent> }) {
  const [rows, setRows] = useState<Schedule[]>([]);
  const [form, setForm] = useState({ agentId: "", cron: "0 9 * * 1-5", prompt: "" });
  const [error, setError] = useState("");
  const load = useCallback(() => api.schedules(officeId).then((r) => setRows(r.schedules)).catch((e) => setError(e.message)), [officeId]);
  useEffect(() => { load(); }, [load]);
  const local = agents.filter((a) => a.kind === "local");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.createSchedule(officeId, { ...form, agentId: form.agentId || local[0]?.id });
      setForm({ ...form, prompt: "" });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <>
      <form onSubmit={add} style={{ marginBottom: 16 }}>
        <div className="row">
          <select className="select grow" value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })}>
            {local.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input className="input mono" style={{ width: 130 }} value={form.cron} onChange={(e) => setForm({ ...form, cron: e.target.value })} aria-label="Cron expression" />
        </div>
        <textarea className="textarea" style={{ marginTop: 8, minHeight: 60 }} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="What should run on this schedule?" />
        <div className="row" style={{ marginTop: 8 }}>
          <span className="hint grow">5-field cron, server time. Agents can also schedule themselves.</span>
          <button className="btn primary sm" disabled={!form.prompt.trim() || !local.length}>Add</button>
        </div>
        {error && <p className="err" style={{ fontSize: 12.5 }}>{error}</p>}
      </form>
      {rows.length === 0 && <div className="faint" style={{ fontSize: 13 }}>No schedules.</div>}
      {rows.map((s) => (
        <div key={s.id} className="sched">
          <div className="row">
            <code>{s.cron}</code>
            <b className="grow">{byId[s.agentId]?.name || "?"}</b>
            <label className="row muted" style={{ fontSize: 12, gap: 4 }}>
              <input type="checkbox" checked={!!s.enabled} onChange={async (e) => { await api.toggleSchedule(s.id, e.target.checked); load(); }} /> on
            </label>
            <button className="btn sm ghost danger" onClick={async () => { await api.deleteSchedule(s.id); load(); }}>Delete</button>
          </div>
          <div style={{ marginTop: 6, fontSize: 13 }}>{s.prompt}</div>
          <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
            {s.enabled && s.nextRun ? `next ${new Date(s.nextRun).toLocaleString()}` : "paused"}{s.lastRun ? ` · last ${timeAgo(s.lastRun)}` : ""}
          </div>
        </div>
      ))}
    </>
  );
}

/* ── files ────────────────────────────────────────────────── */

function FilesPanel({ officeId, feed }: { officeId: string; feed: FeedEntry[] }) {
  const [dir, setDir] = useState(".");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [open, setOpen] = useState<{ path: string; text: string } | null>(null);
  const [error, setError] = useState("");
  const toolCount = feed.filter((f) => f.kind === "tool").length;

  useEffect(() => {
    api.files(officeId, dir).then((r) => { setFiles(r.files); setError(""); }).catch((e) => setError(e.message));
  }, [officeId, dir, toolCount]);

  const join = (name: string) => (dir === "." ? name : `${dir}/${name}`);
  async function view(name: string) {
    const path = join(name);
    const res = await fetch(api.fileUrl(officeId, path));
    const text = await res.text();
    setOpen({ path, text: text.length > 200000 ? `${text.slice(0, 200000)}\n…` : text });
  }

  return (
    <>
      <div className="row mono" style={{ fontSize: 12, marginBottom: 8 }}>
        <button className="btn ghost sm" onClick={() => setDir(".")}>workspace</button>
        {dir !== "." && dir.split("/").map((seg, i, all) => (
          <span key={i} className="row" style={{ gap: 4 }}>/<button className="btn ghost sm" onClick={() => setDir(all.slice(0, i + 1).join("/"))}>{seg}</button></span>
        ))}
      </div>
      {error && <p className="err" style={{ fontSize: 12.5 }}>{error}</p>}
      {files.length === 0 && !error && <div className="faint" style={{ fontSize: 13 }}>Empty. Files agents write show up here.</div>}
      {files.map((f) => (
        <div key={f.name} className="file" onClick={() => (f.dir ? setDir(join(f.name)) : view(f.name))}>
          <span className="mono" style={{ color: f.dir ? "var(--accent)" : "var(--text)" }}>{f.dir ? `${f.name}/` : f.name}</span>
          <span className="grow" />
          {!f.dir && <span className="faint" style={{ fontSize: 12 }}>{f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(1)} KB`}</span>}
        </div>
      ))}
      {open && (
        <Modal title={open.path} onClose={() => setOpen(null)}>
          <pre className="viewer" style={{ marginTop: 12 }}>{open.text}</pre>
          <div className="modal-actions">
            <a className="btn" href={api.fileUrl(officeId, open.path, true)}>Download</a>
            <a className="btn" href={api.fileUrl(officeId, open.path)} target="_blank" rel="noreferrer">Open raw</a>
            <button className="btn primary" onClick={() => setOpen(null)}>Close</button>
          </div>
        </Modal>
      )}
    </>
  );
}
