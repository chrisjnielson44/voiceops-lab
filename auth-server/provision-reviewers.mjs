// Provision external reviewer accounts (regular users) into the VoiceAdmin
// workspace. Public sign-up is disabled (auth.mjs `disableSignUp: true`), so this
// runs server-side via the Better Auth context — exactly like seed-admin.mjs.
//
// Idempotent: a user that already exists is left untouched and reported. New
// users get a generated password, printed ONCE at the end.
//
// Run (on the deployed machine, so it uses the prod DB):
//   cd /app && node provision-reviewers.mjs
import { auth, pool } from "./auth.mjs";
import { findUser, provisionUser, randomPassword } from "./provision.mjs";

const REVIEWERS = [
  { email: "ria@voiceadmin.ai", name: "Ria" },
  { email: "eshan@voiceadmin.ai", name: "Eshan" },
];

const ctx = await auth.$context;
const results = [];

for (const r of REVIEWERS) {
  const existing = await findUser(ctx, r.email);
  if (existing) {
    console.log(`• ${r.email}: already exists — skipped`);
    results.push({ ...r, status: "exists" });
    continue;
  }
  const password = randomPassword();
  await provisionUser(ctx, { email: r.email, name: r.name, password, role: "user" });
  console.log(`• ${r.email}: created (role=user, workspace member)`);
  results.push({ ...r, status: "created", password });
}

console.log("\n=== CREDENTIALS (store now — shown once) ===");
for (const r of results) {
  if (r.status === "created") console.log(`  ${r.email}\t${r.password}`);
  else console.log(`  ${r.email}\t(already existed — password unchanged)`);
}
console.log("");

await pool.end();
