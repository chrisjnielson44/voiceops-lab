/**
 * Voice + telephony type contracts (client copy). The original server module
 * (src/lib/voice/types.ts) also exported runtime adapters and an isDemoMode()
 * that reads process.env; the SPA only consumes the STATUS SHAPES returned by
 * the backend's /api/providers, so this client copy is types-only.
 */

export interface VoiceProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  capabilities: Array<"tts" | "stt">;
  missingEnv: string[];
  detail: string;
}

export type TelephonyVendor = "livekit" | "twilio";

export interface TelephonyStatus {
  id: string;
  label: string;
  vendor: TelephonyVendor;
  configured: boolean;
  missingEnv: string[];
  /** True when the global demo kill-switch is engaged. */
  demoMode: boolean;
  detail: string;
}

export interface PlaceCallResult {
  ok: boolean;
  /** True when the call was simulated rather than actually placed. */
  demo: boolean;
  callId?: string;
  detail: string;
}
