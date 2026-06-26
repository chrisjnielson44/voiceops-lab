import type { ReactNode } from "react";
import { Cloud } from "lucide-react";
// Official brand marks. We use the `.Color`/`.Mono` variants only (pure SVG) —
// the `.Avatar` variant pulls antd via @lobehub/ui, which bundlers tree-shake
// out as long as we never touch it.
import { Claude, DeepSeek, Gemini, Gemma, IBM, Meta, Microsoft, Mistral, Ollama, OpenAI, Qwen } from "@lobehub/icons";

export interface ModelProvider {
  name: string;
  logo: ReactNode;
}

// Map a model id to the org that publishes it, with its real logo. Matched on
// the family prefix (before any ":" tag), so "gemma4:31b-mlx" → Google.
// Shared by ModelsView and HomeView so the catalog reads the same everywhere.
export function getModelProvider(modelId: string, isLocal: boolean, size = 22): ModelProvider {
  const base = (modelId.split(":")[0].split("/").pop() ?? "").toLowerCase();

  // Hosted frontier families (routed via OpenRouter).
  if (base.startsWith("claude")) return { name: "Anthropic", logo: <Claude.Color size={size} /> };
  if (base.startsWith("gpt") || base.startsWith("o1") || base.startsWith("o3") || base.startsWith("o4"))
    return { name: "OpenAI", logo: <OpenAI size={size} className="text-foreground" /> };
  if (base.startsWith("gemini")) return { name: "Google", logo: <Gemini.Color size={size} /> };

  if (base.startsWith("gemma") || base.startsWith("medgemma"))
    return { name: "Google", logo: <Gemma.Color size={size} /> };
  if (base.startsWith("llama") || base.startsWith("codellama"))
    return { name: "Meta", logo: <Meta.Color size={size} /> };
  if (base.startsWith("mistral") || base.startsWith("mixtral") || base.startsWith("codestral"))
    return { name: "Mistral AI", logo: <Mistral.Color size={size} /> };
  if (base.startsWith("qwen") || base.startsWith("qwq"))
    return { name: "Alibaba", logo: <Qwen.Color size={size} /> };
  if (base.startsWith("granite"))
    return { name: "IBM", logo: <IBM size={size} className="text-[#1F70C1]" /> };
  if (base.startsWith("phi"))
    return { name: "Microsoft", logo: <Microsoft.Color size={size} /> };
  if (base.startsWith("deepseek"))
    return { name: "DeepSeek", logo: <DeepSeek.Color size={size} /> };

  return isLocal
    ? { name: "Local", logo: <Ollama size={size} className="text-foreground" /> }
    : { name: "Hosted", logo: <Cloud size={size} className="text-brand-500" /> };
}
