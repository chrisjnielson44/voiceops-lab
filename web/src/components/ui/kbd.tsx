import * as React from "react";

import { cn } from "@/lib/cn";

/**
 * A keyboard-key chip. Pass keys as children (e.g. <Kbd>⌘</Kbd><Kbd>K</Kbd>)
 * or a single combo string via `keys` (e.g. <Kbd keys={["⌘", "K"]} />).
 */
function Kbd({
  className,
  keys,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & { keys?: string[] }) {
  if (keys) {
    return (
      <span className={cn("inline-flex items-center gap-1", className)}>
        {keys.map((k, i) => (
          <Kbd key={i} {...props}>
            {k}
          </Kbd>
        ))}
      </span>
    );
  }
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}

export { Kbd };
