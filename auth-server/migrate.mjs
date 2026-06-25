// Creates the Better Auth tables (user, session, account, verification) in Neon.
// Port of the old scripts/migrate-auth.mjs. Run: npm run migrate
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { auth, pool } from "./auth.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// getMigrations is NOT re-exported from "better-auth/db"; it lives in an internal
// dist file. Import it by absolute path to bypass the package "exports" gate.
const { getMigrations } = await import(
  pathToFileURL(path.join(here, "node_modules/better-auth/dist/db/get-migration.mjs")).href
);

console.log("Running Better Auth migrations…");
const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
console.log("Auth tables ready (user, session, account, verification).");
await pool.end();
