/**
 * Agent tool definitions + executors.
 * Add new tools here — they auto-appear for all agents.
 */

// ── Tool definitions (OpenAI function-calling schema) ────────────────────────
export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current information. Returns titles, descriptions, and URLs. Use fetch_url to read full page content from a URL.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description: "Fetch and read the full text content of any webpage or URL. Use this to read articles, documentation, or any link shared by the user.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The full URL to fetch (must start with http:// or https://)" },
          max_chars: { type: "number", description: "Maximum characters to return (default 8000, max 20000)" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description: "Save a key fact to your persistent memory so you can recall it later.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Short label for the memory (e.g. 'user_preference_language')" },
          value: { type: "string", description: "The information to remember" },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall",
      description: "Retrieve something you previously remembered by key.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "The key to look up" },
        },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_file",
      description: "Generate a text or markdown file with the given content and return a download link.",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Filename including extension, e.g. 'report.md' or 'summary.txt'" },
          content: { type: "string", description: "Full file content" },
        },
        required: ["filename", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_task",
      description: "Schedule this agent to run a task automatically at a future time or on a recurring schedule.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "What the agent should do when triggered" },
          schedule: { type: "string", description: "When to run: ISO datetime for one-time (e.g. '2025-12-01T09:00:00') or cron expression for recurring (e.g. '0 9 * * 1' for every Monday 9am)" },
        },
        required: ["task", "schedule"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file in the office workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file, relative to the office workspace root" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a file in the office workspace with the given content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to workspace root" },
          content: { type: "string", description: "The full content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files and directories in the office workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to workspace root. Use '.' for root." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bash",
      description: "Run a shell command in the office workspace directory. Use for: npm install, pip install, mkdir, mv, cp, run tests, build, execute scripts, git commands, etc.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep_file",
      description: "Search for a pattern in a file or directory in the office workspace.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Text or regex pattern to search for" },
          path: { type: "string", description: "File or directory relative to workspace root. Use '.' for entire workspace." },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file in the office workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file, relative to the office workspace root" },
        },
        required: ["path"],
      },
    },
  },
];

// ── Tool executors ───────────────────────────────────────────────────────────

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function toolFetchUrl({ url, max_chars = 8000 }) {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return `Invalid URL: must start with http:// or https://`;
  }

  const limit = Math.min(Number(max_chars) || 8000, 20000);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AgentOS/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    if (!res.ok) return `Failed to fetch ${url}: HTTP ${res.status}`;

    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();

    let content;
    if (contentType.includes("text/html")) {
      content = stripHtml(text);
    } else {
      content = text;
    }

    const truncated = content.length > limit;
    const output = content.slice(0, limit);

    return `Content from ${url}:\n\n${output}${truncated ? `\n\n[... truncated at ${limit} chars, use max_chars to get more]` : ""}`;
  } catch (err) {
    return `Failed to fetch ${url}: ${err.message}`;
  }
}

async function toolWebSearch({ query }) {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (braveKey) {
    try {
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
        { headers: { "Accept": "application/json", "X-Subscription-Token": braveKey } }
      );
      if (res.ok) {
        const data = await res.json();
        const results = (data.web?.results || []).slice(0, 5).map((r) =>
          `**${r.title}**\n${r.description}\nURL: ${r.url}`
        );
        return results.length > 0
          ? `Search results for "${query}":\n\n${results.join("\n\n")}\n\nTip: Use fetch_url to read full content from any of these URLs.`
          : `No results found for "${query}"`;
      }
    } catch {}
  }

  // Fallback: DuckDuckGo HTML search scrape (returns real results without API key)
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; AgentOS/1.0)" } }
    );
    if (res.ok) {
      const html = await res.text();
      // Extract result snippets from DDG HTML
      const titleMatches = [...html.matchAll(/class="result__title"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
      const snippetMatches = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];

      // Simpler fallback: just extract visible text links
      const results = [];
      const linkRegex = /href="(https?:\/\/[^"]+)"[^>]*class="result__url"|class="result__url"[^>]*href="(https?:\/\/[^"]+)"/g;
      const titleRegex = /<a class="result__a"[^>]*>([\s\S]*?)<\/a>/g;
      const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

      const titles = [...html.matchAll(/<a class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 5);
      const snippets = [...html.matchAll(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, 5);

      for (let i = 0; i < Math.min(titles.length, 5); i++) {
        const url = titles[i][1];
        const title = stripHtml(titles[i][2]);
        const snippet = snippets[i] ? stripHtml(snippets[i][1]) : "";
        if (url && title) results.push(`**${title}**\n${snippet}\nURL: ${url}`);
      }

      if (results.length > 0) {
        return `Search results for "${query}":\n\n${results.join("\n\n")}\n\nTip: Use fetch_url to read full content from any of these URLs.`;
      }

      // Last resort: DDG instant answer API
      const ddgRes = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        { headers: { "User-Agent": "AgentOS/1.0" } }
      );
      if (ddgRes.ok) {
        const data = await ddgRes.json();
        const parts = [];
        if (data.AbstractText) parts.push(data.AbstractText);
        if (data.Answer) parts.push(`Answer: ${data.Answer}`);
        if (parts.length > 0) return parts.join("\n\n");
      }
    }
  } catch {}

  return `Could not fetch search results for "${query}". Consider setting BRAVE_SEARCH_API_KEY for reliable results.`;
}

import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "./db/driver.js";
import { exec } from "child_process";

// ── Workspace sandbox ──────────────────────────────────────────────────────
async function getOfficeByIdSync(officeId) {
  const db = await getAdapter();
  const row = db.get(`SELECT workspacePath FROM offices WHERE id = ?`, [officeId]);
  return row;
}

async function resolveWorkspaceAsync(officeId, subPath = "") {
  if (!officeId) throw new Error("No officeId provided");
  const row = await getOfficeByIdSync(officeId);
  if (!row?.workspacePath) throw new Error(`Office has no workspace set. Configure it in office settings.`);
  const ws = row.workspacePath;
  if (!fs.existsSync(ws)) throw new Error(`Workspace path does not exist: ${ws}`);
  const resolved = path.resolve(ws, subPath || ".");
  if (!resolved.startsWith(path.resolve(ws))) throw new Error(`Access denied: "${subPath}" is outside workspace`);
  return resolved;
}

async function toolReadFile({ path: filePath }, _agentId, officeId) {
  const full = await resolveWorkspaceAsync(officeId, filePath);
  if (!fs.existsSync(full)) return `File not found: ${filePath}`;
  const stat = fs.statSync(full);
  if (stat.isDirectory()) return toolListDir({ path: filePath }, _agentId, officeId);
  const content = fs.readFileSync(full, "utf-8");
  const truncated = content.length > 10000 ? content.slice(0, 10000) + "\n... (truncated)" : content;
  return `File: ${filePath} (${stat.size} bytes)\n\n${truncated}`;
}

async function toolWriteFile({ path: filePath, content }, _agentId, officeId) {
  const full = await resolveWorkspaceAsync(officeId, filePath);
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
  return `File written: ${filePath} (${content.length} chars)`;
}

async function toolListDir({ path: dirPath = "." }, _agentId, officeId) {
  const full = await resolveWorkspaceAsync(officeId, dirPath);
  if (!fs.existsSync(full)) return `Directory not found: ${dirPath}`;
  const entries = fs.readdirSync(full, { withFileTypes: true });
  const lines = entries.map(e => {
    const prefix = e.isDirectory() ? "[DIR]" : "[FILE]";
    return `${prefix}  ${e.name}`;
  });
  return lines.length > 0 ? lines.join("\n") : "(empty directory)";
}

async function toolBash({ command }, _agentId, officeId) {
  const ws = await resolveWorkspaceAsync(officeId);
  return new Promise((resolve) => {
    exec(command, { cwd: ws, timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      let result = "";
      if (stdout) result += stdout;
      if (stderr) result += (result ? "\n[stderr]\n" : "") + stderr;
      if (err && !result) result = `Error: ${err.message}`;
      if (!result.trim()) result = "(no output)";
      resolve(result.slice(0, 8000));
    });
  });
}

async function toolGrepFile({ pattern, path: searchPath = "." }, _agentId, officeId) {
  const full = await resolveWorkspaceAsync(officeId, searchPath);
  const results = [];
  function searchDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") searchDir(fp);
      else if (e.isFile() && e.name !== "package-lock.json") {
        try {
          const content = fs.readFileSync(fp, "utf-8");
          const lines = content.split("\n");
          lines.forEach((line, i) => {
            if (line.includes(pattern)) {
              results.push(`${path.relative(full, fp)}:${i + 1}: ${line.trim().slice(0, 200)}`);
            }
          });
        } catch {}
      }
    }
  }
  if (fs.statSync(full).isFile()) {
    const content = fs.readFileSync(full, "utf-8");
    content.split("\n").forEach((line, i) => {
      if (line.includes(pattern)) results.push(`:${i + 1}: ${line.trim().slice(0, 200)}`);
    });
  } else {
    searchDir(full);
  }
  if (results.length === 0) return `No matches found for "${pattern}" in ${searchPath}`;
  if (results.length > 50) return results.slice(0, 50).join("\n") + `\n... and ${results.length - 50} more matches`;
  return results.join("\n");
}

async function toolDeleteFile({ path: filePath }, _agentId, officeId) {
  const full = await resolveWorkspaceAsync(officeId, filePath);
  if (!fs.existsSync(full)) return `File not found: ${filePath}`;
  fs.unlinkSync(full);
  return `Deleted: ${filePath}`;
}

async function toolRemember({ key, value }, agentId, officeId) {
  const db = await getAdapter();
  const id = uuidv4();
  const now = new Date().toISOString();
  // Upsert: remove old entry with same key+agent, insert fresh
  db.run(`DELETE FROM memoryEntries WHERE agentId = ? AND key = ?`, [agentId, key]);
  db.run(
    `INSERT INTO memoryEntries(id, agentId, officeId, key, type, content, createdAt, updatedAt) VALUES(?, ?, ?, ?, 'memory', ?, ?, ?)`,
    [id, agentId, officeId, key, value, now, now]
  );
  return `Remembered: "${key}" = "${value}"`;
}

async function toolRecall({ key }, agentId) {
  const db = await getAdapter();
  const row = db.get(`SELECT content FROM memoryEntries WHERE agentId = ? AND key = ? ORDER BY createdAt DESC LIMIT 1`, [agentId, key]);
  if (!row) return `No memory found for key "${key}"`;
  return `Recalled: "${key}" = "${row.content}"`;
}

async function toolGenerateFile({ filename, content }) {
  // Save to public/generated/ so it's downloadable
  const dir = path.join(process.cwd(), "public", "generated");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Sanitize filename
  const safe = filename.replace(/[^a-zA-Z0-9._\-]/g, "_");
  const unique = `${Date.now()}_${safe}`;
  fs.writeFileSync(path.join(dir, unique), content, "utf-8");

  return `File generated: [${safe}](/generated/${unique}) — ${content.length} characters`;
}

async function toolScheduleTask({ task, schedule }, agentId, officeId) {
  const db = await getAdapter();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO cronJobs(id, agentId, officeId, prompt, schedule, enabled, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, 1, ?, ?)`,
    [id, agentId, officeId, task, schedule, now, now]
  );
  return `Task scheduled (ID: ${id}): "${task}" — schedule: "${schedule}"`;
}

// ── Main dispatcher ──────────────────────────────────────────────────────────
export async function executeTool(toolName, toolArgs, { agentId, officeId } = {}) {
  console.log(`[Tool][${agentId}] ${toolName}(${JSON.stringify(toolArgs)})`);
  try {
    switch (toolName) {
      case "web_search":    return await toolWebSearch(toolArgs);
      case "fetch_url":     return await toolFetchUrl(toolArgs);
      case "remember":      return await toolRemember(toolArgs, agentId, officeId);
      case "recall":        return await toolRecall(toolArgs, agentId);
      case "generate_file": return await toolGenerateFile(toolArgs);
      case "schedule_task": return await toolScheduleTask(toolArgs, agentId, officeId);
      case "read_file":    return await toolReadFile(toolArgs, agentId, officeId);
      case "write_file":   return await toolWriteFile(toolArgs, agentId, officeId);
      case "list_dir":     return await toolListDir(toolArgs, agentId, officeId);
      case "bash":         return await toolBash(toolArgs, agentId, officeId);
      case "grep_file":    return await toolGrepFile(toolArgs, agentId, officeId);
      case "delete_file":  return await toolDeleteFile(toolArgs, agentId, officeId);
      default: return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    console.error(`[Tool][${toolName}] error:`, err.message);
    return `Tool error: ${err.message}`;
  }
}
