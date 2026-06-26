import { createAuthClient } from "better-auth/react";

/**
 * Better Auth React client. In dev the Vite proxy maps /api/auth -> the
 * standalone auth-server, so the default (current-origin /api/auth) works and keeps cookies
 * same-origin. For a split-origin production deploy, set VITE_AUTH_BASE_URL to
 * the auth origin (e.g. https://auth.example.com/api/auth) — the server must
 * then allow this origin (trustedOrigins) and send credentials.
 */
const baseURL = import.meta.env.VITE_AUTH_BASE_URL || undefined;

export const authClient = createAuthClient(baseURL ? { baseURL } : undefined);

export const { signIn, signUp, signOut, useSession } = authClient;
