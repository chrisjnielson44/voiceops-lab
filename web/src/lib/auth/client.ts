import { createAuthClient } from "better-auth/react";
import { adminClient, organizationClient } from "better-auth/client/plugins";

/**
 * Better Auth React client. In dev the Vite proxy maps /api/auth -> the
 * standalone auth-server, so the default (current-origin /api/auth) works and keeps cookies
 * same-origin. For a split-origin production deploy, set VITE_AUTH_BASE_URL to
 * the auth origin (e.g. https://auth.example.com/api/auth) — the server must
 * then allow this origin (trustedOrigins) and send credentials.
 *
 * Plugins mirror the server (auth-server/auth.mjs): `admin` exposes user
 * management + a `role` field on the session user; `organization` exposes
 * teams/members for the admin Team surface.
 */
const baseURL = import.meta.env.VITE_AUTH_BASE_URL || undefined;

export const authClient = createAuthClient({
  ...(baseURL ? { baseURL } : {}),
  plugins: [adminClient(), organizationClient({ teams: { enabled: true } })],
});

// Public sign-up is disabled server-side, so `signUp` is intentionally not exported.
export const { signIn, signOut, useSession, admin, organization } = authClient;

/**
 * Sign out and hard-reload to the gate. `signOut()` clears the session
 * server-side, but the SPA's `useSession` can keep returning the cached session
 * (we enable a 5-min cookie cache), so the auth screen wouldn't appear. A full
 * reload forces the gate to re-check against the server. Reloads even on error
 * so the button always does something visible.
 */
export async function logout(): Promise<void> {
  try {
    await signOut();
  } finally {
    if (typeof window !== "undefined") window.location.assign("/");
  }
}
