"use client";

import { useState, useEffect, useRef } from "react";

interface ChatMessage {
  id: string;
  officeId: string;
  agentId?: string;
  role: "user" | "agent" | "system";
  content: string;
  createdAt: string;
}

interface ChatPanelProps {
  officeId: string;
  agents: Array<{ id: string; name: string; role?: string }>;
  onAgentActivity: (agentId: string, active: boolean) => void;
}

export function ChatPanel({ officeId, agents, onAgentActivity }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/offices/${officeId}/chat?limit=50`)
      .then((r) => r.json())
      .then((d) => { setMessages(d.messages || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [officeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || sending) return;
    setSending(true);
    const content = input;
    setInput("");

    // Optimistic user message
    const userMsg: ChatMessage = {
      id: "opt-" + Date.now(),
      officeId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch(`/api/offices/${officeId}/chat/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) { setSending(false); return; }

      // Connect to SSE stream for live agent responses
      const eventSource = new EventSource(
        `/api/offices/${officeId}/chat/stream?content=${encodeURIComponent(content)}`
      );

      const agentResponses: Map<string, string> = new Map();

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "agent_start") {
          onAgentActivity(data.agentId, true);
        }

        if (data.type === "agent_chunk") {
          agentResponses.set(data.agentId, data.fullResponse);
          // Rebuild messages with latest agent responses
          setMessages((prev) => {
            const userMsgs = prev.filter((m) => m.role !== "agent" || !agentResponses.has(m.agentId!));
            const agentMsgs: ChatMessage[] = [];
            agentResponses.forEach((content, agentId) => {
              agentMsgs.push({
                id: `${agentId}-${Date.now()}`,
                officeId,
                agentId,
                role: "agent",
                content,
                createdAt: new Date().toISOString(),
              });
            });
            return [...userMsgs, ...agentMsgs];
          });
        }

        if (data.type === "agent_done") {
          onAgentActivity(data.agentId, false);
        }

        if (data.type === "all_done") {
          eventSource.close();
          setSending(false);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setSending(false);
      };
    } catch {
      setSending(false);
    }
  }

  function getAgentName(agentId?: string) {
    if (!agentId) return "System";
    const agent = agents.find((a) => a.id === agentId);
    return agent ? agent.name : agentId.slice(0, 8);
  }

  return (
    <div className="flex flex-col h-full bg-gray-950 border-l border-gray-800">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-800 text-sm font-semibold text-gray-300">
        Group Chat
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && <div className="text-gray-500 text-xs">Loading messages...</div>}
        {messages.map((msg) => (
          <div key={msg.id} className="text-sm">
            {msg.role === "agent" && (
              <span className="text-xs text-gray-500 mr-1">
                [{getAgentName(msg.agentId)}]
              </span>
            )}
            <span className={
              msg.role === "user" ? "text-white" :
              msg.role === "system" ? "text-yellow-400" :
              "text-green-300"
            }>
              {msg.content}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Message the office..."
            className="flex-1 bg-gray-800 text-white text-sm px-3 py-2 rounded border border-gray-700 focus:border-blue-500 outline-none"
            disabled={sending}
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {sending ? "..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
