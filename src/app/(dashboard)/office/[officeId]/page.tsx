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
      };
      if (mode === "combo" && comboId) body.comboId = comboId;
      if (mode === "direct" && directModel) body.comboId = null; // Direct model overrides combo
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
                <option value="">Use default (OpenRouter Gemini Flash)</option>
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

export default function OfficePage() {
  const params = useParams();
  const router = useRouter();
  const officeId = params.officeId as string;
  const [office, setOffice] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const addAgent = useOfficeStore((s) => s.addAgent);
  const removeAgent = useOfficeStore((s) => s.removeAgent);
  const setAgentActive = useOfficeStore((s) => s.setAgentActive);
  const setAgentIdle = useOfficeStore((s) => s.setAgentIdle);

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
    <div className="flex flex-col h-screen bg-gray-900">
      {showAddModal && <AddAgentModal officeId={officeId} onClose={() => setShowAddModal(false)} onCreated={loadAgents} />}

      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">&larr; Dashboard</Link>
          <span className="text-gray-700">|</span>
          <h1 className="text-white font-semibold">{office.name}</h1>
          {office.description && <span className="text-gray-500 text-sm hidden sm:inline">{office.description}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs">{agents.length} agents</span>
          <button onClick={() => setShowAddModal(true)} className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-500 transition-colors">+ Add Agent</button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative min-w-0">
          <OfficeCanvas />
        </div>
        <div className="w-80 flex-shrink-0 border-l border-gray-800">
          <ChatPanel officeId={officeId} agents={agents} onAgentActivity={handleAgentActivity} />
        </div>
      </div>
    </div>
  );
}
