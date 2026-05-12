"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface ChatMessage {
  id: string;
  officeId: string;
  agentId?: string;
  role: "user" | "agent" | "system";
  content: string;
  createdAt: string;
}

interface StreamingState {
  full: string;
  cursor: number;
}

interface ChatPanelProps {
  officeId: string;
  agents: Array<{ id: string; name: string; role?: string }>;
  onAgentActivity: (agentId: string, active: boolean) => void;
}

const TYPEWRITER_MS = 12; // ms per character
const CHARS_PER_TICK = 3; // chars to reveal per tick (faster for long responses)

// Parse @mentions from input for display purposes
function detectMentions(content: string): string[] {
  const regex = /@"([^"]+)"|@([\w\-]+)/g;
  const mentions: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    mentions.push((match[1] || match[2]).toLowerCase());
  }
  return mentions;
}

export function ChatPanel({ officeId, agents, onAgentActivity }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  // Agents showing "..." thinking dots
  const [thinkingAgents, setThinkingAgents] = useState<Set<string>>(new Set());
  // Agent thinking/reasoning text (collapsible)
  const [thoughtBubbles, setThoughtBubbles] = useState<Map<string, string>>(new Map());
  // Agents doing typewriter animation: agentId → { full text, cursor position }
  const [streaming, setStreaming] = useState<Map<string, StreamingState>>(new Map());
  // @mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionDropdown, setMentionDropdown] = useState<Array<{ id: string; name: string; role?: string }>>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamingRef = useRef<Map<string, StreamingState>>(new Map());
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/offices/${officeId}/chat?limit=100`)
      .then((r) => r.json())
      .then((d) => { setMessages(d.messages || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [officeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinkingAgents, streaming]);

  // Typewriter ticker — advances cursor for all streaming agents
  const startTicker = useCallback(() => {
    if (tickerRef.current) return;
    tickerRef.current = setInterval(() => {
      const current = streamingRef.current;
      if (current.size === 0) {
        clearInterval(tickerRef.current!);
        tickerRef.current = null;
        return;
      }
      let changed = false;
      const next = new Map(current);
      for (const [id, state] of next) {
        if (state.cursor < state.full.length) {
          next.set(id, { ...state, cursor: Math.min(state.cursor + CHARS_PER_TICK, state.full.length) });
          changed = true;
        }
      }
      if (changed) {
        streamingRef.current = next;
        setStreaming(new Map(next));
      }
    }, TYPEWRITER_MS);
  }, []);

  function getAgentName(agentId?: string) {
    if (!agentId) return "System";
    const agent = agents.find((a) => a.id === agentId);
    return agent ? agent.name : agentId.slice(0, 8);
  }

  function getAgentInitial(agentId?: string) {
    return getAgentName(agentId).charAt(0).toUpperCase();
  }

  // Assign a stable color per agent
  const AGENT_COLORS = ["#4ade80", "#60a5fa", "#f472b6", "#fb923c", "#a78bfa", "#34d399"];
  function getAgentColor(agentId?: string) {
    if (!agentId) return "#9ca3af";
    let hash = 0;
    for (let i = 0; i < agentId.length; i++) hash = agentId.charCodeAt(i) + ((hash << 5) - hash);
    return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
  }

  function handleInputChange(val: string) {
    setInput(val);
    // Detect if user just typed @ to trigger autocomplete
    const atMatch = val.match(/@([\w\-]*)$/);
    if (atMatch) {
      const query = atMatch[1].toLowerCase();
      setMentionQuery(query);
      const filtered = agents.filter((a) =>
        a.name.toLowerCase().includes(query) || (a.role || "").toLowerCase().includes(query)
      );
      setMentionDropdown(filtered);
    } else {
      setMentionQuery(null);
      setMentionDropdown([]);
    }
  }

  function insertMention(agent: { id: string; name: string; role?: string }) {
    // Replace the trailing @query with @AgentName
    const name = agent.name.includes(" ") ? `"${agent.name}"` : agent.name;
    const newVal = input.replace(/@([\w\-]*)$/, `@${name} `);
    setInput(newVal);
    setMentionQuery(null);
    setMentionDropdown([]);
    inputRef.current?.focus();
  }

  async function handleSend() {
    if (!input.trim() || sending) return;
    setMentionQuery(null);
    setMentionDropdown([]);
    setSending(true);
    const content = input;
    setInput("");

    // Optimistic user message shown immediately in UI
    const optId = "opt-" + Date.now();
    const userMsg: ChatMessage = {
      id: optId,
      officeId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      // No separate chat/send call — stream route saves user message atomically
      const eventSource = new EventSource(
        `/api/offices/${officeId}/chat/stream?content=${encodeURIComponent(content)}`
      );

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "routing_info") {
          // Show a system message indicating who's being called
          const names = data.targetAgentNames.join(", ");
          setMessages((prev) => [...prev, {
            id: `routing-${Date.now()}`,
            officeId,
            agentId: undefined,
            role: "system",
            content: `→ Calling: ${names}`,
            createdAt: new Date().toISOString(),
          }]);
        }

        if (data.type === "agent_start") {
          onAgentActivity(data.agentId, true);
          setThinkingAgents((prev) => new Set([...prev, data.agentId]));
        }

        if (data.type === "agent_chunk") {
          // Stop thinking dots, start typewriter
          setThinkingAgents((prev) => {
            const next = new Set(prev);
            next.delete(data.agentId);
            return next;
          });
          // Capture thinking/reasoning if present
          if (data.thinking) {
            setThoughtBubbles((prev) => new Map(prev).set(data.agentId, data.thinking));
          }
          const state: StreamingState = { full: data.fullResponse, cursor: 0 };
          streamingRef.current = new Map(streamingRef.current).set(data.agentId, state);
          setStreaming(new Map(streamingRef.current));
          startTicker();
          // Add the message shell (typewriter will fill it in via streaming state)
          setMessages((prev) => {
            const without = prev.filter((m) => !(m.role === "agent" && m.agentId === data.agentId));
            return [...without, {
              id: `${data.agentId}-stream`,
              officeId,
              agentId: data.agentId,
              role: "agent",
              content: data.fullResponse,
              createdAt: new Date().toISOString(),
            }];
          });
        }

        if (data.type === "agent_error") {
          setThinkingAgents((prev) => {
            const next = new Set(prev);
            next.delete(data.agentId);
            return next;
          });
          setMessages((prev) => [...prev, {
            id: `err-${data.agentId}-${Date.now()}`,
            officeId,
            agentId: data.agentId,
            role: "system",
            content: `Error: ${data.error}`,
            createdAt: new Date().toISOString(),
          }]);
        }

        if (data.type === "agent_done") {
          onAgentActivity(data.agentId, false);
          // Remove from streaming map once typewriter finishes
          const finishWhenDone = () => {
            const s = streamingRef.current.get(data.agentId);
            if (!s || s.cursor >= s.full.length) {
              streamingRef.current = new Map(streamingRef.current);
              streamingRef.current.delete(data.agentId);
              setStreaming(new Map(streamingRef.current));
            } else {
              setTimeout(finishWhenDone, 100);
            }
          };
          setTimeout(finishWhenDone, 100);
        }

        if (data.type === "all_done") {
          eventSource.close();
          setThinkingAgents(new Set());
          setSending(false);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setSending(false);
        setThinkingAgents(new Set());
        // Reload from DB so history is consistent even if stream was cut
        fetch(`/api/offices/${officeId}/chat?limit=100`)
          .then((r) => r.json())
          .then((d) => { if (d.messages) setMessages(d.messages); })
          .catch(() => {});
      };
    } catch {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "#0f0f17", borderLeft: "1px solid #1f1f2e" }}>
      {/* Header */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #1f1f2e", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: sending ? "#4ade80" : "#374151", transition: "background 0.3s", boxShadow: sending ? "0 0 6px #4ade80" : "none" }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>Office Chat</span>
        <span style={{ fontSize: 11, color: "#4b5563", marginLeft: "auto" }}>{agents.length} agent{agents.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
        {loading && (
          <div style={{ color: "#4b5563", fontSize: 12, textAlign: "center", marginTop: 20 }}>Loading...</div>
        )}

        {messages.map((msg) => {
          const isUser = msg.role === "user";
          const isSystem = msg.role === "system";
          const color = getAgentColor(msg.agentId);
          const streamState = msg.agentId ? streaming.get(msg.agentId) : undefined;
          // Show typewriter text if this agent is animating
          const displayText = streamState ? msg.content.slice(0, streamState.cursor) : msg.content;
          const isTyping = !!streamState && streamState.cursor < streamState.full.length;

          if (isUser) {
            return (
              <div key={msg.id} style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={{
                  background: "#1d4ed8",
                  color: "#fff",
                  borderRadius: "12px 12px 2px 12px",
                  padding: "7px 12px",
                  fontSize: 13,
                  maxWidth: "80%",
                  lineHeight: 1.5,
                  wordBreak: "break-word",
                }}>
                  {msg.content}
                </div>
              </div>
            );
          }

          if (isSystem) {
            return (
              <div key={msg.id} style={{ display: "flex", justifyContent: "center" }}>
                <span style={{ fontSize: 11, color: "#f59e0b", background: "rgba(245,158,11,0.1)", borderRadius: 4, padding: "2px 8px" }}>
                  {msg.content}
                </span>
              </div>
            );
          }

          return (
            <div key={msg.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              {/* Avatar */}
              <div style={{
                width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                background: color + "22", border: `1.5px solid ${color}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color, marginTop: 1,
              }}>
                {getAgentInitial(msg.agentId)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color, fontWeight: 600, marginBottom: 3 }}>
                  {getAgentName(msg.agentId)}
                </div>
                <div style={{
                  background: "#161622",
                  border: "1px solid #1f1f35",
                  borderRadius: "2px 12px 12px 12px",
                  padding: "8px 11px",
                  fontSize: 13,
                  color: "#d1d5db",
                  lineHeight: 1.6,
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap",
                }}>
                  {msg.agentId && thoughtBubbles.has(msg.agentId) && (
                    <details style={{ marginBottom: 8, fontSize: 12, color: "#9ca3af", background: "#0f0f1a", borderRadius: 6, padding: "6px 10px" }}>
                      <summary style={{ cursor: "pointer", fontWeight: 500, color: "#a78bfa" }}>Thinking...</summary>
                      <div style={{ marginTop: 6, whiteSpace: "pre-wrap", color: "#9ca3af" }}>{thoughtBubbles.get(msg.agentId)}</div>
                    </details>
                  )}
                  {displayText}
                  {isTyping && (
                    <span style={{
                      display: "inline-block",
                      width: 2,
                      height: "1em",
                      background: color,
                      marginLeft: 1,
                      verticalAlign: "text-bottom",
                      animation: "blink 0.7s step-end infinite",
                    }} />
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Thinking dots for agents waiting on LLM */}
        {Array.from(thinkingAgents).map((agentId) => {
          const color = getAgentColor(agentId);
          return (
            <div key={`thinking-${agentId}`} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                background: color + "22", border: `1.5px solid ${color}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color, marginTop: 1,
              }}>
                {getAgentInitial(agentId)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color, fontWeight: 600, marginBottom: 3 }}>
                  {getAgentName(agentId)}
                </div>
                <div style={{
                  background: "#161622",
                  border: "1px solid #1f1f35",
                  borderRadius: "2px 12px 12px 12px",
                  padding: "10px 14px",
                  display: "inline-flex",
                  gap: 5,
                  alignItems: "center",
                }}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} style={{
                      width: 7, height: 7, borderRadius: "50%",
                      background: color,
                      display: "inline-block",
                      animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                      opacity: 0.85,
                    }} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "10px 12px", borderTop: "1px solid #1f1f2e", position: "relative" }}>
        {/* @mention autocomplete dropdown */}
        {mentionDropdown.length > 0 && (
          <div style={{
            position: "absolute", bottom: "100%", left: 12, right: 12,
            background: "#1a1a2e", border: "1px solid #2d2d44",
            borderRadius: 8, overflow: "hidden", boxShadow: "0 -4px 16px rgba(0,0,0,0.4)",
            marginBottom: 4, zIndex: 100,
          }}>
            {mentionDropdown.map((a) => (
              <div
                key={a.id}
                onClick={() => insertMention(a)}
                style={{
                  padding: "7px 12px", cursor: "pointer", display: "flex",
                  alignItems: "center", gap: 8,
                  borderBottom: "1px solid #1f1f35",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#2d2d44")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: "50%",
                  background: getAgentColor(a.id) + "22",
                  border: `1.5px solid ${getAgentColor(a.id)}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700, color: getAgentColor(a.id),
                }}>
                  {a.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>{a.name}</span>
                  {a.role && <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 6 }}>{a.role}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Mention routing preview */}
        {(() => {
          const mentions = detectMentions(input);
          if (mentions.length === 0 || sending) return null;
          const matched = agents.filter((a) =>
            mentions.some((m) => a.name.toLowerCase().includes(m) || (a.role || "").toLowerCase().includes(m))
          );
          if (matched.length === 0) return null;
          return (
            <div style={{ marginBottom: 6, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#6b7280" }}>→</span>
              {matched.map((a) => (
                <span key={a.id} style={{
                  fontSize: 11, color: getAgentColor(a.id),
                  background: getAgentColor(a.id) + "18",
                  border: `1px solid ${getAgentColor(a.id)}44`,
                  borderRadius: 12, padding: "1px 7px",
                }}>
                  {a.name}
                </span>
              ))}
            </div>
          );
        })()}

        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setMentionQuery(null); setMentionDropdown([]); }
              else if (e.key === "Enter" && mentionDropdown.length === 0) handleSend();
            }}
            placeholder="Message the office... (use @name to target)"
            disabled={sending}
            style={{
              flex: 1,
              background: "#161622",
              color: "#e2e8f0",
              fontSize: 13,
              padding: "8px 12px",
              border: "1px solid #2d2d44",
              borderRadius: 8,
              outline: "none",
              opacity: sending ? 0.6 : 1,
            }}
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            style={{
              padding: "8px 16px",
              background: sending ? "#1d2d44" : "#2563eb",
              color: "#fff",
              fontSize: 13,
              borderRadius: 8,
              border: "none",
              cursor: sending || !input.trim() ? "not-allowed" : "pointer",
              opacity: !input.trim() ? 0.4 : 1,
              transition: "background 0.2s",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {sending ? "Waiting..." : "Send"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
