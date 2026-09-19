import { useEffect, useState } from "react";
import { api, ApiError, type LayoutTemplate, type Office, type TeamTemplate } from "./api";
import { Icon } from "./icons";
import { KeyPrompt, TopBar, timeAgo, useGateway } from "./shared";
import { ModelPicker } from "./GatewayPanel";

export function Home() {
  const [offices, setOffices] = useState<Office[] | null>(null);
  const [needKey, setNeedKey] = useState(false);
  const [error, setError] = useState("");
  const { status: gateway } = useGateway();

  const load = () =>
    api.offices()
      .then((r) => { setOffices(r.offices); setNeedKey(false); setError(""); })
      .catch((e) => (e instanceof ApiError && e.status === 401 ? setNeedKey(true) : setError(e.message)));
  useEffect(() => { load(); }, []);

  return (
    <div className="app">
      <TopBar gateway={gateway} />
      {needKey && <KeyPrompt onSaved={load} />}
      <main className="home">
        <div className="home-inner">
          <section>
            <h1>Offices</h1>
            <p className="home-lede">Each office is a team of A2A agents with a shared workspace. They think through your 9router gateway and delegate to each other by name.</p>
            {error && <p className="danger-text">{error}</p>}
            {offices?.length === 0 && (
              <div className="empty" style={{ margin: "8px 0" }}>
                <h3>No offices yet</h3>
                <p>Create one on the right. A starter team gives you a lead and a few reports so you can send the first task right away.</p>
              </div>
            )}
            <nav aria-label="Offices">
              {offices?.map((o) => (
                <a key={o.id} className="office-row" href={`#/office/${o.id}`}>
                  <span className="grow">
                    <b>{o.name}</b>
                    {o.description && <span className="muted"> · {o.description}</span>}
                  </span>
                  <span className="muted num">{o.agentCount ?? 0} agent{o.agentCount === 1 ? "" : "s"}</span>
                  <span className="faint" style={{ fontSize: 12 }}>{timeAgo(o.createdAt)}</span>
                </a>
              ))}
            </nav>
          </section>
          <aside className="stack" style={{ gap: 16 }}>
            <CreateOffice defaultModel={gateway?.defaultModel || ""} />
            {gateway && !gateway.ok && (
              <div className="status-block bad" role="status">
                <b>9router is not reachable</b>
                <span className="muted">{gateway.status === 401
                  ? "The gateway rejected the API key. Create a key in the 9router dashboard and set GATEWAY_API_KEY in office.env, then restart the office."
                  : `${gateway.error || "No response"}. Check GATEWAY_URL (${gateway.baseUrl}).`}</span>
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

function CreateOffice({ defaultModel }: { defaultModel: string }) {
  const [teams, setTeams] = useState<TeamTemplate[]>([]);
  const [layouts, setLayouts] = useState<LayoutTemplate[]>([]);
  const [name, setName] = useState("");
  const [team, setTeam] = useState("web-studio");
  const [layout, setLayout] = useState("studio");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.teamTemplates().then((r) => setTeams(r.teams)).catch(() => {});
    api.layoutTemplates().then(setLayouts).catch(() => {});
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const tpl = layouts.find((l) => l.id === layout);
      const layoutJson = tpl ? await api.layoutTemplate(tpl.file) : undefined;
      const { office } = await api.createOffice({ name: name.trim(), team: team || undefined, model: model.trim(), layout: layoutJson });
      window.location.hash = `/office/${office.id}`;
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="create" onSubmit={create}>
      <h2>New office</h2>
      <div className="field">
        <label className="label" htmlFor="office-name">Name</label>
        <input id="office-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Landing page studio" required />
      </div>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: "14px 0 0" }}>
        <legend className="label" style={{ marginBottom: 4 }}>Starter team</legend>
        {teams.map((t) => (
          <label key={t.id} className="choice">
            <input type="radio" name="team" value={t.id} checked={team === t.id} onChange={() => setTeam(t.id)} />
            <span><b>{t.name}</b><span>{t.agents.map((a) => a.role).join(" · ")}</span></span>
          </label>
        ))}
        <label className="choice">
          <input type="radio" name="team" value="" checked={team === ""} onChange={() => setTeam("")} />
          <span><b>Empty</b><span>Hire agents yourself</span></span>
        </label>
      </fieldset>

      {team && (
        <div className="field" style={{ marginTop: 12 }}>
          <label className="label" htmlFor="office-model">Model for the team</label>
          <ModelPicker id="office-model" value={model} onChange={setModel} placeholder={defaultModel ? `Default: ${defaultModel}` : "Pick a model or combo"} />
        </div>
      )}

      <div className="field" style={{ marginTop: 12 }}>
        <label className="label" htmlFor="office-layout">Office layout</label>
        <select id="office-layout" className="select" value={layout} onChange={(e) => setLayout(e.target.value)}>
          {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <span className="hint">{layouts.find((l) => l.id === layout)?.description} You can redecorate any time with Edit layout.</span>
      </div>

      {error && <p className="danger-text" style={{ marginBottom: 0 }}>{error}</p>}
      <div className="form-actions">
        <button className="btn primary" disabled={busy || !name.trim()}><Icon name="plus" /> {busy ? "Creating…" : "Create office"}</button>
      </div>
    </form>
  );
}
