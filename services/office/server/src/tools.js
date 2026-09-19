// Tools an office agent can call during its LLM loop. Every tool returns a
// string (the tool message content) and never throws: failures come back as
// "Error: ..." text so the model can react instead of the task crashing.
import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { config } from "./config.js";

const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});
const str = (description) => ({ type: "string", description });

export const TOOL_DEFINITIONS = {
  read_file: fn("read_file", "Read a text file from the office workspace.", { path: str("Path relative to the workspace root") }, ["path"]),
  write_file: fn("write_file", "Create or overwrite a file in the office workspace. Parent folders are created.", { path: str("Path relative to the workspace root"), content: str("Full file content") }, ["path", "content"]),
  edit_file: fn("edit_file", "Replace one exact occurrence of old_text with new_text in a workspace file.", { path: str("Path relative to the workspace root"), old_text: str("Exact text to find (must be unique)"), new_text: str("Replacement text") }, ["path", "old_text", "new_text"]),
  list_dir: fn("list_dir", "List files and folders in a workspace directory.", { path: str("Directory relative to the workspace root; default '.'") }),
  grep: fn("grep", "Search workspace files for a literal text pattern.", { pattern: str("Text to search for"), path: str("File or directory; default '.'") }, ["pattern"]),
  delete_file: fn("delete_file", "Delete a file from the office workspace.", { path: str("Path relative to the workspace root") }, ["path"]),
  bash: fn("bash", "Run a shell command with the office workspace as the working directory. Use for builds, tests, git, scripts.", { command: str("Shell command") }, ["command"]),
  fetch_url: fn("fetch_url", "Fetch a web page or API URL and return its text.", { url: str("http(s) URL"), max_chars: { type: "number", description: "Max characters to return (default 8000, max 20000)" } }, ["url"]),
  web_search: fn("web_search", "Search the web. Returns titles, snippets and URLs; follow up with fetch_url.", { query: str("Search query") }, ["query"]),
  remember: fn("remember", "Save a note to your long-term memory under a key (overwrites).", { key: str("Short key"), value: str("What to remember") }, ["key", "value"]),
  recall: fn("recall", "Read your long-term memory. Omit key to list every saved key.", { key: str("Key to read") }),
  delegate_task: fn(
    "delegate_task",
    "Hand a task to another agent over A2A and wait for its result. Give complete context: the other agent cannot see your conversation.",
    { agent: str("Exact name of the agent to delegate to"), task: str("Self-contained instructions and expected output") },
    ["agent", "task"],
  ),
  send_webhook: fn("send_webhook", "POST a notification to a webhook (Discord and Slack URLs are formatted natively).", { url: str("Webhook URL"), message: str("Message body"), title: str("Optional title") }, ["url", "message"]),
  schedule_task: fn("schedule_task", "Schedule a recurring prompt for yourself using a cron expression (5 fields, server time).", { cron: str("Cron expression, e.g. '0 9 * * 1-5'"), prompt: str("What to do each time it fires") }, ["cron", "prompt"]),
};

export const DEFAULT_TOOLS = Object.keys(TOOL_DEFINITIONS);

/** Tool definitions for an agent, honouring its enabled list and team shape. */
export function toolsForAgent(agent, { canDelegate }) {
  const enabled = agent.tools?.length ? agent.tools : DEFAULT_TOOLS;
  return enabled
    .filter((name) => TOOL_DEFINITIONS[name])
    .filter((name) => name !== "delegate_task" || canDelegate)
    .map((name) => TOOL_DEFINITIONS[name]);
}

export function workspaceRoot(officeId, root = config.workspacesDir) {
  return path.join(root, officeId);
}

/** Resolve a path inside the workspace, refusing anything that escapes it. */
export function resolveInWorkspace(root, rel = ".") {
  const full = path.resolve(root, String(rel || "."));
  const relative = path.relative(root, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw Object.assign(new Error(`Path escapes the workspace: ${rel}`), { status: 400 });
  return full;
}

function clip(text, limit = config.agent.toolOutputLimit) {
  const s = String(text ?? "");
  return s.length > limit ? `${s.slice(0, limit)}\n[... truncated ${s.length - limit} chars]` : s;
}

export function stripHtml(html) {
  return String(html)
    .replace(/<(script|style|nav|header|footer|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6])>/gi, "\n\n")
    .replace(/<\/(div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function walk(dir, out = [], depth = 0) {
  if (depth > 12) return out;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".git")) continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) await walk(fp, out, depth + 1);
    else if (e.isFile()) out.push(fp);
  }
  return out;
}

/**
 * @param {object} deps
 * @param {ReturnType<import("./db.js").openDb>} deps.db
 * @param {(args: {fromAgent: object, targetName: string, task: string, depth: number, signal?: AbortSignal}) => Promise<string>} deps.delegate
 * @param {(entry: object) => void} [deps.onSchedule] called after a schedule row is created
 * @param {object} [deps.gateway] used for web_search through 9router
 */
export function createToolRunner({ db, delegate, onSchedule, gateway, workspacesDir = config.workspacesDir, searchProvider = process.env.SEARCH_PROVIDER || "", fetchImpl = fetch }) {
  const handlers = {
    async read_file({ path: p }, { root }) {
      return clip(await fs.readFile(resolveInWorkspace(root, p), "utf8"));
    },
    async write_file({ path: p, content = "" }, { root }) {
      const full = resolveInWorkspace(root, p);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, String(content), "utf8");
      return `Wrote ${Buffer.byteLength(String(content))} bytes to ${p}`;
    },
    async edit_file({ path: p, old_text, new_text = "" }, { root }) {
      const full = resolveInWorkspace(root, p);
      const cur = await fs.readFile(full, "utf8");
      const count = cur.split(old_text).length - 1;
      if (!old_text || count === 0) return `Error: old_text not found in ${p}`;
      if (count > 1) return `Error: old_text matches ${count} times in ${p}; include more context`;
      await fs.writeFile(full, cur.replace(old_text, () => new_text), "utf8");
      return `Edited ${p}`;
    },
    async list_dir({ path: p = "." }, { root }) {
      const full = resolveInWorkspace(root, p);
      const entries = await fs.readdir(full, { withFileTypes: true });
      if (!entries.length) return `${p} is empty`;
      return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort().join("\n");
    },
    async grep({ pattern, path: p = "." }, { root }) {
      const full = resolveInWorkspace(root, p);
      const stat = await fs.stat(full);
      const files = stat.isFile() ? [full] : await walk(full);
      const hits = [];
      for (const f of files) {
        let text;
        try { text = await fs.readFile(f, "utf8"); } catch { continue; }
        text.split("\n").forEach((line, i) => {
          if (hits.length < 200 && line.includes(pattern)) hits.push(`${path.relative(root, f)}:${i + 1}: ${line.trim().slice(0, 200)}`);
        });
      }
      return hits.length ? hits.join("\n") : `No matches for "${pattern}"`;
    },
    async delete_file({ path: p }, { root }) {
      await fs.unlink(resolveInWorkspace(root, p));
      return `Deleted ${p}`;
    },
    bash({ command }, { root, signal }) {
      return new Promise((resolve) => {
        exec(String(command), { cwd: root, timeout: config.agent.bashTimeoutMs, maxBuffer: 4 * 1024 * 1024, signal }, (err, stdout, stderr) => {
          let out = "";
          if (stdout) out += stdout;
          if (stderr) out += `${out ? "\n" : ""}[stderr]\n${stderr}`;
          if (err) out += `${out ? "\n" : ""}[exit ${err.code ?? err.signal ?? "error"}]${err.killed ? " (timed out)" : ""}`;
          resolve(clip(out.trim() || "(no output)"));
        });
      });
    },
    async fetch_url({ url, max_chars = 8000 }, { signal }) {
      if (!/^https?:\/\//i.test(String(url))) return "Error: URL must start with http:// or https://";
      const limit = Math.min(Number(max_chars) || 8000, 20000);
      const res = await fetchImpl(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; A2A-Office/1.0)", Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.5" },
        redirect: "follow",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      });
      if (!res.ok) return `Error: HTTP ${res.status} fetching ${url}`;
      const raw = await res.text();
      const text = (res.headers.get("content-type") || "").includes("html") ? stripHtml(raw) : raw;
      return text.length > limit ? `${text.slice(0, limit)}\n[... truncated at ${limit} chars]` : text;
    },
    async web_search({ query }, { signal }) {
      if (searchProvider && gateway) {
        try {
          const res = await fetchImpl(`${gateway.baseUrl}/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(config.gateway.apiKey ? { Authorization: `Bearer ${config.gateway.apiKey}` } : {}) },
            body: JSON.stringify({ provider: searchProvider, query, max_results: 6 }),
            signal,
          });
          if (res.ok) {
            const data = await res.json();
            const results = (data.results || []).slice(0, 6);
            if (results.length) return formatResults(query, results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet || r.content || "" })));
          }
        } catch { /* fall through to DuckDuckGo */ }
      }
      const res = await fetchImpl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; A2A-Office/1.0)" },
        signal,
      });
      if (!res.ok) return `Error: search failed (HTTP ${res.status})`;
      const html = await res.text();
      const titles = [...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 6);
      const snippets = [...html.matchAll(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
      const results = titles.map((m, i) => ({ url: decodeDdgUrl(m[1]), title: stripHtml(m[2]), snippet: snippets[i] ? stripHtml(snippets[i][1]) : "" }));
      return results.length ? formatResults(query, results) : `No results for "${query}"`;
    },
    remember({ key, value }, { agent }) {
      db.remember(agent.officeId, agent.id, String(key), String(value));
      return `Remembered "${key}"`;
    },
    recall({ key }, { agent }) {
      if (!key) {
        const all = db.listMemories(agent.id);
        return all.length ? all.map((m) => `- ${m.key}: ${m.content.slice(0, 120)}`).join("\n") : "Memory is empty";
      }
      const m = db.recall(agent.id, String(key));
      return m ? m.content : `Nothing remembered under "${key}"`;
    },
    delegate_task({ agent: targetName, task }, { agent, depth, signal }) {
      return delegate({ fromAgent: agent, targetName: String(targetName), task: String(task), depth, signal });
    },
    async send_webhook({ url, message, title }, { signal }) {
      if (!/^https?:\/\//i.test(String(url))) return "Error: webhook URL must start with http:// or https://";
      const isDiscord = /discord(app)?\.com\/api\/webhooks/.test(url);
      const isSlack = url.includes("hooks.slack.com");
      const body = isDiscord
        ? { embeds: [{ title: title?.slice(0, 256), description: String(message).slice(0, 4096), color: 5763719 }] }
        : isSlack ? { text: title ? `*${title}*\n${message}` : message } : { title, message, timestamp: new Date().toISOString() };
      const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
      return res.ok ? `Webhook sent (HTTP ${res.status})` : `Error: webhook HTTP ${res.status}`;
    },
    async schedule_task({ cron, prompt }, { agent }) {
      const { Cron } = await import("croner");
      try { new Cron(String(cron), { paused: true }).stop(); } catch (err) { return `Error: invalid cron "${cron}": ${err.message}`; }
      const row = db.createSchedule({ officeId: agent.officeId, agentId: agent.id, cron: String(cron), prompt: String(prompt) });
      onSchedule?.(row);
      return `Scheduled ${row.id}: "${prompt}" on "${cron}"`;
    },
  };

  return {
    /** Run one tool call; always resolves to a string. */
    async run(name, args, { agent, depth = 0, signal } = {}) {
      const handler = handlers[name];
      if (!handler) return `Error: unknown tool "${name}"`;
      const root = workspaceRoot(agent.officeId, workspacesDir);
      try {
        await fs.mkdir(root, { recursive: true });
        return String(await handler(args || {}, { agent, root, depth, signal }));
      } catch (err) {
        return `Error: ${err?.message || String(err)}`;
      }
    },
  };
}

function decodeDdgUrl(href) {
  const m = /[?&]uddg=([^&]+)/.exec(href);
  return m ? decodeURIComponent(m[1]) : href.startsWith("//") ? `https:${href}` : href;
}

function formatResults(query, results) {
  return `Results for "${query}":\n\n${results.map((r) => `**${r.title}**\n${r.snippet}\n${r.url}`).join("\n\n")}`;
}
