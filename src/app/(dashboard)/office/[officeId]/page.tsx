"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { OfficeCanvas } from "@/office/components/OfficeCanvas";
import { ChatPanel } from "@/office/components/ChatPanel";
import { useOfficeStore } from "@/office/engine/officeStore";

function AddAgentModal({ officeId, onClose, onCreated }: { officeId: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [comboId, setComboId] = useState("");
  const [directModel, setDirectModel] = useState("");
  const [combos, setCombos] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [mode, setMode] = useState<"combo" | "direct">("combo");
  const [thinkingBudget, setThinkingBudget] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/combos").then(r => r.json()).then(d => setCombos(d.combos || [])).catch(() => {});
    fetch("/api/v1/models").then(r => r.json()).then(d => {
      const list = d.data || d.models || [];
      setModels(list);
    }).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required");
    setSubmitting(true);
    setError("");
    try {
      const body: any = {
        name: name.trim(),
        role: role.trim() || null,
        systemPrompt: systemPrompt.trim() || null,
        thinkingBudget: thinkingBudget,
      };
      if (mode === "combo" && comboId) body.comboId = comboId;
      if (mode === "direct" && directModel) body.modelId = directModel;
      const res = await fetch(`/api/offices/${officeId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { setError("Failed to create agent"); return; }
      onCreated();
      onClose();
    } catch { setError("Network error"); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-white text-lg font-semibold mb-4">Add Agent</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-gray-400 text-xs">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-green-500 outline-none" placeholder="Market Guru" autoFocus />
          </div>
          <div>
            <label className="text-gray-400 text-xs">Role</label>
            <input value={role} onChange={e => setRole(e.target.value)} className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-green-500 outline-none" placeholder="Market Analyst" />
          </div>

          {/* Model selection mode toggle */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">LLM Model</label>
            <div className="flex gap-1 mb-2">
              <button type="button" onClick={() => setMode("combo")}
                className={`flex-1 px-2 py-1 text-xs rounded ${mode === "combo" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"}`}>
                Combo
              </button>
              <button type="button" onClick={() => setMode("direct")}
                className={`flex-1 px-2 py-1 text-xs rounded ${mode === "direct" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"}`}>
                Pick Model
              </button>
            </div>

            {mode === "combo" ? (
              <select value={comboId} onChange={e => setComboId(e.target.value)}
                className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-green-500 outline-none">
                <option value="">Use first available combo</option>
                {combos.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <select value={directModel} onChange={e => setDirectModel(e.target.value)}
                className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-green-500 outline-none">
                <option value="">Use default (Gemini 2.5 Flash Free)</option>
                {models.map((m: any) => {
                  const id = m.id || m.model || m;
                  const name = typeof m === "string" ? m : (m.name || id);
                  return <option key={id} value={id}>{name}</option>;
                })}
              </select>
            )}
          </div>
           <div>
            <label className="text-gray-400 text-xs">System Prompt</label>
            <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={3} className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-green-500 outline-none resize-none" placeholder="You are a helpful market analyst..." />
          </div>
          <div>
            <label className="text-gray-400 text-xs">Thinking Budget (tokens, 0 = disabled)</label>
            <select value={thinkingBudget} onChange={e => setThinkingBudget(Number(e.target.value))} className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-green-500 outline-none">
              <option value={0}>Disabled</option>
              <option value={1000}>1,000 (light)</option>
              <option value={2000}>2,000 (moderate)</option>
              <option value={4000}>4,000 (default)</option>
              <option value={8000}>8,000 (deep)</option>
              <option value={16000}>16,000 (max)</option>
            </select>
            <p className="text-gray-600 text-xs mt-1">Only works with models that support thinking (Claude, DeepSeek R1, Gemini). Ignored otherwise.</p>
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-gray-800 text-gray-300 text-sm rounded hover:bg-gray-700">Cancel</button>
            <button type="submit" disabled={submitting} className="flex-1 px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-500 disabled:opacity-50">{submitting ? "Creating..." : "Create Agent"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditAgentModal({ officeId, agent, allAgents, onClose, onUpdated }: { officeId: string; agent: any; allAgents: any[]; onClose: () => void; onUpdated: () => void }) {
  const [name, setName] = useState(agent.name || "");
  const [role, setRole] = useState(agent.role || "");
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt || "");
  const [managerId, setManagerId] = useState(agent.managerId || "");
  const [thinkingBudget, setThinkingBudget] = useState(agent.thinkingBudget ?? 0);
  const [mode, setMode] = useState<"combo" | "direct">(agent.modelId ? "direct" : "combo");
  const [comboId, setComboId] = useState(agent.comboId || "");
  const [directModel, setDirectModel] = useState(agent.modelId || "");
  const [combos, setCombos] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [tasks, setTasks] = useState<any[]>([]);
  const [tab, setTab] = useState<"edit" | "tasks">("edit");
  // Other agents this agent can report to (exclude self)
  const potentialManagers = allAgents.filter((a) => a.id !== agent.id);

  useEffect(() => {
    fetch("/api/combos").then(r => r.json()).then(d => setCombos(d.combos || [])).catch(() => {});
    fetch("/api/v1/models").then(r => r.json()).then(d => setModels(d.data || d.models || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === "tasks") {
      fetch(`/api/agents/${agent.id}/a2a`).then(r => r.json()).then(d => setTasks(d.recentTasks || [])).catch(() => {});
    }
  }, [tab, agent.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required");
    setSubmitting(true);
    setError("");
    try {
      const body: any = { name: name.trim(), role: role.trim() || null, systemPrompt: systemPrompt.trim() || null, managerId: managerId || null, thinkingBudget };
      if (mode === "combo") { body.comboId = comboId || null; body.modelId = null; }
      if (mode === "direct") { body.modelId = directModel || null; body.comboId = null; }
      const res = await fetch(`/api/offices/${officeId}/agents/${agent.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { setError("Failed to update agent"); return; }
      onUpdated();
      onClose();
    } catch { setError("Network error"); }
    finally { setSubmitting(false); }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${agent.name}"?`)) return;
    try {
      await fetch(`/api/offices/${officeId}/agents/${agent.id}`, { method: "DELETE" });
      onUpdated();
      onClose();
    } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white text-lg font-semibold">{agent.name}</h2>
          <button onClick={handleDelete} className="text-red-400 text-xs hover:text-red-300">Delete</button>
        </div>
        {/* Tabs */}
        <div className="flex gap-1 mb-4">
          {(["edit", "tasks"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs rounded capitalize ${tab === t ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"}`}>
              {t === "tasks" ? "A2A Tasks" : "Edit"}
            </button>
          ))}
        </div>

        {tab === "edit" && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-gray-400 text-xs">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-green-500 outline-none" autoFocus />
          </div>
          <div>
            <label className="text-gray-400 text-xs">Role</label>
            <input value={role} onChange={e => setRole(e.target.value)} className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-green-500 outline-none" />
          </div>
          {potentialManagers.length > 0 && (
          <div>
            <label className="text-gray-400 text-xs">Reports to (Manager)</label>
            <select value={managerId} onChange={e => setManagerId(e.target.value)}
              className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-green-500 outline-none">
              <option value="">— No manager (top-level) —</option>
              {potentialManagers.map((a: any) => (
                <option key={a.id} value={a.id}>{a.name}{a.role ? ` (${a.role})` : ""}</option>
              ))}
            </select>
          </div>
          )}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">LLM Model</label>
            <div className="flex gap-1 mb-2">
              <button type="button" onClick={() => setMode("combo")}
                className={`flex-1 px-2 py-1 text-xs rounded ${mode === "combo" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"}`}>
                Combo
              </button>
              <button type="button" onClick={() => setMode("direct")}
                className={`flex-1 px-2 py-1 text-xs rounded ${mode === "direct" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"}`}>
                Pick Model
              </button>
            </div>
            {mode === "combo" ? (
              <select value={comboId} onChange={e => setComboId(e.target.value)}
                className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-green-500 outline-none">
                <option value="">Use first available combo</option>
                {combos.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <select value={directModel} onChange={e => setDirectModel(e.target.value)}
                className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-green-500 outline-none">
                <option value="">Use default (free fallback)</option>
                {models.map((m: any) => {
                  const id = m.id || m.model || m;
                  const label = typeof m === "string" ? m : (m.name || id);
                  return <option key={id} value={id}>{label}</option>;
                })}
              </select>
            )}
          </div>
          <div>
            <label className="text-gray-400 text-xs">System Prompt</label>
            <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={3} className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-green-500 outline-none resize-none" />
          </div>
            <label className="text-gray-400 text-xs mt-3 block">Thinking Budget (tokens, 0 = disabled)</label>
            <select value={thinkingBudget} onChange={e => setThinkingBudget(Number(e.target.value))} className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-green-500 outline-none">
              <option value={0}>Disabled</option>
              <option value={1000}>1,000 (light)</option>
              <option value={2000}>2,000 (moderate)</option>
              <option value={4000}>4,000 (default)</option>
              <option value={8000}>8,000 (deep)</option>
              <option value={16000}>16,000 (max)</option>
            </select>
            <p className="text-gray-600 text-xs mt-1">Only works with models that support thinking (Claude, DeepSeek R1, Gemini).</p>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-gray-800 text-gray-300 text-sm rounded hover:bg-gray-700">Cancel</button>
              <button type="submit" disabled={submitting} className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 disabled:opacity-50">{submitting ? "Saving..." : "Save"}</button>
            </div>
        </form>
        )}

        {tab === "tasks" && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {tasks.length === 0 && <p className="text-gray-500 text-xs text-center py-4">No A2A tasks yet</p>}
          {tasks.map((t: any) => (
            <div key={t.id} className="bg-gray-800 rounded p-2 text-xs">
              <div className="flex justify-between items-center mb-1">
                <span className={`font-medium ${t.status === "completed" ? "text-green-400" : t.status === "failed" ? "text-red-400" : t.status === "working" ? "text-yellow-400" : "text-gray-400"}`}>{t.status}</span>
                <span className="text-gray-600">{new Date(t.createdAt).toLocaleTimeString()}</span>
              </div>
              <p className="text-gray-300 truncate">{t.input?.message || JSON.stringify(t.input)}</p>
              {t.output?.message?.parts?.[0]?.text && (
                <p className="text-gray-500 truncate mt-1">{t.output.message.parts[0].text}</p>
              )}
            </div>
          ))}
          <div className="pt-2">
            <button onClick={onClose} className="w-full px-4 py-2 bg-gray-800 text-gray-300 text-sm rounded hover:bg-gray-700">Close</button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

const AGENT_COLORS = ["#4ade80", "#60a5fa", "#f472b6", "#fb923c", "#a78bfa", "#34d399"];
function agentColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return AGENT_COLORS[Math.abs(h) % AGENT_COLORS.length];
}

function OrgNode({ agent, allAgents, depth, onEdit }: { agent: any; allAgents: any[]; depth: number; onEdit: (a: any) => void }) {
  const reports = allAgents.filter((a) => a.managerId === agent.id);
  const color = agentColor(agent.id);
  return (
    <div style={{ marginLeft: depth > 0 ? 16 : 0 }}>
      <div
        onClick={() => onEdit(agent)}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
          borderRadius: 6, cursor: "pointer", marginBottom: 2,
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#1f1f35")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {/* Tree line */}
        {depth > 0 && (
          <span style={{ color: "#374151", fontSize: 12, marginLeft: -4, flexShrink: 0 }}>└─</span>
        )}
        {/* Avatar */}
        <div style={{
          width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
          background: color + "22", border: `1.5px solid ${color}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700, color,
        }}>
          {agent.name.charAt(0).toUpperCase()}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {agent.name}
          </div>
          {agent.role && (
            <div style={{ fontSize: 10, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {agent.role}
            </div>
          )}
        </div>
        {reports.length > 0 && (
          <span style={{ fontSize: 10, color: "#4b5563", marginLeft: "auto", flexShrink: 0, background: "#1a1a2e", borderRadius: 10, padding: "1px 6px" }}>
            {reports.length}
          </span>
        )}
      </div>
      {reports.map((r) => (
        <OrgNode key={r.id} agent={r} allAgents={allAgents} depth={depth + 1} onEdit={onEdit} />
      ))}
    </div>
  );
}

function OrgPanel({ agents, onEdit }: { agents: any[]; onEdit: (a: any) => void }) {
  // Agents with no manager are top-level
  const roots = agents.filter((a) => !a.managerId);
  // Agents that have a managerId pointing to a non-existent agent (orphans)
  const orphans = agents.filter((a) => a.managerId && !agents.find((x) => x.id === a.managerId));

  const managerCount = agents.filter((a) => agents.some((x) => x.managerId === a.id)).length;
  const leafCount = agents.filter((a) => !agents.some((x) => x.managerId === a.id)).length;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#0d0d1a", borderRight: "1px solid #1f1f2e" }}>
      {/* Header */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #1f1f2e" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>Org Chart</div>
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#6b7280", background: "#1a1a2e", borderRadius: 10, padding: "1px 7px" }}>
            {agents.length} agents
          </span>
          {managerCount > 0 && (
            <span style={{ fontSize: 10, color: "#a78bfa", background: "#1a1a2e", borderRadius: 10, padding: "1px 7px" }}>
              {managerCount} managers
            </span>
          )}
        </div>
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
        {agents.length === 0 && (
          <p style={{ fontSize: 11, color: "#374151", textAlign: "center", marginTop: 20 }}>No agents yet</p>
        )}
        {roots.map((a) => (
          <OrgNode key={a.id} agent={a} allAgents={agents} depth={0} onEdit={onEdit} />
        ))}
        {orphans.length > 0 && (
          <>
            <div style={{ fontSize: 10, color: "#4b5563", padding: "8px 8px 4px", marginTop: 4, borderTop: "1px solid #1f1f2e" }}>
              Unlinked
            </div>
            {orphans.map((a) => (
              <OrgNode key={a.id} agent={a} allAgents={agents} depth={0} onEdit={onEdit} />
            ))}
          </>
        )}
      </div>

      {/* Legend */}
      <div style={{ padding: "8px 12px", borderTop: "1px solid #1f1f2e" }}>
        <div style={{ fontSize: 10, color: "#374151" }}>Click an agent to edit · Set manager in agent settings</div>
      </div>
    </div>
  );
}

export default function OfficePage() {
  const params = useParams();
  const router = useRouter();
  const officeId = params.officeId as string;
  const [office, setOffice] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<any>(null);
  const [editingName, setEditingName] = useState(false);
  const [showOrgPanel, setShowOrgPanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsWorkspace, setSettingsWorkspace] = useState("");
  const [nameInput, setNameInput] = useState("");
  const addAgent = useOfficeStore((s) => s.addAgent);
  const removeAgent = useOfficeStore((s) => s.removeAgent);
  const setAgentActive = useOfficeStore((s) => s.setAgentActive);
  const setAgentIdle = useOfficeStore((s) => s.setAgentIdle);

  // Prevent browser-level zoom (Ctrl+scroll / pinch) on the entire office page
  // so only the canvas zoom is used — chat panel stays fixed size.
  useEffect(() => {
    const preventBrowserZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const preventKeyZoom = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
        e.preventDefault();
      }
    };
    document.addEventListener('wheel', preventBrowserZoom, { passive: false });
    document.addEventListener('keydown', preventKeyZoom);
    return () => {
      document.removeEventListener('wheel', preventBrowserZoom);
      document.removeEventListener('keydown', preventKeyZoom);
    };
  }, []);

  async function loadAgents() {
    try {
      const res = await fetch(`/api/offices/${officeId}/agents`);
      const data = await res.json();
      const newList = data.agents || [];
      setAgents(newList);

      // Remove agents no longer present, add new ones
      const currentIds = new Set(useOfficeStore.getState().characters.keys());
      const newIds = new Set(newList.map((a: any) => a.id));

      // Remove stale agents
      currentIds.forEach((id) => {
        if (!newIds.has(id)) removeAgent(id);
      });

      // Add new agents
      newList.forEach((a: any) => addAgent(a));
    } catch {}
  }

  async function loadOrCreateOffice() {
    setLoading(true);
    setError(null);
    try {
      const officeRes = await fetch(`/api/offices/${officeId}`);
      const officeData = await officeRes.json();

      if (officeData.office) {
        setOffice(officeData.office);
        await loadAgents();
        setLoading(false);
        return;
      }

      if (officeId === "default" || officeRes.status === 404) {
        const createRes = await fetch("/api/offices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Default Office", description: "Your first Agent OS office" }),
        });
        const createData = await createRes.json();
        if (createData.office) {
          router.replace(`/office/${createData.office.id}`);
          return;
        }
      }

      setError("Office not found");
    } catch {
      setError("Failed to load office");
    }
    setLoading(false);
  }

  useEffect(() => {
    loadOrCreateOffice();
  }, [officeId]);

  useEffect(() => {
    return () => {
      useOfficeStore.getState().characters.forEach((_, id) => removeAgent(id));
    };
  }, [removeAgent]);

  async function handleRename() {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === office.name) { setEditingName(false); return; }
    try {
      const res = await fetch(`/api/offices/${officeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, description: office.description }),
      });
      if (res.ok) {
        const data = await res.json();
        setOffice(data.office);
      }
    } catch {}
    setEditingName(false);
  }

  const handleAgentActivity = useCallback((agentId: string, active: boolean) => {
    if (active) setAgentActive(agentId, "chat");
    else setAgentIdle(agentId);
  }, [setAgentActive, setAgentIdle]);

  if (loading) {
    return <div className="flex items-center justify-center h-screen bg-gray-900 text-gray-400">Loading office...</div>;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-900 gap-4">
        <p className="text-gray-400">{error}</p>
        <Link href="/dashboard" className="text-blue-400 hover:text-blue-300 text-sm">&larr; Back to Dashboard</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {showAddModal && <AddAgentModal officeId={officeId} onClose={() => setShowAddModal(false)} onCreated={loadAgents} />}
      {editingAgent && <EditAgentModal officeId={officeId} agent={editingAgent} allAgents={agents} onClose={() => setEditingAgent(null)} onUpdated={loadAgents} />}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowSettings(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-white text-lg font-semibold mb-4">Office Settings</h2>
            <div className="space-y-3">
              <div>
                <label className="text-gray-400 text-xs">Workspace Path</label>
                <input defaultValue={office.workspacePath || ""} onChange={e => setSettingsWorkspace(e.target.value)}
                  className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-blue-500 outline-none"
                  placeholder="C:\Projects\my-app" />
                <div className="flex gap-1 mt-1 flex-wrap">
                  {["C:\\Projects", "C:\\Users\\Administrator\\Desktop", "C:\\Users\\Administrator\\Documents"].map(p => (
                    <button key={p} onClick={() => setSettingsWorkspace(p)} className="text-xs px-2 py-0.5 bg-gray-800 text-gray-400 rounded hover:bg-gray-700 hover:text-white transition-colors">
                      {p.split("\\").pop()}
                    </button>
                  ))}
                </div>
                <p className="text-gray-600 text-xs mt-1">Any folder — agents stay sandboxed inside. Quick buttons above, or type full path.</p>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowSettings(false)} className="flex-1 px-4 py-2 bg-gray-800 text-gray-300 text-sm rounded hover:bg-gray-700">Cancel</button>
                <button onClick={async () => {
                  await fetch(`/api/offices/${officeId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspacePath: settingsWorkspace || null }) });
                  setOffice({ ...office, workspacePath: settingsWorkspace || null });
                  setShowSettings(false);
                }} className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-500">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">&larr; Dashboard</Link>
          <span className="text-gray-700">|</span>
          {editingName ? (
            <input
              autoFocus
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onBlur={handleRename}
              onKeyDown={e => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditingName(false); }}
              className="bg-gray-800 text-white font-semibold text-sm px-2 py-0.5 rounded border border-blue-500 outline-none w-40"
            />
          ) : (
            <h1
              className="text-white font-semibold cursor-pointer hover:text-blue-300 transition-colors"
              title="Click to rename"
              onClick={() => { setNameInput(office.name); setEditingName(true); }}
            >
              {office.name}
            </h1>
          )}
          {office.description && <span className="text-gray-500 text-sm hidden sm:inline">{office.description}</span>}
          <button
            onClick={() => setShowSettings(true)}
            className="text-gray-500 hover:text-gray-300 text-sm ml-1"
            title="Office settings"
          >
            ⚙
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowOrgPanel((p) => !p)}
            title="Toggle Org Chart"
            style={{
              padding: "3px 10px", fontSize: 12, borderRadius: 6, border: "1px solid",
              borderColor: showOrgPanel ? "#6366f1" : "#374151",
              background: showOrgPanel ? "#1e1b4b" : "transparent",
              color: showOrgPanel ? "#a5b4fc" : "#6b7280",
              cursor: "pointer", transition: "all 0.15s",
            }}
          >
            Org
          </button>
          <span className="text-gray-500 text-xs">{agents.length} agents</span>
          <button onClick={() => setShowAddModal(true)} className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-500 transition-colors">+ Add Agent</button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {showOrgPanel && (
          <div className="w-52 flex-shrink-0">
            <OrgPanel agents={agents} onEdit={(a) => setEditingAgent(a)} />
          </div>
        )}
        <div className="flex-1 relative min-w-0 min-h-0 overflow-hidden">
          <OfficeCanvas onAgentClick={(id) => { const a = agents.find(x => x.id === id); if (a) setEditingAgent(a); }} />
        </div>
        <div className="w-80 h-full min-h-0 flex-shrink-0 overflow-hidden border-l border-gray-800">
          <ChatPanel officeId={officeId} agents={agents} onAgentActivity={handleAgentActivity} />
        </div>
      </div>
    </div>
  );
}
