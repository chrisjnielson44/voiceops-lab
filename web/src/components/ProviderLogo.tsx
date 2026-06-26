export type ProviderLogoId = "livekit" | "twilio" | "elevenlabs" | "openrouter" | "mlx";

export function ProviderLogo({ id, size = 28 }: { id: ProviderLogoId; size?: number }) {
  switch (id) {
    case "twilio": return <TwilioMark size={size} />;
    case "livekit": return <LiveKitMark size={size} />;
    case "elevenlabs": return <ElevenLabsMark size={size} />;
    case "openrouter": return <OpenRouterMark size={size} />;
    case "mlx": return <MLXMark size={size} />;
  }
}

function TwilioMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-label="Twilio">
      <circle cx="50" cy="50" r="50" fill="#F22F46" />
      <circle cx="34" cy="34" r="13" fill="white" />
      <circle cx="66" cy="66" r="13" fill="white" />
    </svg>
  );
}

function LiveKitMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-label="LiveKit">
      <rect width="100" height="100" rx="22" fill="#111111" />
      <rect x="13" y="38" width="17" height="44" rx="4" fill="#19F177" />
      <rect x="38" y="20" width="17" height="62" rx="4" fill="#19F177" />
      <rect x="63" y="44" width="17" height="38" rx="4" fill="#19F177" />
    </svg>
  );
}

function ElevenLabsMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-label="ElevenLabs">
      <rect width="100" height="100" rx="22" fill="#000000" />
      <rect x="26" y="22" width="17" height="56" rx="5" fill="white" />
      <rect x="57" y="22" width="17" height="56" rx="5" fill="white" />
    </svg>
  );
}

function OpenRouterMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-label="OpenRouter">
      <rect width="100" height="100" rx="22" fill="#0F0F10" />
      <circle cx="50" cy="50" r="10" fill="white" />
      <circle cx="50" cy="16" r="7" fill="white" />
      <circle cx="84" cy="50" r="7" fill="white" />
      <circle cx="16" cy="50" r="7" fill="white" />
      <circle cx="50" cy="84" r="7" fill="white" />
      <rect x="47.25" y="24" width="5.5" height="18" rx="2" fill="white" />
      <rect x="47.25" y="58" width="5.5" height="18" rx="2" fill="white" />
      <rect x="24" y="47.25" width="18" height="5.5" rx="2" fill="white" />
      <rect x="58" y="47.25" width="18" height="5.5" rx="2" fill="white" />
    </svg>
  );
}

function MLXMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-label="MLX (Apple Silicon)">
      <rect width="100" height="100" rx="22" fill="#1C1C1E" />
      <rect x="27" y="27" width="46" height="46" rx="8" fill="#3A3A3C" />
      {/* top pins */}
      <rect x="35" y="15" width="7" height="12" rx="2" fill="#636366" />
      <rect x="58" y="15" width="7" height="12" rx="2" fill="#636366" />
      {/* bottom pins */}
      <rect x="35" y="73" width="7" height="12" rx="2" fill="#636366" />
      <rect x="58" y="73" width="7" height="12" rx="2" fill="#636366" />
      {/* left pins */}
      <rect x="15" y="35" width="12" height="7" rx="2" fill="#636366" />
      <rect x="15" y="58" width="12" height="7" rx="2" fill="#636366" />
      {/* right pins */}
      <rect x="73" y="35" width="12" height="7" rx="2" fill="#636366" />
      <rect x="73" y="58" width="12" height="7" rx="2" fill="#636366" />
      <text
        x="50"
        y="56"
        textAnchor="middle"
        fill="white"
        fontSize="17"
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        MLX
      </text>
    </svg>
  );
}
