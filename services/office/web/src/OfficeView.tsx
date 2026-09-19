import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type Activity, type Agent, type FeedEntry, type Office, type ToolInfo } from "./api";
import { KeyPrompt, TopBar, useGateway } from "./shared";
import { PixelOffice } from "./PixelOffice";
import { Timeline } from "./Timeline";
import { TeamPanel } from "./TeamPanel";
import { GatewayPanel } from "./GatewayPanel";
import { FilesPanel, SchedulesPanel } from "./RailPanels";

type Tab = "team" | "gateway" | "schedules" | "files";
const TABS: { id: Tab; label: string }[] = [
  { id: "team", label: "Team" },
  { id: "gateway", label: "Gateway" },
  { id: "schedules", label: "Schedules" },
  { id: "files", label: "Files" },
];

export function OfficeView({ officeId }: { officeId: string }) {
  const [office, setOffice] = useState<Office | null>(null);
  const [offices, setOffices] = useState<Office[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [activity, setActivity] = useState<Record<string, Activity>>({});
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [needKey, setNeedKey] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("team");
  const [selected, setSelected] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const { status: gateway } = useGateway();

  const loadOffice = useCallback(() =>
    api.office(officeId).then((r) => {
      setOffice(r.office);
      setAgents(r.agents);
      setActivity(Object.fromEntries(r.activity.map((a) => [a.agentId, a])));
      setNeedKey(false);
    }).catch((e) => (e instanceof ApiError && e.status === 401 ? setNeedKey(true) : setError(e.message))), [officeId]);

  useEffect(() => {
    loadOffice();
    api.feed(officeId).then((r) => setFeed(r.feed)).catch(() => {});
    api.config().then((c) => { setTools(c.tools); setDefaultModel(c.defaultModel); }).catch(() => {});
    api.offices().then((r) => setOffices(r.offices)).catch(() => {});
  }, [officeId, loadOffice, needKey]);

  useEffect(() => {
    if (needKey) return;
    return api.stream(officeId, {
      open: () => setConnected(true),
      error: () => setConnected(false),
      feed: (entry) => setFeed((f) => (f.some((x) => x.id === entry.id) ? f : [...f, entry])),
      activity: (a) => setActivity((cur) => {
        const next = { ...cur };
        if (a.state === "idle") delete next[a.agentId];
        else next[a.agentId] = a;
        return next;
      }),
      changed: (what) => {
        if (what === "agents") loadOffice();
        if (what === "feed") setFeed([]);
      },
    });
  }, [officeId, needKey, loadOffice]);

  const byId = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);
  const toolCount = feed.filter((f) => f.kind === "tool").length;

  useEffect(() => { document.title = office ? `${office.name} · A2A Office` : "A2A Office"; }, [office]);

  return (
    <div className="app">
      <TopBar gateway={gateway} onGatewayClick={() => setTab("gateway")}>
        <span className="crumb-sep">/</span>
        <select className="switcher" value={officeId} aria-label="Switch office" onChange={(e) => { window.location.hash = e.target.value ? `/office/${e.target.value}` : "/"; }}>
          {!offices.some((o) => o.id === officeId) && <option value={officeId}>{office?.name || "…"}</option>}
          {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          <option value="">All offices…</option>
        </select>
        <span className="pill" title={connected ? "Receiving live updates" : "Reconnecting to the office stream"}>
          <span className={`dot ${connected ? "ok" : ""}`} />{connected ? "Live" : "Connecting"}
        </span>
      </TopBar>
      {needKey && <KeyPrompt onSaved={() => setNeedKey(false)} />}

      <div className="workspace">
        <div className="main">
          <div className="stage">
            <PixelOffice key={officeId} officeId={officeId} agents={agents} activity={activity}
              onAgentClick={(id) => { setTab("team"); setSelected(id); }} />
          </div>
          <Timeline officeId={officeId} agents={agents} byId={byId} feed={feed} activity={activity} />
        </div>

        <aside className="rail" aria-label="Office details">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
                {t.id === "team" && <span className="count num">{agents.length}</span>}
                {t.id === "gateway" && gateway && !gateway.ok && <span className="dot err" style={{ display: "inline-block", marginLeft: 6 }} />}
              </button>
            ))}
          </div>
          <div className="rail-body" role="tabpanel">
            {error && <p className="danger-text">{error}</p>}
            {tab === "team" && <TeamPanel officeId={officeId} agents={agents} activity={activity} tools={tools} defaultModel={defaultModel} selectedId={selected} onSelect={setSelected} onChanged={loadOffice} />}
            {tab === "gateway" && <GatewayPanel />}
            {tab === "schedules" && <SchedulesPanel officeId={officeId} agents={agents} byId={byId} />}
            {tab === "files" && <FilesPanel officeId={officeId} refreshKey={toolCount} />}
          </div>
        </aside>
      </div>
    </div>
  );
}
