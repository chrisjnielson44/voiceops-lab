// Shared, server-side provisioning helpers for the VoiceAdmin workspace.
//
// These run against the Better Auth context (internalAdapter + adapter) so they
// work even though public sign-up is disabled and org `addMember` is a
// server-only endpoint. Reused by both seed-admin.mjs (bootstrap) and the
// admin-gated /api/auth/provision-user route in server.mjs.
import { randomBytes } from "node:crypto";

export function randomPassword() {
  return randomBytes(12).toString("base64url");
}

/** The single workspace org (prefers the given slug, else the first one). */
export async function getWorkspaceOrg(ctx, slug) {
  if (slug) {
    const bySlug = await ctx.adapter.findOne({
      model: "organization",
      where: [{ field: "slug", value: slug }],
    });
    if (bySlug) return bySlug;
  }
  const all = await ctx.adapter.findMany({ model: "organization", limit: 1 });
  return all[0] ?? null;
}

export async function findUser(ctx, email) {
  const r = await ctx.internalAdapter.findUserByEmail(email.toLowerCase(), {
    includeAccounts: false,
  });
  return r?.user ?? null;
}

/** Create a credential (email/password) user. Throws if the email exists. */
export async function createUserWithPassword(ctx, { email, name, password, role = "user" }) {
  const user = await ctx.internalAdapter.createUser({
    email: email.toLowerCase(),
    name,
    emailVerified: true,
    role,
  });
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    accountId: user.id,
    providerId: "credential",
    password: await ctx.password.hash(password),
  });
  return user;
}

export async function ensureOrgMember(ctx, organizationId, userId, role = "member") {
  const members = await ctx.adapter.findMany({
    model: "member",
    where: [{ field: "organizationId", value: organizationId }],
  });
  if (members.some((m) => m.userId === userId)) return;
  await ctx.adapter.create({
    model: "member",
    data: { organizationId, userId, role, createdAt: new Date() },
  });
}

export async function ensureTeamMember(ctx, teamId, userId) {
  const rows = await ctx.adapter.findMany({
    model: "teamMember",
    where: [{ field: "teamId", value: teamId }],
  });
  if (rows.some((r) => r.userId === userId)) return;
  await ctx.adapter.create({
    model: "teamMember",
    data: { teamId, userId, createdAt: new Date() },
  });
}

/**
 * Provision a brand-new user into the workspace: create the account, add them
 * to the org, and (optionally) to a team. Returns the created user.
 */
export async function provisionUser(ctx, { email, name, password, role = "user", teamId } = {}) {
  if (!email || !password) throw new Error("email and password are required");
  if (password.length < 8) throw new Error("password must be at least 8 characters");
  if (await findUser(ctx, email)) throw new Error("a user with that email already exists");

  const org = await getWorkspaceOrg(ctx);
  const user = await createUserWithPassword(ctx, { email, name: name || email.split("@")[0], password, role });
  if (org) {
    await ensureOrgMember(ctx, org.id, user.id, "member");
    if (teamId) await ensureTeamMember(ctx, teamId, user.id);
  }
  return user;
}
