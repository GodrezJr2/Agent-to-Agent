// Thin client for the office REST API. An optional OFFICE_API_KEY is kept in
// localStorage and sent as a bearer token (and as ?key= for EventSource).

export type Agent = {
  id: string;
  officeId: string;
  name: string;
  role: string;
  description: string;
  kind: "local" | "remote";
  remoteUrl: string;
  model: string;
  systemPrompt: string;
  managerId: string | null;
  tools: string[];
  sprite: number;
  a2aUrl: string;
};

export type Office = { id: string; name: string; description: string; agentCount?: number; createdAt: string };

export type FeedEntry = {
  id: string;
  officeId: string;
  kind: "user" | "agent" | "delegation" | "tool" | "status" | "error";
  agentId: string | null;
  fromAgentId: string | null;
  toAgentId: string | null;
  taskId: string | null;
  content: string;
  meta: Record<string, any>;
  createdAt: string;
};

export type Activity = { agentId: string; state: "working" | "thinking" | "tool" | "delegating" | "idle"; detail: string; at: string };
export type Schedule = { id: string; agentId: string; cron: string; prompt: string; enabled: number; lastRun: string | null; nextRun: string | null };
export type FileEntry = { name: string; dir: boolean; size: number; modified: string | null };
export type ToolInfo = { name: string; description: string };

const KEY_STORAGE = "office.apiKey";

export function getApiKey(): string {
  try { return localStorage.getItem(KEY_STORAGE) || ""; } catch { return ""; }
}
export function setApiKey(key: string) {
  try { key ? localStorage.setItem(KEY_STORAGE, key) : localStorage.removeItem(KEY_STORAGE); } catch { /* storage blocked */ }
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = getApiKey();
  const res = await fetch(`/api${path}`, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error || res.statusText, res.status);
  return json as T;
}

export const api = {
  config: () => call<{ publicUrl: string; gateway: string; defaultModel: string; tools: ToolInfo[] }>("GET", "/config"),
  models: () => call<{ models: { id: string }[] }>("GET", "/models"),

  offices: () => call<{ offices: Office[] }>("GET", "/offices"),
  createOffice: (name: string, description = "") => call<{ office: Office }>("POST", "/offices", { name, description }),
  office: (id: string) => call<{ office: Office; agents: Agent[]; activity: Activity[] }>("GET", `/offices/${id}`),
  updateOffice: (id: string, patch: Partial<Office>) => call<{ office: Office }>("PATCH", `/offices/${id}`, patch),
  deleteOffice: (id: string) => call("DELETE", `/offices/${id}`),

  createAgent: (officeId: string, input: Partial<Agent>) => call<{ agent: Agent }>("POST", `/offices/${officeId}/agents`, input),
  updateAgent: (id: string, patch: Partial<Agent>) => call<{ agent: Agent }>("PATCH", `/agents/${id}`, patch),
  deleteAgent: (id: string) => call("DELETE", `/agents/${id}`),
  stopAgent: (id: string) => call<{ stopped: boolean }>("POST", `/agents/${id}/stop`),
  agentCard: (id: string) => call<any>("GET", `/agents/${id}/card`),
  memories: (id: string) => call<{ memories: { key: string; content: string; updatedAt: string }[] }>("GET", `/agents/${id}/memories`),
  forget: (id: string, key: string) => call("DELETE", `/agents/${id}/memories/${encodeURIComponent(key)}`),

  feed: (officeId: string) => call<{ feed: FeedEntry[] }>("GET", `/offices/${officeId}/feed?limit=300`),
  clearFeed: (officeId: string) => call("DELETE", `/offices/${officeId}/feed`),
  send: (officeId: string, content: string, agentId?: string) => call<{ targets: string[] }>("POST", `/offices/${officeId}/messages`, { content, agentId }),

  schedules: (officeId: string) => call<{ schedules: Schedule[] }>("GET", `/offices/${officeId}/schedules`),
  createSchedule: (officeId: string, input: { agentId: string; cron: string; prompt: string }) => call<{ schedule: Schedule }>("POST", `/offices/${officeId}/schedules`, input),
  toggleSchedule: (id: string, enabled: boolean) => call("PATCH", `/schedules/${id}`, { enabled }),
  deleteSchedule: (id: string) => call("DELETE", `/schedules/${id}`),

  files: (officeId: string, path = ".") => call<{ path: string; files: FileEntry[] }>("GET", `/offices/${officeId}/files?path=${encodeURIComponent(path)}`),
  fileUrl: (officeId: string, path: string, download = false) => {
    const key = getApiKey();
    return `/api/offices/${officeId}/file?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}${key ? `&key=${encodeURIComponent(key)}` : ""}`;
  },

  stream(officeId: string, handlers: { feed?: (e: FeedEntry) => void; activity?: (a: Activity) => void; changed?: (what: string) => void; open?: () => void; error?: () => void }) {
    const key = getApiKey();
    const es = new EventSource(`/api/offices/${officeId}/stream${key ? `?key=${encodeURIComponent(key)}` : ""}`);
    es.addEventListener("feed", (e) => handlers.feed?.(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("activity", (e) => handlers.activity?.(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("changed", (e) => handlers.changed?.(JSON.parse((e as MessageEvent).data).what));
    es.onopen = () => handlers.open?.();
    es.onerror = () => handlers.error?.();
    return () => es.close();
  },
};
