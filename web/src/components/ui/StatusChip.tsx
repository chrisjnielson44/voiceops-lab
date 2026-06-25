import { cn } from "@/lib/cn";

export type Tone = "green" | "amber" | "red" | "blue" | "slate" | "violet";

const TONE: Record<Tone, string> = {
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20",
  red: "bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20",
  blue: "bg-brand-500/10 text-brand-700 dark:text-brand-300 ring-brand-500/20",
  slate: "bg-secondary text-muted-foreground ring-border",
  violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/20",
};

const DOT: Record<Tone, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-brand-500",
  slate: "bg-muted-foreground",
  violet: "bg-violet-500",
};

export function StatusChip({
  tone = "slate",
  children,
  dot = false,
  pulse = false,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "glass-chip inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONE[tone],
        className,
      )}
    >
      {dot && (
        <span className="relative flex h-1.5 w-1.5">
          {pulse && (
            <span className={cn("absolute inline-flex h-full w-full animate-pulse-ring rounded-full opacity-60", DOT[tone])} />
          )}
          <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", DOT[tone])} />
        </span>
      )}
      {children}
    </span>
  );
}
