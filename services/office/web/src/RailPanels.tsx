import { useCallback, useEffect, useState } from "react";
import { api, type Agent, type FileEntry, type Schedule } from "./api";
import { Icon } from "./icons";
import { formatBytes, timeAgo } from "./shared";

export function SchedulesPanel({ officeId, agents, byId }: { officeId: string; agents: Agent[]; byId: Record<string, Agent> }) {
  const [rows, setRows] = useState<Schedule[] | null>(null);
  const local = agents.filter((a) => a.kind === "local");
  const [form, setForm] = useState({ agentId: "", cron: "0 9 * * 1-5", prompt: "" });
  const [error, setError] = useState("");
  const load = useCallback(() => api.schedules(officeId).then((r) => setRows(r.schedules)).catch((e) => setError(e.message)), [officeId]);
  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.createSchedule(officeId, { ...form, agentId: form.agentId || local[0]?.id });
      setForm({ ...form, prompt: "" });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <>
      <form onSubmit={add} className="rail-section">
        <h3 className="rail-title">New schedule</h3>
        <div className="row">
          <select className="select grow" value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })} aria-label="Agent">
            {local.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input className="input mono" style={{ width: 128 }} value={form.cron} onChange={(e) => setForm({ ...form, cron: e.target.value })} aria-label="Cron expression" />
        </div>
        <textarea className="textarea" style={{ marginTop: 8, minHeight: 56 }} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="What should happen each time? e.g. Check the API status page and post a summary to Discord." />
        <div className="row" style={{ marginTop: 8 }}>
          <span className="hint grow">5-field cron in server time. Agents can also schedule themselves.</span>
          <button className="btn sm primary" disabled={!form.prompt.trim() || !local.length}>Add</button>
        </div>
        {error && <p className="danger-text" style={{ margin: "6px 0 0" }}>{error}</p>}
      </form>

      <h3 className="rail-title">Scheduled <span className="num">{rows?.length ?? ""}</span></h3>
      {rows?.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing scheduled.</p>}
      <ul className="list">
        {rows?.map((s) => (
          <li key={s.id} style={{ padding: "10px 2px" }}>
            <div className="row">
              <code>{s.cron}</code>
              <b className="grow">{byId[s.agentId]?.name || "Removed agent"}</b>
              <label className="row muted" style={{ gap: 4, fontSize: 12 }}>
                <input type="checkbox" checked={!!s.enabled} onChange={async (e) => { await api.toggleSchedule(s.id, e.target.checked); load(); }} /> Active
              </label>
              <button className="btn sm quiet icon danger" title="Delete" onClick={async () => { await api.deleteSchedule(s.id); load(); }}><Icon name="trash" /></button>
            </div>
            <div style={{ marginTop: 4 }}>{s.prompt}</div>
            <div className="hint" style={{ marginTop: 2 }}>
              {s.enabled && s.nextRun ? `Next ${new Date(s.nextRun).toLocaleString()}` : "Paused"}{s.lastRun ? ` · last ran ${timeAgo(s.lastRun)}` : ""}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function FilesPanel({ officeId, refreshKey }: { officeId: string; refreshKey: number }) {
  const [dir, setDir] = useState(".");
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [open, setOpen] = useState<{ path: string; text: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.files(officeId, dir).then((r) => { setFiles(r.files); setError(""); }).catch((e) => setError(e.message));
  }, [officeId, dir, refreshKey]);

  const join = (name: string) => (dir === "." ? name : `${dir}/${name}`);
  async function view(name: string) {
    const path = join(name);
    const text = await (await fetch(api.fileUrl(officeId, path))).text();
    setOpen({ path, text: text.length > 200000 ? `${text.slice(0, 200000)}\n…` : text });
  }

  if (open) {
    return (
      <>
        <div className="drawer-head">
          <button className="btn sm quiet icon" title="Back" onClick={() => setOpen(null)}><Icon name="arrowLeft" /></button>
          <h2 className="grow mono" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis" }}>{open.path}</h2>
          <a className="btn sm quiet icon" title="Open raw" href={api.fileUrl(officeId, open.path)} target="_blank" rel="noreferrer"><Icon name="external" /></a>
          <a className="btn sm quiet icon" title="Download" href={api.fileUrl(officeId, open.path, true)}><Icon name="download" /></a>
        </div>
        <pre className="viewer">{open.text}</pre>
      </>
    );
  }

  return (
    <>
      <nav className="row mono" aria-label="Folder" style={{ fontSize: 12, marginBottom: 8, gap: 2, flexWrap: "wrap" }}>
        <button className="btn sm quiet" onClick={() => setDir(".")}>workspace</button>
        {dir !== "." && dir.split("/").map((seg, i, all) => (
          <span key={i} className="row" style={{ gap: 2 }}><span className="faint">/</span><button className="btn sm quiet" onClick={() => setDir(all.slice(0, i + 1).join("/"))}>{seg}</button></span>
        ))}
      </nav>
      {error && <p className="danger-text">{error}</p>}
      {files?.length === 0 && <p className="muted" style={{ margin: "4px 6px" }}>Empty. Anything the team writes appears here.</p>}
      {files?.map((f) => (
        <button key={f.name} className="file" onClick={() => (f.dir ? setDir(join(f.name)) : view(f.name))}>
          <Icon name={f.dir ? "folder" : "file"} />
          <span className="mono" style={{ fontSize: 12 }}>{f.name}</span>
          {!f.dir && <span className="size">{formatBytes(f.size)}</span>}
        </button>
      ))}
    </>
  );
}
