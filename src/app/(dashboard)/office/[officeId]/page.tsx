"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { OfficeCanvas } from "@/office/components/OfficeCanvas";
import { ChatPanel } from "@/office/components/ChatPanel";
import { useOfficeStore } from "@/office/engine/officeStore";

export default function OfficePage() {
  const params = useParams();
  const router = useRouter();
  const officeId = params.officeId as string;
  const [office, setOffice] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const addAgent = useOfficeStore((s) => s.addAgent);
  const removeAgent = useOfficeStore((s) => s.removeAgent);
  const setAgentActive = useOfficeStore((s) => s.setAgentActive);
  const setAgentIdle = useOfficeStore((s) => s.setAgentIdle);

  async function loadOrCreateOffice() {
    setLoading(true);
    setError(null);
    try {
      // Try to load the office
      const officeRes = await fetch(`/api/offices/${officeId}`);
      const officeData = await officeRes.json();

      if (officeData.office) {
        // Office exists — load agents
        const agentsRes = await fetch(`/api/offices/${officeId}/agents`);
        const agentsData = await agentsRes.json();
        setOffice(officeData.office);
        setAgents(agentsData.agents || []);
        (agentsData.agents || []).forEach((a: any) => addAgent(a));
        setLoading(false);
        return;
      }

      // Office not found — try creating a default one
      if (officeId === "default" || officeRes.status === 404) {
        const createRes = await fetch("/api/offices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Default Office", description: "Your first Agent OS office" }),
        });
        const createData = await createRes.json();
        if (createData.office) {
          // Redirect to the new office
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
  }, [officeId, addAgent]);

  // Cleanup agents on unmount
  useEffect(() => {
    return () => {
      agents.forEach((a) => removeAgent(a.id));
    };
  }, [agents, removeAgent]);

  const handleAgentActivity = useCallback((agentId: string, active: boolean) => {
    if (active) {
      setAgentActive(agentId, "chat");
    } else {
      setAgentIdle(agentId);
    }
  }, [setAgentActive, setAgentIdle]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-gray-400">
        Loading office...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-900 gap-4">
        <p className="text-gray-400">{error}</p>
        <Link href="/dashboard" className="text-blue-400 hover:text-blue-300 text-sm">
          &larr; Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">
            &larr; Dashboard
          </Link>
          <span className="text-gray-700">|</span>
          <h1 className="text-white font-semibold">{office.name}</h1>
          {office.description && (
            <span className="text-gray-500 text-sm hidden sm:inline">{office.description}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-xs">{agents.length} agents</span>
          <button className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-500 transition-colors">
            + Add Agent
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative min-w-0">
          <OfficeCanvas />
        </div>
        <div className="w-80 flex-shrink-0 border-l border-gray-800">
          <ChatPanel
            officeId={officeId}
            agents={agents}
            onAgentActivity={handleAgentActivity}
          />
        </div>
      </div>
    </div>
  );
}
