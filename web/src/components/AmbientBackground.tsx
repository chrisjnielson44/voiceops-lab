/**
 * Ambient depth layer. Flat, monochrome near-black / near-white canvas
 * (Vercel/Cursor-style) — no color, no motion. Two whisper-soft neutral
 * vignettes add a hint of depth for the frosted chrome and overlays to sit
 * against. Fixed + pointer-events-none so it never interferes.
 */
export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-48 left-1/2 h-[32rem] w-[58rem] -translate-x-1/2 rounded-full bg-foreground/[0.02] blur-3xl dark:bg-white/[0.03]" />
      <div className="absolute bottom-[-16rem] left-1/3 h-[30rem] w-[40rem] rounded-full bg-foreground/[0.015] blur-3xl dark:bg-white/[0.02]" />
    </div>
  );
}
