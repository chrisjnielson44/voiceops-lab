import { useQuery } from "@tanstack/react-query";
import type { ProviderStatus } from "@/lib/providers/types";
import type { TelephonyStatus, VoiceProviderStatus } from "@/lib/voice/types";

export interface LocalLLMStatus {
  ok: boolean;
  model: string;
  baseUrl: string;
  detail: string;
}

export interface ProviderStatusResponse {
  demoMode: boolean;
  promptVersion: string;
  localLLM: LocalLLMStatus;
  llm: ProviderStatus[];
  voice: VoiceProviderStatus[];
  telephony: TelephonyStatus[];
}

async function fetchProviderStatus(): Promise<ProviderStatusResponse> {
  const res = await fetch("/api/providers");
  if (!res.ok) throw new Error(`providers ${res.status}`);
  return res.json();
}

/**
 * Live provider/telephony configuration from the backend (which reads env at
 * request time). Now backed by TanStack Query for caching/dedup/retry — the
 * same hook can be called from several components and only fetches once.
 * Returns the same { data, error } shape the cockpit already consumes.
 */
export function useProviderStatus() {
  const { data, error } = useQuery({
    queryKey: ["providers"],
    queryFn: fetchProviderStatus,
  });

  return {
    data: data ?? null,
    error: error
      ? error instanceof Error
        ? error.message
        : "Failed to load provider status"
      : null,
  };
}
