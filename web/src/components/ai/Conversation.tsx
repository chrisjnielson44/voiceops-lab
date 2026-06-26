"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * Vercel-AI-Elements-style conversation shell: a scrollable column that sticks
 * to the bottom as new parts stream in, with a floating "scroll to latest"
 * button that appears when the user scrolls away. `deps` should change whenever
 * new content arrives so auto-scroll fires.
 */
export function Conversation({
  children,
  deps,
  className,
}: {
  children: React.ReactNode;
  deps: unknown;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (pinned && ref.current) {
      ref.current.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
    }
  }, [deps, pinned]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setPinned(atBottom);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={ref}
        onScroll={onScroll}
        className={cn("scroll-thin flex-1 overflow-y-auto", className)}
      >
        <div className="flex flex-col gap-4 p-4">{children}</div>
      </div>
      {!pinned && (
        <button
          type="button"
          onClick={() => setPinned(true)}
          aria-label="Scroll to latest"
          className="liquid-glass absolute bottom-3 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full text-foreground shadow-pop"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function ConversationEmptyState({
  icon,
  title,
  description,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 p-8 text-center">
      {icon && (
        <span className="grid h-14 w-14 place-items-center rounded-2xl border border-border bg-secondary/60 text-foreground">
          {icon}
        </span>
      )}
      <div>
        <p className="text-base font-semibold text-foreground">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}
