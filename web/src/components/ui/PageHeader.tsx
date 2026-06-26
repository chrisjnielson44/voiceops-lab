import { cn } from "@/lib/cn";

/**
 * The single, consistent page header used across every top-level view so the
 * title sits in the same place on every page: title on the left, optional
 * actions/status on the right, vertically centered, with uniform spacing.
 */
export function PageHeader({
  title,
  actions,
  className,
}: {
  title: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-9 flex-wrap items-center justify-between gap-3", className)}>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
