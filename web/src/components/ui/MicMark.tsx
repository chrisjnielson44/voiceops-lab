import { cn } from "@/lib/cn";

/**
 * Brand mark: the lucide `Mic`. On hover the capsule fills from the bottom with
 * an irregular, speech-like level (clipped to the capsule shape) — like a live
 * input meter while someone talks. Idle = a clean outlined mic. See globals.css
 * (`.mic-fill` / `@keyframes mic-speak`).
 */
export function MicMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("overflow-hidden", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="micCapClip">
          <rect x="9" y="2" width="6" height="13" rx="3" />
        </clipPath>
      </defs>

      {/* animated voice-level fill, clipped to the capsule */}
      <g clipPath="url(#micCapClip)">
        <rect className="mic-fill" x="9" y="2" width="6" height="13" fill="currentColor" stroke="none" />
      </g>

      {/* mic outline */}
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}
