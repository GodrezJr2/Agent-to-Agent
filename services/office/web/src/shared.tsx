import { useEffect, useState, type ReactNode } from "react";
import { api, getApiKey, setApiKey, type GatewayStatus } from "./api";
import { BrandMark, Icon } from "./icons";

/* ── Theme (per viewer) ─────────────────────────────────────────────── */
type Theme = "system" | "light" | "dark";
const THEME_KEY = "office.theme";

function readTheme(): Theme {
  try { return (localStorage.getItem(THEME_KEY) as Theme) || "system"; } catch { return "system"; }
}
export function applyTheme(theme: Theme = readTheme()) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const next: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const label: Record<Theme, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };
  const icon: Record<Theme, "monitor" | "sun" | "moon"> = { system: "monitor", light: "sun", dark: "moon" };
  return (
    <button className="btn quiet icon" title={label[theme]} aria-label={label[theme]} onClick={() => {
      const t = next[theme];
      setTheme(t);
      try { localStorage.setItem(THEME_KEY, t); } catch { /* storage blocked */ }
      applyTheme(t);
    }}>
      <Icon name={icon[theme]} />
    </button>
  );
}

/* ── Chrome ─────────────────────────────────────────────────────────── */
export function TopBar({ children, gateway, onGatewayClick }: { children?: ReactNode; gateway?: GatewayStatus | null; onGatewayClick?: () => void }) {
  return (
    <header className="topbar">
      <a className="brand" href="#/"><BrandMark /> A2A Office</a>
      {children}
      <span className="spacer" />
      {gateway !== undefined && <GatewayPill status={gateway} onClick={onGatewayClick} />}
      <ThemeToggle />
    </header>
  );
}

export function GatewayPill({ status, onClick }: { status: GatewayStatus | null; onClick?: () => void }) {
  const state = !status ? "checking" : status.ok ? "ok" : "err";
  const text = !status ? "Checking 9router…" : status.ok ? `9router · ${status.modelCount} models` : status.status === 401 ? "9router · key rejected" : "9router · unreachable";
  return (
    <button className="pill" onClick={onClick} title={status?.ok ? `${status.baseUrl} · ${status.latencyMs} ms` : status?.error || ""} style={{ cursor: onClick ? "pointer" : "default" }}>
      <span className={`dot ${state === "ok" ? "ok" : state === "err" ? "err" : ""}`} />
      {text}
    </button>
  );
}

export function Dialog({ title, subtitle, onClose, children }: { title: string; subtitle?: ReactNode; onClose?: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {subtitle && <div className="muted" style={{ marginBottom: 12 }}>{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}

export function KeyPrompt({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState(getApiKey());
  return (
    <Dialog title="Unlock this office" subtitle={<>This server requires its <code>OFFICE_API_KEY</code>. It stays in this browser only.</>}>
      <form onSubmit={(e) => { e.preventDefault(); setApiKey(key.trim()); onSaved(); }}>
        <div className="field">
          <label className="label" htmlFor="apikey">API key</label>
          <input id="apikey" className="input mono" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} autoFocus />
        </div>
        <div className="form-actions"><button className="btn primary" disabled={!key.trim()}><Icon name="key" /> Unlock</button></div>
      </form>
    </Dialog>
  );
}

/* ── Identity & text ────────────────────────────────────────────────── */
export function hueFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function Monogram({ id, name, you, large }: { id?: string; name?: string; you?: boolean; large?: boolean }) {
  const letters = you ? "You" : (name || "?").trim().slice(0, 2);
  return (
    <span className={`mono-av${you ? " you" : ""}${large ? " lg" : ""}`} style={id ? ({ "--h": hueFor(id) } as React.CSSProperties) : undefined} aria-hidden="true">
      {you ? "Y" : letters[0].toUpperCase() + (letters[1] || "").toLowerCase()}
    </span>
  );
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Inline markdown: `code`, **bold**, *em*, [text](url). Builds React nodes, never HTML. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${m.index}`;
    if (m[1]) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={k}>{t.slice(1, -1)}</em>);
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      out.push(<a key={k} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+/;
const BLOCK_START = /^```|^#{1,4}\s|^\s*([-*+]|\d+[.)])\s+/;

/** Block markdown for agent replies: fenced code, headings, lists, paragraphs. */
export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={`c${i}`}><code>{body.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(<p key={`h${i}`} className="md-h">{inline(heading[1], `h${i}`)}</p>);
      i++;
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && LIST_ITEM.test(lines[i])) {
        items.push(<li key={i}>{inline(lines[i].replace(LIST_ITEM, ""), `l${i}`)}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={`o${i}`}>{items}</ol> : <ul key={`u${i}`}>{items}</ul>);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={`p${i}`}>{inline(para.join("\n"), `p${i}`)}</p>);
  }
  return <div className="md">{blocks}</div>;
}

/** Poll the gateway status (used by the top bar pill and the Gateway panel). */
export function useGateway(intervalMs = 60000) {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => api.gateway().then((s) => alive && setStatus(s)).catch(() => {});
    load();
    const t = setInterval(load, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [intervalMs, nonce]);
  return { status, refresh: () => { setStatus(null); setNonce((n) => n + 1); } };
}
