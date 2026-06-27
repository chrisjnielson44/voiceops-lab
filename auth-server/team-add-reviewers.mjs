// Add the reviewer accounts to the VoiceAdmin org + team. Idempotent — re-running
// only fills in missing memberships. Runs server-side via the Better Auth context
// (like seed-admin.mjs / provision-reviewers.mjs).
//
// Run:  node team-add-reviewers.mjs
import { auth, pool } from "./auth.mjs";
import { ensureOrgMember, ensureTeamMember, findUser, getWorkspaceOrg } from "./provision.mjs";

const EMAILS = ["ria@voiceadmin.ai", "eshan@voiceadmin.ai"];
const ORG_SLUG = process.env.ORG_SLUG || "voiceadmin";
const TEAM_NAME = process.env.TEAM_NAME || "VoiceAdmin";

const ctx = await auth.$context;

const org = await getWorkspaceOrg(ctx, ORG_SLUG);
if (!org) throw new Error("no workspace organization found");
const teams = await ctx.adapter.findMany({ model: "team", where: [{ field: "organizationId", value: org.id }] });
const team = teams.find((t) => t.name === TEAM_NAME) ?? teams[0];
if (!team) throw new Error(`no team found in org "${org.name}"`);

for (const email of EMAILS) {
  const user = await findUser(ctx, email);
  if (!user) {
    console.log(`• ${email}: no such user — skipped`);
    continue;
  }
  await ensureOrgMember(ctx, org.id, user.id, "member");
  await ensureTeamMember(ctx, team.id, user.id);
  console.log(`• ${email}: member of org "${org.name}" + team "${team.name}"`);
}

await pool.end();
