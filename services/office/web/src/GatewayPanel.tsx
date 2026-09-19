import { useEffect, useMemo, useRef, useState } from "react";
import { api, type GatewayStatus, type PingResult } from "./api";
import { Icon } from "./icons";

// Model list shared by every picker on the page; refreshed at most once a minute.
let modelCache: { at: number; promise: Promise<GatewayStatus> } | null = null;
function loadGateway(force = false) {
  if (force || !modelCache || Date.now() - modelCache.at > 60000) modelCache = { at: Date.now(), promise: api.gateway() };
  return modelCache.promise;
}

/** Text input with a grouped, searchable list of 9router models and combos. */
export function ModelPicker({ id, value, onChange, placeholder }: { id?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [ping, setPing] = useState<PingResult | "testing" | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => { loadGateway().then(setStatus).catch(() => {}); }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => setPing(null), [value]);

  const q = value.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!status?.ok) return [];
    const match = (m: string) => !q || m.toLowerCase().includes(q);
    const out: { label: string; items: string[] }[] = [];
    const combos = status.combos.filter(match);
    if (combos.length) out.push({ label: "Combos", items: combos });
    for (const p of status.providers) {
      const items = p.models.filter(match);
      if (items.length) out.push({ label: p.prefix, items });
    }
    return out;
  }, [status, q]);

  const known = !value || !status?.ok || status.combos.includes(value) || status.providers.some((p) => p.models.includes(value));

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <div className="row" style={{ gap: 6 }}>
        <input id={id} className="input mono grow" value={value} placeholder={placeholder} autoComplete="off" spellCheck={false}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} />
        <button type="button" className="btn icon" title="Send a test prompt through 9router" disabled={!value || ping === "testing"}
          onClick={async () => { setPing("testing"); setPing(await api.pingModel(value).catch((e) => ({ ok: false, model: value, latencyMs: 0, error: e.message }))); }}>
          <Icon name="zap" />
        </button>
      </div>
      {ping && (
        <div className="hint" role="status" style={{ marginTop: 4, color: ping !== "testing" && !ping.ok ? "var(--danger)" : undefined }}>
          {ping === "testing" ? "Testing…" : ping.ok ? `Responded in ${ping.latencyMs} ms` : ping.error}
        </div>
      )}
      {!ping && !known && <div className="hint" style={{ marginTop: 4 }}>Not in the 9router model list. It will fail unless 9router can route it.</div>}
      {open && groups.length > 0 && (
        <div id={`${id}-list`} className="popover" role="listbox" style={{ top: "calc(100% + 4px)", left: 0, right: 0, maxHeight: 280, overflowY: "auto" }}>
          {groups.map((g) => (
            <div key={g.label}>
              <div className="popover-head">{g.label}</div>
              {g.items.slice(0, 40).map((m) => (
                <button key={m} type="button" role="option" aria-selected={m === value} className="popover-item mono" style={{ fontSize: 12 }}
                  onMouseDown={(e) => { e.preventDefault(); onChange(m); setOpen(false); }}>{m}</button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Rail tab: what the office can reach through 9router right now. */
export function GatewayPanel() {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [test, setTest] = useState<Record<string, PingResult | "testing">>({});
  const [copied, setCopied] = useState("");

  const refresh = (force = false) => { setStatus(null); loadGateway(force).then(setStatus).catch(() => {}); };
  useEffect(() => refresh(), []);

  const q = filter.trim().toLowerCase();
  const providers = (status?.providers || []).map((p) => ({ ...p, shown: p.models.filter((m) => !q || m.toLowerCase().includes(q)) })).filter((p) => p.shown.length);
  const combos = (status?.combos || []).filter((c) => !q || c.toLowerCase().includes(q));

  async function runTest(model: string) {
    setTest((t) => ({ ...t, [model]: "testing" }));
    const r = await api.pingModel(model).catch((e) => ({ ok: false, model, latencyMs: 0, error: e.message }));
    setTest((t) => ({ ...t, [model]: r }));
  }

  const ModelRow = ({ m }: { m: string }) => {
    const t = test[m];
    return (
      <li>
        <span className={`dot ${t && t !== "testing" ? (t.ok ? "ok" : "err") : ""}`} title={t && t !== "testing" ? (t.ok ? `${t.latencyMs} ms` : t.error) : "Not tested"} />
        <span className="clip grow" title={m}>{m}</span>
        {t && t !== "testing" && t.ok && <span className="faint num">{t.latencyMs} ms</span>}
        <button className="btn sm quiet icon" title="Copy id" onClick={() => { navigator.clipboard?.writeText(m); setCopied(m); setTimeout(() => setCopied(""), 1200); }}>
          <Icon name={copied === m ? "check" : "copy"} />
        </button>
        <button className="btn sm quiet icon" title="Test" disabled={t === "testing"} onClick={() => runTest(m)}><Icon name="zap" /></button>
      </li>
    );
  };

  if (!status) return <div className="muted">Checking 9router…</div>;

  return (
    <>
      <div className={`status-block${status.ok ? "" : " bad"}`}>
        <div className="row">
          <span className={`dot ${status.ok ? "ok" : "err"}`} />
          <b className="grow">{status.ok ? "Connected to 9router" : status.status === 401 ? "API key rejected" : "9router unreachable"}</b>
          <button className="btn sm quiet icon" title="Refresh" onClick={() => refresh(true)}><Icon name="refresh" /></button>
        </div>
        <dl className="kv">
          <dt>Endpoint</dt><dd className="mono">{status.baseUrl}</dd>
          {status.ok && <><dt>Models</dt><dd className="num">{status.modelCount} across {status.providers.length} providers, {status.combos.length} combos</dd></>}
          {status.ok && <><dt>Latency</dt><dd className="num">{status.latencyMs} ms</dd></>}
          <dt>Default</dt>
          <dd>{status.defaultModel
            ? <><span className="mono">{status.defaultModel}</span>{!status.defaultModelAvailable && <span className="badge err" style={{ marginLeft: 6 }}>not available</span>}</>
            : <span className="faint">none (set DEFAULT_MODEL)</span>}</dd>
        </dl>
        {!status.ok && <span className="muted">{status.status === 401
          ? "Create an API key in the 9router dashboard, put it in office.env as GATEWAY_API_KEY, and restart the office."
          : status.error}</span>}
      </div>

      {status.ok && (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <input className="input" placeholder="Filter models" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter models" />
          </div>
          {combos.length > 0 && (
            <div className="rail-section">
              <h3 className="rail-title">Combos <span className="num">{combos.length}</span></h3>
              <ul className="model-list" style={{ marginLeft: 0 }}>{combos.map((c) => <ModelRow key={c} m={c} />)}</ul>
            </div>
          )}
          <div className="rail-section">
            <h3 className="rail-title">Providers <span className="num">{providers.length}</span></h3>
            <ul className="list">
              {providers.map((p) => {
                const expanded = !!q || !!open[p.prefix];
                return (
                  <li key={p.prefix}>
                    <button className="disclosure" aria-expanded={expanded} onClick={() => setOpen((o) => ({ ...o, [p.prefix]: !o[p.prefix] }))}>
                      <Icon name="chevron" />
                      <span className="mono grow">{p.prefix}</span>
                      <span className="faint num">{p.shown.length}</span>
                    </button>
                    {expanded && <ul className="model-list">{p.shown.map((m) => <ModelRow key={m} m={m} />)}</ul>}
                  </li>
                );
              })}
            </ul>
            {!providers.length && !combos.length && <p className="muted">No model matches “{filter}”.</p>}
          </div>
        </>
      )}
    </>
  );
}
