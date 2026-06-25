// Better Auth server instance — ported verbatim from the old Next.js
// src/lib/auth/auth.ts, now framework-agnostic (served via better-auth/node).
// Sessions + email/password, backed by Neon Postgres through a pg pool.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { betterAuth } from "better-auth";

const here = path.dirname(fileURLToPath(import.meta.url));

// Load env from this package's .env, then fall back to the repo-root .env.local
// (the canonical creds file). First definition wins.
for (const f of [path.join(here, ".env"), path.join(here, "..", ".env.local"), path.join(here, "..", ".env")]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* file absent — fine */
  }
}

const connectionString =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error(
    "No Postgres connection string. Set DATABASE_URL_UNPOOLED (or DATABASE_URL) in auth-server/.env or the repo-root .env.local.",
  );
}

export const pool = new pg.Pool({
  connectionString,
  // Neon serves a valid cert; relax verification to avoid local CA hiccups.
  ssl: { rejectUnauthorized: false },
  max: 5,
});

const trustedOrigins = (
  process.env.BETTER_AUTH_TRUSTED_ORIGINS ||
  "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const auth = betterAuth({
  appName: "VoiceOps Lab",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  database: pool,
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  // The Vite SPA's origin (and the proxy origin) must be trusted for CSRF.
  trustedOrigins,
});
