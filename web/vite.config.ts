import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Dev proxy keeps everything same-origin so Better Auth cookies "just work":
 *   /api/auth/*  -> the standalone auth-server (Better Auth lives there)
 *   /api/*       -> the FastAPI backend (call runtime, analytics, providers, ...)
 * In production, front the SPA with an ingress that routes those two prefixes
 * the same way. Override targets via VITE_AUTH_PROXY / VITE_API_PROXY.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const AUTH = env.VITE_AUTH_PROXY || "http://127.0.0.1:3000";
  const API = env.VITE_API_PROXY || "http://127.0.0.1:8000";

  return {
    plugins: [react()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    build: {
      rollupOptions: {
        output: {
          // Split heavy/shared vendors so the cockpit doesn't ship charts it
          // doesn't need, and vendor code caches across app deploys. Function
          // form so react/react-dom are claimed before @tanstack absorbs them.
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler|object-assign)[\\/]/.test(id)) return "react";
            if (id.includes("@tanstack")) return "router";
            if (id.includes("recharts") || id.includes("d3-")) return "charts";
            if (id.includes("framer-motion") || id.includes("motion-dom") || id.includes("motion-utils")) return "motion";
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        // Order matters: the more specific /api/auth prefix is matched first.
        "/api/auth": { target: AUTH, changeOrigin: true },
        "/api/realtime": { target: AUTH, changeOrigin: true },
        "/api": { target: API, changeOrigin: true },
      },
    },
  };
});
