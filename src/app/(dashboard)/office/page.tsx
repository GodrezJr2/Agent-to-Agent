"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function OfficeIndex() {
  const [offices, setOffices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function loadOffices() {
    try {
      const res = await fetch("/api/offices");
      const data = await res.json();
      setOffices(data.offices || []);
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => { loadOffices(); }, []);

  async function createOffice() {
    setCreating(true);
    try {
      const res = await fetch("/api/offices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Office", description: "" }),
      });
      const data = await res.json();
      if (data.office) window.location.href = `/office/${data.office.id}`;
    } catch {} finally { setCreating(false); }
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
          <button onClick={createOffice} disabled={creating}
            className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-500 disabled:opacity-50">
            {creating ? "Creating..." : "+ New Office"}
          </button>
        </div>

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
                <span className="text-gray-400 text-sm">&rarr;</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
