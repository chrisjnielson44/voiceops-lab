import { cn } from "@/lib/cn";

export function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("glass flex flex-col rounded-2xl", className)}>{children}</section>
  );
}

export function PanelHeader({
  title,
  icon,
  right,
  subtitle,
  className,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border px-4 py-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}
