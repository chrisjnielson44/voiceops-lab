/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PREVIEW_BYPASS?: string;
  readonly VITE_AUTH_BASE_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
