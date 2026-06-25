// Standalone Better Auth host — replaces the old Next.js /api/auth/* route.
// A ~30-line Node HTTP server using the official better-auth/node adapter.
// In dev the Vite proxy serves /api/auth on the SPA's origin, so cookies stay
// same-origin and no cross-domain plugin/CORS is needed; the CORS headers below
// are a safety net for a direct (non-proxied) cross-origin setup.
import { createServer } from "node:http";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.mjs";

const PORT = Number(process.env.AUTH_PORT || 3000);
const handler = toNodeHandler(auth);

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
