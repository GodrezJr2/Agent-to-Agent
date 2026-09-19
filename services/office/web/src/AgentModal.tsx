import { useEffect, useState } from "react";
import { api, type Agent, type ToolInfo } from "./api";
import { Modal } from "./shared";

type Props = {
  officeId: string;
  agent?: Agent | null;
  agents: Agent[];
  tools: ToolInfo[];
  defaultModel: string;
  onClose: () => void;
  onSaved: () => void;
};

export function AgentModal({ officeId, agent, agents, tools, defaultModel, onClose, onSaved }: Props) {
  const editing = !!agent;
  const [kind, setKind] = useState<"local" | "remote">(agent?.kind || "local");
  const [form, setForm] = useState({
    name: agent?.name || "",
    role: agent?.role || "",
    description: agent?.description || "",
    model: agent?.model || "",
    systemPrompt: agent?.systemPrompt || "",
    managerId: agent?.managerId || "",
    remoteUrl: agent?.remoteUrl || "",
    tools: agent?.tools?.length ? agent.tools : tools.map((t) => t.name),
  });
  const [models, setModels] = useState<string[]>([]);
  const [modelError, setModelError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.models().then((r) => setModels(r.models.map((m) => m.id))).catch((e) => setModelError(e.message));
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const toggleTool = (name: string) => setForm({ ...form, tools: form.tools.includes(name) ? form.tools.filter((t) => t !== name) : [...form.tools, name] });
  const managers = agents.filter((a) => a.id !== agent?.id);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const allTools = form.tools.length === tools.length;
    const payload: Partial<Agent> = {
      kind,
      name: form.name.trim(),
      role: form.role.trim(),
      description: form.description.trim(),
      managerId: form.managerId || null,
      ...(kind === "remote"
        ? { remoteUrl: form.remoteUrl.trim() }
        : { model: form.model.trim(), systemPrompt: form.systemPrompt, tools: allTools ? [] : form.tools }),
    };
    try {
      if (editing) await api.updateAgent(agent!.id, payload);
      else await api.createAgent(officeId, payload);
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={editing ? `Edit ${agent!.name}` : "Hire an agent"}
      subtitle={kind === "local" ? "A local agent runs here and thinks through 9router." : "An external agent reached over A2A by its URL."}
      onClose={onClose}
    >
      <form onSubmit={save}>
        {!editing && (
          <div className="seg" style={{ marginTop: 14 }}>
            <button type="button" className={kind === "local" ? "on" : ""} onClick={() => setKind("local")}>Local agent</button>
            <button type="button" className={kind === "remote" ? "on" : ""} onClick={() => setKind("remote")}>External A2A agent</button>
          </div>
        )}

        {kind === "remote" && (
          <>
            <label className="label" htmlFor="remoteUrl">A2A base URL</label>
            <input id="remoteUrl" className="input mono" placeholder="https://agent.example.com/a2a/" value={form.remoteUrl} onChange={set("remoteUrl")} required />
            <div className="hint">The agent card is read from <code>.well-known/agent-card.json</code> under this URL. Name and role are filled from it when left empty.</div>
          </>
        )}

        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="grow">
            <label className="label" htmlFor="name">Name</label>
            <input id="name" className="input" value={form.name} onChange={set("name")} placeholder="Maya" required={kind === "local"} />
          </div>
          <div className="grow">
            <label className="label" htmlFor="role">Role</label>
            <input id="role" className="input" value={form.role} onChange={set("role")} placeholder="Tech Lead" />
          </div>
        </div>

        <label className="label" htmlFor="manager">Reports to</label>
        <select id="manager" className="select" value={form.managerId} onChange={set("managerId")}>
          <option value="">Nobody (top of the org)</option>
          {managers.map((a) => <option key={a.id} value={a.id}>{a.name}{a.role ? ` (${a.role})` : ""}</option>)}
        </select>

        <label className="label" htmlFor="desc">Description</label>
        <input id="desc" className="input" value={form.description} onChange={set("description")} placeholder="What this agent is good at (shown on its agent card)" />

        {kind === "local" && (
          <>
            <label className="label" htmlFor="model">Model</label>
            <input id="model" className="input mono" list="model-list" value={form.model} onChange={set("model")} placeholder={defaultModel ? `default: ${defaultModel}` : "e.g. cc/claude-sonnet-5 or a combo name"} />
            <datalist id="model-list">{models.map((m) => <option key={m} value={m} />)}</datalist>
            <div className="hint">{modelError ? `Could not list 9router models: ${modelError}` : `${models.length} models and combos available from 9router.`}</div>

            <label className="label" htmlFor="sp">System prompt</label>
            <textarea id="sp" className="textarea" value={form.systemPrompt} onChange={set("systemPrompt")} placeholder="Optional. Leave empty for an automatic prompt built from name, role, team and delegation rules." />

            <label className="label">Tools</label>
            <div className="checks">
              {tools.map((t) => (
                <label key={t.name} title={t.description}>
                  <input type="checkbox" checked={form.tools.includes(t.name)} onChange={() => toggleTool(t.name)} />
                  {t.name}
                </label>
              ))}
            </div>
          </>
        )}

        {error && <p className="err">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save" : "Hire"}</button>
        </div>
      </form>
    </Modal>
  );
}
