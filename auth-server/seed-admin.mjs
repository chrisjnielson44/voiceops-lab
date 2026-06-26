// Provisions the first admin account + the VoiceAdmin workspace.
//
// Because public sign-up is disabled (auth.mjs `disableSignUp: true`), accounts
// are created out-of-band. This script bootstraps:
//   1. an admin user (cjnielson44@gmail.com, role=admin) with a password,
//   2. an organization "VoiceAdmin",
//   3. a team "VoiceAdmin" inside it,
//   4. the admin as owner member + team member.
//
// It is idempotent — re-running only fills in what's missing. It works purely
// server-side via the Better Auth context (internalAdapter + adapter), so it
// needs no HTTP session and is unaffected by disableSignUp.
//
// Run:  npm run seed:admin
// Env:  ADMIN_EMAIL (default cjnielson44@gmail.com)
//       ADMIN_NAME  (default "Christopher Nielson")
//       ADMIN_PASSWORD (optional — generated + printed once if omitted)
import { auth, pool } from "./auth.mjs";
import {
  createUserWithPassword,
  ensureOrgMember,
  ensureTeamMember,
  findUser,
  randomPassword,
} from "./provision.mjs";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "cjnielson44@gmail.com").trim().toLowerCase();
const ADMIN_NAME = process.env.ADMIN_NAME || "Christopher Nielson";
const ORG_NAME = process.env.ORG_NAME || "VoiceAdmin";
const ORG_SLUG = process.env.ORG_SLUG || "voiceadmin";
const TEAM_NAME = process.env.TEAM_NAME || "VoiceAdmin";

const ctx = await auth.$context;
const { internalAdapter, adapter } = ctx;

async function ensureAdminUser() {
  const existing = await findUser(ctx, ADMIN_EMAIL);
  if (existing) {
    if (existing.role !== "admin") {
      await internalAdapter.updateUser(existing.id, { role: "admin" });
      console.log(`• user ${ADMIN_EMAIL}: promoted to admin`);
    } else {
      console.log(`• user ${ADMIN_EMAIL}: already admin (unchanged)`);
    }
    return existing;
  }
  const plain = process.env.ADMIN_PASSWORD || randomPassword();
  const user = await createUserWithPassword(ctx, {
    email: ADMIN_EMAIL,
    name: ADMIN_NAME,
    password: plain,
    role: "admin",
  });
  console.log(`• user ${ADMIN_EMAIL}: created (admin)`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`\n  ⚠  Generated password (store it now, shown once):\n      ${plain}\n`);
  }
  return user;
}

async function ensureOrg() {
  const existing = await adapter.findOne({
    model: "organization",
    where: [{ field: "slug", value: ORG_SLUG }],
  });
  if (existing) {
    console.log(`• org "${ORG_NAME}": exists`);
    return existing;
  }
  const org = await adapter.create({
    model: "organization",
    data: { name: ORG_NAME, slug: ORG_SLUG, createdAt: new Date() },
  });
  console.log(`• org "${ORG_NAME}": created`);
  return org;
}

async function ensureTeam(orgId) {
  const teams = await adapter.findMany({
    model: "team",
    where: [{ field: "organizationId", value: orgId }],
  });
  const found = teams.find((t) => t.name === TEAM_NAME);
  if (found) {
    console.log(`• team "${TEAM_NAME}": exists`);
    return found;
  }
  const team = await adapter.create({
    model: "team",
    data: { name: TEAM_NAME, organizationId: orgId, createdAt: new Date() },
  });
  console.log(`• team "${TEAM_NAME}": created`);
  return team;
}

console.log("Seeding VoiceAdmin workspace…");
const user = await ensureAdminUser();
const org = await ensureOrg();
const team = await ensureTeam(org.id);
await ensureOrgMember(ctx, org.id, user.id, "owner");
await ensureTeamMember(ctx, team.id, user.id);
console.log("Done.");
await pool.end();
