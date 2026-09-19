// OpenAI-compatible HTTP front for the chat.deepseek.com web app.
//
// Auth: the caller's `Authorization: Bearer <token>` IS the DeepSeek web token
// (copied from chat.deepseek.com network requests). That lets 9router store one
// token per connection and rotate accounts itself, while this service stays
// stateless apart from the per-token chat-session cache.
//
// Standalone use: set DEEPSEEK_TOKEN plus ACCESS_KEY, then callers send
// `Bearer <ACCESS_KEY>` and never see the real token.
import http from "node:http";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeepSeekWebExecutor, MODEL_FLAGS, probeDeepSeekWebToken } from "./deepseek.js";

const PORT = Number(process.env.PORT) || 8790;
const HOST = process.env.HOST || "0.0.0.0";
const DEEPSEEK_TOKEN = process.env.DEEPSEEK_TOKEN || "";
const ACCESS_KEY = process.env.ACCESS_KEY || "";
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES) || 20 * 1024 * 1024;

export const MODEL_IDS = [...Object.keys(MODEL_FLAGS), ...Object.keys(MODEL_FLAGS).map((id) => `${id}-agentic`)];

const log = {
  info: (tag, msg) => console.log(`[${new Date().toISOString()}] ${tag} ${msg}`),
  error: (tag, msg) => console.error(`[${new Date().toISOString()}] ${tag} ERROR ${msg}`),
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function sendError(res, status, message, type = "invalid_request_error") {
  sendJson(res, status, { error: { message, type } });
}

function readBearer(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : "";
}

// Resolve the DeepSeek token for this request, or null when unauthorized.
export function resolveToken(bearer, { deepseekToken = DEEPSEEK_TOKEN, accessKey = ACCESS_KEY } = {}) {
  if (accessKey && deepseekToken) {
    if (!bearer) return null;
    const a = Buffer.from(bearer);
    const b = Buffer.from(accessKey);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return deepseekToken;
  }
  if (bearer) return bearer;
  if (deepseekToken && !accessKey) return deepseekToken;
  return null;
}

// The executor keys its chained-session cache by connectionId; derive a stable
// one from the token so separate accounts never share a DeepSeek chat session.
export function connectionIdFor(token) {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(Object.assign(new Error("Invalid JSON body"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

export { PORT, HOST, log };

export function createServer({ executor = new DeepSeekWebExecutor(), tokenOptions } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (req.method === "GET" && (path === "/health" || path === "/")) {
        return sendJson(res, 200, { status: "ok", service: "deepseek-web-api" });
      }

      if (req.method === "GET" && path === "/v1/models") {
        const created = Math.floor(Date.now() / 1000);
        return sendJson(res, 200, {
          object: "list",
          data: MODEL_IDS.map((id) => ({ id, object: "model", created, owned_by: "deepseek-web" })),
        });
      }

      const token = resolveToken(readBearer(req), tokenOptions);

      if (req.method === "GET" && path === "/v1/token/check") {
        if (!token) return sendError(res, 401, "Missing bearer token", "authentication_error");
        return sendJson(res, 200, await probeDeepSeekWebToken(token));
      }

      if (req.method === "POST" && path === "/v1/chat/completions") {
        if (!token) return sendError(res, 401, "Missing bearer token", "authentication_error");
        const body = await readJsonBody(req);
        const abort = new AbortController();
        res.on("close", () => { if (!res.writableFinished) abort.abort(); });

        const { response } = await executor.execute({
          model: body.model || "instant",
          body,
          stream: body.stream === true,
          credentials: { apiKey: token, connectionId: connectionIdFor(token) },
          signal: abort.signal,
          log,
        });

        const headers = Object.fromEntries(response.headers.entries());
        res.writeHead(response.status, headers);
        if (!response.body) return res.end();
        await pipeline(Readable.fromWeb(response.body), res).catch(() => {});
        return;
      }

      sendError(res, 404, `No route for ${req.method} ${url.pathname}`, "not_found");
    } catch (err) {
      log.error("HTTP", err?.message || String(err));
      if (!res.headersSent) sendError(res, err?.status || 500, err?.message || "Internal error", "server_error");
      else res.end();
    }
  });
}
