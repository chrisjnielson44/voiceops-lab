"use client";

import { cn } from "@/lib/cn";

/** iOS-style segmented control: inset track, white selected pill. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cn("glass-inset flex rounded-xl p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-[0.6rem] font-medium transition-all",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active
                ? "bg-secondary text-foreground shadow-sm ring-1 ring-inset ring-border"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={active}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
