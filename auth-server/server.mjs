// Standalone Better Auth host — replaces the old Next.js /api/auth/* route.
// A ~30-line Node HTTP server using the official better-auth/node adapter.
// In dev the Vite proxy serves /api/auth on the SPA's origin, so cookies stay
// same-origin and no cross-domain plugin/CORS is needed; the CORS headers below
// are a safety net for a direct (non-proxied) cross-origin setup.
import { createServer } from "node:http";
import { createGateway } from "@ai-sdk/gateway";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.mjs";
import { provisionUser } from "./provision.mjs";

const PORT = Number(process.env.AUTH_PORT || 3000);
const handler = toNodeHandler(auth);
const aiGateway = createGateway();

function nodeHeaders(req) {
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") h.set(k, v);
    else if (Array.isArray(v)) h.set(k, v.join(", "));
  }
  return h;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1_000_000) reject(new Error("payload too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(obj));
}

/**
 * Admin-only user provisioning. Public sign-up is disabled and org `addMember`
 * is a server-only Better Auth endpoint, so the cockpit's "create user" flow
 * posts here. We verify the caller is an admin (via their session cookie), then
 * create the account + workspace/team membership server-side.
 */
async function handleProvisionUser(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
  let session;
  try {
    session = await auth.api.getSession({ headers: nodeHeaders(req) });
  } catch {
    session = null;
  }
  if (!session?.user || session.user.role !== "admin") {
    return sendJson(res, 403, { error: "admin access required" });
  }
  let payload;
  try {
    payload = await readJson(req);
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }
  try {
    const ctx = await auth.$context;
    const user = await provisionUser(ctx, {
      email: String(payload.email || "").trim(),
      name: typeof payload.name === "string" ? payload.name.trim() : undefined,
      password: String(payload.password || ""),
      role: payload.role === "admin" ? "admin" : "user",
      teamId: payload.teamId || undefined,
    });
    return sendJson(res, 200, { user: { id: user.id, email: user.email } });
  } catch (e) {
    return sendJson(res, 400, { error: e.message || "provisioning failed" });
  }
}

async function handleRealtimeToken(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
  if (!process.env.VERCEL_OIDC_TOKEN && !process.env.AI_GATEWAY_API_KEY) {
    return sendJson(res, 503, {
      error: "Vercel AI Gateway credentials are missing. Run `vercel env pull web/.env.local --yes`.",
    });
  }

  let payload;
  try {
    payload = await readJson(req);
  } catch {
    payload = {};
  }
  const requested = typeof payload.model === "string" && payload.model ? payload.model : undefined;
  const model = requested || process.env.VERCEL_VOICE_MODEL || "openai/gpt-realtime-2";

  try {
    const { token, url } = await aiGateway.experimental_realtime.getToken({ model });
    return sendJson(res, 200, { token, url, model, tools: [] });
  } catch (e) {
    return sendJson(res, 502, { error: e?.message || "failed to mint realtime token" });
  }
}

const ALLOW = (
  process.env.AUTH_CORS_ORIGINS ||
  "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const server = createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOW.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  // Custom admin route (must be checked before the catch-all Better Auth handler).
  if (req.url && req.url.split("?")[0] === "/api/auth/provision-user") {
    handleProvisionUser(req, res).catch(() => {
      if (!res.writableEnded) sendJson(res, 500, { error: "internal error" });
    });
    return;
  }
  if (req.url && req.url.split("?")[0] === "/api/realtime/token") {
    handleRealtimeToken(req, res).catch(() => {
      if (!res.writableEnded) sendJson(res, 500, { error: "internal error" });
    });
    return;
  }
  if (req.url && req.url.startsWith("/api/auth")) {
    handler(req, res);
    return;
  }
  if (req.url === "/healthz") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, service: "voiceops-auth" }));
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`voiceops auth-server on http://localhost:${PORT} (/api/auth/*)`);
});
