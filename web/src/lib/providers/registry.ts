import type { ProviderId } from "./types";

/**
 * Provider id → display label. The runnable model catalog is NOT hardcoded here —
 * it comes from the backend at runtime via GET /api/voice/options (which reflects
 * the actually-configured local/hosted providers). This file is just the label map.
 */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openrouter: "OpenRouter",
  mlx: "MLX LM (local)",
  demo: "Demo Engine",
};
