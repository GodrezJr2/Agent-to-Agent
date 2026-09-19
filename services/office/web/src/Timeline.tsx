import { Fragment, useEffect, useRef, useState } from "react";
import { api, type Activity, type Agent, type FeedEntry } from "./api";
import { Icon } from "./icons";
import { Monogram, RichText, clock, dayLabel } from "./shared";

export function Timeline({ officeId, agents, byId, feed, activity }: {
  officeId: string;
  agents: Agent[];
  byId: Record<string, Agent>;
  feed: FeedEntry[];
  activity: Record<string, Activity>;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = feedRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [feed, activity]);

  const working = Object.values(activity).filter((a) => byId[a.agentId]);
  const lead = agents.find((a) => !a.managerId) || agents[0];
  const name = (id: string | null) => (id && byId[id]?.name) || "Removed agent";

  let lastDay = "";
  return (
    <section className="thread" aria-label="Conversation">
      <div className="thread-head">
        {working.length
          ? <><span className="dot working" /><span>{working.map((a) => byId[a.agentId].name).join(", ")} working</span></>
          : <span>{feed.length ? "Idle" : "No conversation yet"}</span>}
        <span className="spacer" />
        {feed.length > 0 && (
          <button className="btn sm quiet" onClick={() => window.confirm("Start a new conversation? The timeline is cleared and agents forget this chat.") && api.clearFeed(officeId)}>
            New conversation
          </button>
        )}
      </div>

      <div className="feed" ref={feedRef} role="log" aria-live="polite"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {feed.length === 0 && (
          <div className="empty">
            {agents.length ? (
              <>
                <h3>Give the team its first task</h3>
                <p>Messages go to {lead ? <b>{lead.name}</b> : "the lead"} unless you @mention someone. Leads split the work and delegate to their reports over A2A; you will see every hand-off and tool call here.</p>
              </>
            ) : (
              <>
                <h3>This office is empty</h3>
                <p>Hire a lead in the Team tab, or create a new office from a starter team.</p>
              </>
            )}
          </div>
        )}

        {feed.map((f) => {
          const day = dayLabel(f.createdAt);
          const divider = day !== lastDay ? <div className="day">{day}</div> : null;
          lastDay = day;

          if (f.kind === "delegation") {
            return (
              <Fragment key={f.id}>
                {divider}
                <div className="trace">
                  <span className="trace-rail" />
                  <div className="trace-line">
                    <span>{name(f.fromAgentId)}</span><span className="to">→ {name(f.toAgentId)}</span>
                    <span className="clip" title={f.content}>{f.content}</span>
                  </div>
                </div>
              </Fragment>
            );
          }
          if (f.kind === "tool") {
            return (
              <Fragment key={f.id}>
                {divider}
                <div className="trace">
                  <span className="trace-rail" />
                  <div className="trace-line"><span>{name(f.agentId)}</span><span className="clip" title={f.content}>{f.content}</span></div>
                </div>
              </Fragment>
            );
          }

          const isUser = f.kind === "user";
          const agent = f.agentId ? byId[f.agentId] : undefined;
          const state = f.meta?.state as string | undefined;
          const meta = isUser
            ? (f.meta?.source === "schedule" ? "scheduled" : f.meta?.to?.length ? `to ${f.meta.to.map((id: string) => name(id)).join(", ")}` : "")
            : [agent?.role, f.toAgentId ? `reply to ${name(f.toAgentId)}` : ""].filter(Boolean).join(" · ");

          return (
            <Fragment key={f.id}>
              {divider}
              <article className={`entry${f.kind === "error" ? " error" : ""}`}>
                {isUser ? <Monogram you /> : <Monogram id={f.agentId || "x"} name={agent?.name || "?"} />}
                <div style={{ minWidth: 0 }}>
                  <div className="entry-head">
                    <b>{isUser ? "You" : agent?.name || "Office"}</b>
                    {meta && <span className="entry-meta">{meta}</span>}
                    {state && state !== "completed" && <span className={`badge${f.kind === "error" ? " err" : ""}`}>{state}</span>}
                    <time className="entry-time" dateTime={f.createdAt}>{clock(f.createdAt)}</time>
                  </div>
                  <div className="entry-body md-host"><RichText text={f.content} /></div>
                </div>
              </article>
            </Fragment>
          );
        })}

        {working.map((a) => (
          <div key={a.agentId} className="working-line">
            <span className="dot working" />
            <b>{byId[a.agentId].name}</b>
            <span className="muted">{a.detail || (a.state === "thinking" ? "is thinking" : a.state)}</span>
          </div>
        ))}
      </div>

      <Composer officeId={officeId} agents={agents} lead={lead} />
    </section>
  );
}

function Composer({ officeId, agents, lead }: { officeId: string; agents: Agent[]; lead?: Agent }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [mention, setMention] = useState<{ query: string; sel: number } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const candidates = mention ? agents.filter((a) => a.name.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 6) : [];

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value);
    const upto = e.target.value.slice(0, e.target.selectionStart);
    const m = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(upto);
    setMention(m ? { query: m[2], sel: 0 } : null);
  }

  function pick(agent: Agent) {
    const el = input.current!;
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

  return (
    <div className="composer">
      {mention && candidates.length > 0 && (
        <div className="popover mention-pop" role="listbox" aria-label="Mention an agent">
          {candidates.map((a, i) => (
            <button key={a.id} role="option" aria-selected={i === mention.sel} className="popover-item" style={{ gridTemplateColumns: "22px 1fr", display: "grid", alignItems: "center", gap: 8 }}
              onMouseDown={(e) => { e.preventDefault(); pick(a); }}>
              <Monogram id={a.id} name={a.name} />
              <span style={{ color: "var(--text)" }}><b>{a.name}</b> <span className="muted">{a.role}</span></span>
            </button>
          ))}
        </div>
      )}
      <div className="composer-box">
        <textarea ref={input} rows={1} value={text} onChange={onChange} onKeyDown={onKeyDown} disabled={!agents.length}
          aria-label="Message the office"
          placeholder={agents.length ? `Message ${lead ? lead.name : "the office"}, or @mention someone` : "Hire an agent first"} />
        <button className="btn primary icon" onClick={send} disabled={sending || !text.trim()} title="Send" aria-label="Send"><Icon name="send" /></button>
      </div>
      <div className="composer-hint">
        {error ? <span className="danger-text">{error}</span> : <><span><kbd>Enter</kbd> send</span><span><kbd>Shift</kbd>+<kbd>Enter</kbd> new line</span><span><kbd>@</kbd> mention</span></>}
      </div>
    </div>
  );
}
