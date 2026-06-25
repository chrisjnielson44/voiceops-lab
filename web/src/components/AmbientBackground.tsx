/**
 * Ambient canvas. A faint, slow aurora of brand-tinted color fields sits behind
 * the liquid-glass chrome so the glass has something to refract — the source of
 * the iOS-26 depth — while staying subtle enough that flat surfaces still read
 * cleanly. Tuned down hard in light mode. Fixed + pointer-events-none; honors
 * reduced motion via the global media query.
 */
export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-40 -top-44 h-[34rem] w-[34rem] animate-float rounded-full bg-brand-500/10 blur-3xl dark:bg-brand-500/15" />
      <div
        className="absolute -right-32 top-8 h-[30rem] w-[30rem] animate-float rounded-full bg-teal-400/[0.07] blur-3xl dark:bg-teal-400/10"
        style={{ animationDelay: "-6s" }}
      />
      <div
        className="absolute bottom-[-14rem] left-1/3 h-[34rem] w-[34rem] animate-float rounded-full bg-violet-500/[0.07] blur-3xl dark:bg-violet-500/10"
        style={{ animationDelay: "-11s" }}
      />
    </div>
  );
}
