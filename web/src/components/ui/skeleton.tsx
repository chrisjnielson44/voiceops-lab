import { cn } from "@/lib/cn";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-lg bg-secondary/60", className)}
      {...props}
    />
  );
}

export { Skeleton };
