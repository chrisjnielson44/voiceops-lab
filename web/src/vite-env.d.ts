/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PREVIEW_BYPASS?: string;
  readonly VITE_AUTH_BASE_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
