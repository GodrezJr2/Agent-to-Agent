import { useEffect, useState } from "react";
import { api, type Activity, type Agent, type ToolInfo } from "./api";
import { Icon } from "./icons";
import { Monogram } from "./shared";
import { ModelPicker } from "./GatewayPanel";

type View = { kind: "tree" } | { kind: "edit"; agent: Agent | null } | { kind: "card"; agent: Agent };

export function TeamPanel({ officeId, agents, activity, tools, defaultModel, selectedId, onSelect, onChanged }: {
  officeId: string;
  agents: Agent[];
  activity: Record<string, Activity>;
  tools: ToolInfo[];
  defaultModel: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => void;
}) {
  const [view, setView] = useState<View>({ kind: "tree" });

  useEffect(() => {
    if (!selectedId) return;
    document.getElementById(`agent-${selectedId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  if (view.kind === "edit") {
    return <AgentEditor officeId={officeId} agent={view.agent} agents={agents} tools={tools} defaultModel={defaultModel}
      onDone={(changed) => { setView({ kind: "tree" }); if (changed) onChanged(); }} />;
  }
  if (view.kind === "card") return <AgentCard agent={view.agent} onBack={() => setView({ kind: "tree" })} />;

  const ids = new Set(agents.map((a) => a.id));
  const roots = agents.filter((a) => !a.managerId || !ids.has(a.managerId));
  const reportsOf = (id: string) => agents.filter((a) => a.managerId === id);

  async function remove(a: Agent) {
    if (!window.confirm(`Remove ${a.name}? Their task history and memories are deleted.`)) return;
    await api.deleteAgent(a.id);
    onChanged();
  }

  const node = (a: Agent) => {
    const act = activity[a.id];
    const reports = reportsOf(a.id);
    return (
      <li key={a.id}>
        <div id={`agent-${a.id}`} className={`node${selectedId === a.id ? " selected" : ""}`} onClick={() => onSelect(selectedId === a.id ? null : a.id)}>
          <Monogram id={a.id} name={a.name} />
          <div style={{ minWidth: 0 }}>
            <div className="node-name">
              <span>{a.name}</span>
              {!a.managerId && reports.length > 0 && <span className="badge">Lead</span>}
              {a.kind === "remote" && <span className="badge accent">External</span>}
            </div>
            <div className="node-sub">{a.role || "No role"}</div>
            <div className="node-model">{a.kind === "remote" ? a.remoteUrl : a.model || (defaultModel ? `${defaultModel} (default)` : "no model set")}</div>
            {act && (
              <div className="node-activity"><span className="dot working" /><span>{act.detail || (act.state === "thinking" ? "Thinking" : act.state)}</span></div>
            )}
          </div>
          <div className="node-actions" onClick={(e) => e.stopPropagation()}>
            {act && <button className="btn sm quiet icon" title="Stop" onClick={() => api.stopAgent(a.id)}><Icon name="square" /></button>}
            <button className="btn sm quiet icon" title="Edit" onClick={() => setView({ kind: "edit", agent: a })}><Icon name="pencil" /></button>
            <button className="btn sm quiet icon" title="A2A agent card" onClick={() => setView({ kind: "card", agent: a })}><Icon name="idcard" /></button>
            <button className="btn sm quiet icon danger" title="Remove" onClick={() => remove(a)}><Icon name="trash" /></button>
          </div>
        </div>
        {reports.length > 0 && <ul className="tree">{reports.map(node)}</ul>}
      </li>
    );
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="muted grow num">{agents.length} agent{agents.length === 1 ? "" : "s"}</span>
        <button className="btn sm primary" onClick={() => setView({ kind: "edit", agent: null })}><Icon name="plus" /> Hire</button>
      </div>
      {agents.length === 0
        ? <div className="empty" style={{ margin: "16px 4px" }}><h3>No one works here yet</h3><p>Hire a lead first (reports to nobody), then add reports under them. Messages without an @mention go to the lead.</p></div>
        : <ul className="tree">{roots.map(node)}</ul>}
    </>
  );
}

function AgentEditor({ officeId, agent, agents, tools, defaultModel, onDone }: {
  officeId: string; agent: Agent | null; agents: Agent[]; tools: ToolInfo[]; defaultModel: string; onDone: (changed: boolean) => void;
}) {
  const editing = !!agent;
  const [kind, setKind] = useState<"local" | "remote">(agent?.kind || "local");
  const [form, setForm] = useState({
    name: agent?.name || "", role: agent?.role || "", description: agent?.description || "",
    model: agent?.model || "", systemPrompt: agent?.systemPrompt || "", managerId: agent?.managerId || "",
    remoteUrl: agent?.remoteUrl || "", tools: agent?.tools?.length ? agent.tools : tools.map((t) => t.name),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const allTools = form.tools.length === tools.length;
    const payload: Partial<Agent> = {
      kind, name: form.name.trim(), role: form.role.trim(), description: form.description.trim(), managerId: form.managerId || null,
      ...(kind === "remote" ? { remoteUrl: form.remoteUrl.trim() } : { model: form.model.trim(), systemPrompt: form.systemPrompt, tools: allTools ? [] : form.tools }),
    };
    try {
      if (editing) await api.updateAgent(agent!.id, payload);
      else await api.createAgent(officeId, payload);
      onDone(true);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <div className="drawer-head">
        <button type="button" className="btn sm quiet icon" title="Back" onClick={() => onDone(false)}><Icon name="arrowLeft" /></button>
        <h2 className="grow">{editing ? `Edit ${agent!.name}` : "Hire an agent"}</h2>
      </div>
      {!editing && (
        <div className="seg" role="group" aria-label="Agent type" style={{ marginBottom: 14 }}>
          <button type="button" aria-pressed={kind === "local"} onClick={() => setKind("local")}>Local</button>
          <button type="button" aria-pressed={kind === "remote"} onClick={() => setKind("remote")}>External A2A</button>
        </div>
      )}
      {kind === "remote" && (
        <div className="field">
          <label className="label" htmlFor="ag-url">A2A base URL</label>
          <input id="ag-url" className="input mono" value={form.remoteUrl} onChange={set("remoteUrl")} placeholder="https://host/a2a/agent/" required />
          <span className="hint">Name and role are read from its agent card when left empty.</span>
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="ag-name">Name</label>
        <input id="ag-name" className="input" value={form.name} onChange={set("name")} required={kind === "local"} placeholder="Maya" />
      </div>
      <div className="field">
        <label className="label" htmlFor="ag-role">Role</label>
        <input id="ag-role" className="input" value={form.role} onChange={set("role")} placeholder="Tech Lead" />
      </div>
      <div className="field">
        <label className="label" htmlFor="ag-mgr">Reports to</label>
        <select id="ag-mgr" className="select" value={form.managerId} onChange={set("managerId")}>
          <option value="">Nobody (top of the org)</option>
          {agents.filter((a) => a.id !== agent?.id).map((a) => <option key={a.id} value={a.id}>{a.name}{a.role ? `, ${a.role}` : ""}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="ag-desc">What they are good at</label>
        <input id="ag-desc" className="input" value={form.description} onChange={set("description")} placeholder="Shown on the A2A agent card and to teammates" />
      </div>
      {kind === "local" && (
        <>
          <div className="field">
            <label className="label" htmlFor="ag-model">Model</label>
            <ModelPicker id="ag-model" value={form.model} onChange={(v) => setForm({ ...form, model: v })} placeholder={defaultModel ? `Default: ${defaultModel}` : "Pick a model or combo"} />
          </div>
          <div className="field">
            <label className="label" htmlFor="ag-sp">Instructions</label>
            <textarea id="ag-sp" className="textarea" value={form.systemPrompt} onChange={set("systemPrompt")} placeholder="Optional. Leave empty to build them from name, role, team and delegation rules." />
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: "12px 0 0" }}>
            <legend className="label" style={{ marginBottom: 4 }}>Tools</legend>
            <div className="checks">
              {tools.map((t) => (
                <label key={t.name} title={t.description}>
                  <input type="checkbox" checked={form.tools.includes(t.name)}
                    onChange={() => setForm({ ...form, tools: form.tools.includes(t.name) ? form.tools.filter((x) => x !== t.name) : [...form.tools, t.name] })} />
                  {t.name}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}
      {error && <p className="danger-text">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn quiet" onClick={() => onDone(false)}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Hire"}</button>
      </div>
    </form>
  );
}

function AgentCard({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  const [card, setCard] = useState<any>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { api.agentCard(agent.id).then(setCard).catch((e) => setError(e.message)); }, [agent.id]);
  return (
    <>
      <div className="drawer-head">
        <button className="btn sm quiet icon" title="Back" onClick={onBack}><Icon name="arrowLeft" /></button>
        <h2 className="grow">{agent.name}'s agent card</h2>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>Any A2A v1 client can reach {agent.name} at this URL over JSON-RPC. The card is public for discovery.</p>
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="input mono grow" readOnly value={agent.a2aUrl} aria-label="A2A URL" onFocus={(e) => e.currentTarget.select()} />
        <button className="btn icon" title="Copy URL" onClick={() => { navigator.clipboard?.writeText(agent.a2aUrl); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
          <Icon name={copied ? "check" : "copy"} />
        </button>
      </div>
      {error ? <p className="danger-text">{error}</p> : <pre className="viewer">{card ? JSON.stringify(card, null, 2) : "Loading…"}</pre>}
    </>
  );
}
