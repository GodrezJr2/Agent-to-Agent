import { useState, type ReactNode } from "react";
import { getApiKey, setApiKey } from "./api";

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar">
      <a className="brand" href="#/">
        <span className="brand-mark"><i /></span>
        A2A Office
      </a>
      {children}
    </header>
  );
}

export function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {subtitle && <div className="muted" style={{ fontSize: 13 }}>{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}

export function KeyPrompt({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState(getApiKey());
  return (
    <Modal title="Office API key" subtitle="This office server is protected. Enter the OFFICE_API_KEY it was started with." onClose={() => {}}>
      <form onSubmit={(e) => { e.preventDefault(); setApiKey(key.trim()); onSaved(); }}>
        <label className="label" htmlFor="apikey">API key</label>
        <input id="apikey" className="input mono" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoFocus />
        <div className="modal-actions"><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  );
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Minimal rich text: fenced code blocks + inline code; everything else plain. */
export function RichText({ text }: { text: string }) {
  const parts = String(text).split(/```[\w-]*\n?([\s\S]*?)```/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <pre key={i}><code>{part.replace(/\n$/, "")}</code></pre> : (
          <span key={i}>
            {part.split(/(`[^`\n]+`)/g).map((s, j) => (s.startsWith("`") && s.endsWith("`") && s.length > 2 ? <code key={j}>{s.slice(1, -1)}</code> : s))}
          </span>
        ),
      )}
    </>
  );
}
