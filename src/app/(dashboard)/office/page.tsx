"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function OfficeIndex() {
  const router = useRouter();
  const [offices, setOffices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadOffices() {
    try {
      const res = await fetch("/api/offices");
      const data = await res.json();
      setOffices(data.offices || []);
    } catch {} finally { setLoading(false); }
  }

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWorkspace, setNewWorkspace] = useState("");

  useEffect(() => { loadOffices(); }, []);

  async function deleteOffice(id: string, name: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete office "${name}"? This removes all agents and chat history.`)) return;
    setDeletingId(id);
    try {
      await fetch(`/api/offices/${id}`, { method: "DELETE" });
      setOffices(prev => prev.filter(o => o.id !== id));
    } catch {} finally { setDeletingId(null); }
  }

  async function createOffice() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/offices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, description: "", workspacePath: newWorkspace || null }),
      });
      const data = await res.json();
      if (data.office) window.location.href = `/office/${data.office.id}`;
    } catch {} finally { setCreating(false); setShowCreate(false); }
  }

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm">&larr; Dashboard</Link>
            <h1 className="text-white text-2xl font-bold mt-2">Offices</h1>
            <p className="text-gray-500 text-sm mt-1">Your Agent OS workspaces</p>
          </div>
          <button onClick={() => setShowCreate(true)} disabled={creating}
            className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-500 disabled:opacity-50">
            {creating ? "Creating..." : "+ New Office"}
          </button>
        </div>

        {/* Create office modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreate(false)}>
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
              <h2 className="text-white text-lg font-semibold mb-4">New Office</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-gray-400 text-xs">Name *</label>
                  <input value={newName} onChange={e => setNewName(e.target.value)}
                    className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-green-500 outline-none"
                    placeholder="Marketing Team" autoFocus onKeyDown={e => e.key === "Enter" && createOffice()} />
                </div>
                <div>
                  <label className="text-gray-400 text-xs">Workspace Path (optional)</label>
                  <input value={newWorkspace} onChange={e => setNewWorkspace(e.target.value)}
                    className="w-full bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-green-500 outline-none"
                    placeholder="C:\Projects\my-app" />
                  <p className="text-gray-600 text-xs mt-1">Agents in this office can read/write files and run commands in this folder.</p>
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2 bg-gray-800 text-gray-300 text-sm rounded hover:bg-gray-700">Cancel</button>
                  <button onClick={createOffice} disabled={creating || !newName.trim()}
                    className="flex-1 px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-500 disabled:opacity-50">
                    {creating ? "Creating..." : "Create"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {loading && <p className="text-gray-500">Loading offices...</p>}

        {!loading && offices.length === 0 && (
          <div className="text-center py-16">
            <p className="text-gray-400 text-lg">No offices yet</p>
            <p className="text-gray-600 text-sm mt-1">Create your first office to get started</p>
            <button onClick={createOffice} disabled={creating}
              className="mt-4 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-500 disabled:opacity-50">
              {creating ? "Creating..." : "Create First Office"}
            </button>
          </div>
        )}

        <div className="grid gap-3">
          {offices.map((office) => (
            <Link key={office.id} href={`/office/${office.id}`}
              className="block p-4 bg-gray-800 border border-gray-700 rounded-lg hover:border-gray-500 transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-semibold">{office.name}</h3>
                  {office.description && <p className="text-gray-500 text-sm mt-0.5">{office.description}</p>}
                  <p className="text-gray-600 text-xs mt-1">Created {new Date(office.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={(e) => deleteOffice(office.id, office.name, e)}
                    disabled={deletingId === office.id}
                    className="px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors disabled:opacity-40"
                  >
                    {deletingId === office.id ? "..." : "Delete"}
                  </button>
                  <span className="text-gray-400 text-sm">&rarr;</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
