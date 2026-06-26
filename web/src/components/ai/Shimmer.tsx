"use client";

import { cn } from "@/lib/cn";

/**
 * A text shimmer (gradient sweep) — used on "Thinking…" / activity labels while
 * a reasoning model streams, matching the Vercel AI Elements look.
 */
export function Shimmer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("vo-shimmer", className)}>{children}</span>;
}
