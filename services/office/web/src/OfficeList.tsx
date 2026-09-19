import { useEffect, useState } from "react";
import { api, ApiError, type Office } from "./api";
import { TopBar, KeyPrompt } from "./shared";

export function OfficeList() {
  const [offices, setOffices] = useState<Office[] | null>(null);
  const [error, setError] = useState("");
  const [needKey, setNeedKey] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = () =>
    api.offices()
      .then((r) => { setOffices(r.offices); setError(""); setNeedKey(false); })
      .catch((e) => (e instanceof ApiError && e.status === 401 ? setNeedKey(true) : setError(e.message)));

  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const { office } = await api.createOffice(name.trim());
      window.location.hash = `/office/${office.id}`;
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <TopBar />
      {needKey && <KeyPrompt onSaved={load} />}
      <main className="page">
        <h1>Offices</h1>
        <p className="muted">Each office is a team of A2A agents that think through your 9router gateway and share one workspace.</p>

        <form className="row" style={{ marginTop: 20, maxWidth: 520 }} onSubmit={create}>
          <input className="input grow" placeholder="New office name, e.g. Landing Page Studio" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" disabled={creating || !name.trim()}>Create office</button>
        </form>
        {error && <p className="err">{error}</p>}

        {offices && offices.length === 0 && <div className="empty">No offices yet. Create one, then hire a lead agent and a few reports.</div>}
        <div className="cards">
          {offices?.map((o) => (
            <a key={o.id} className="card" href={`#/office/${o.id}`}>
              <h3>{o.name}</h3>
              <div className="muted" style={{ fontSize: 13 }}>{o.agentCount ?? 0} agent{o.agentCount === 1 ? "" : "s"}</div>
              {o.description && <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>{o.description}</div>}
            </a>
          ))}
        </div>
      </main>
    </>
  );
}
