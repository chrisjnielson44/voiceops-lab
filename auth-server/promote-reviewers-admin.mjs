// Promote the reviewer accounts to admin (global role used by the Better Auth
// admin plugin + the backend's require_admin gate). Idempotent. Runs server-side
// via the Better Auth context, like seed-admin.mjs.
//
// Run:  node promote-reviewers-admin.mjs
import { auth, pool } from "./auth.mjs";
import { findUser } from "./provision.mjs";

const EMAILS = ["ria@voiceadmin.ai", "eshan@voiceadmin.ai"];
const ctx = await auth.$context;

for (const email of EMAILS) {
  const user = await findUser(ctx, email);
  if (!user) {
    console.log(`• ${email}: no such user — skipped`);
    continue;
  }
  if (user.role === "admin") {
    console.log(`• ${email}: already admin`);
    continue;
  }
  await ctx.internalAdapter.updateUser(user.id, { role: "admin" });
  console.log(`• ${email}: promoted to admin`);
}

await pool.end();
