"use client";

import { Monitor, Moon, Sun } from "lucide-react";

import { useTheme, type Theme } from "@/components/theme/ThemeProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";

const OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun className="h-4 w-4" /> },
  { value: "dark", label: "Dark", icon: <Moon className="h-4 w-4" /> },
  { value: "system", label: "System", icon: <Monitor className="h-4 w-4" /> },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Toggle theme"
        className={cn(
          "relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          className,
        )}
      >
        <Sun className="h-4 w-4 rotate-0 scale-100 transition-transform duration-200 dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-transform duration-200 dark:rotate-0 dark:scale-100" />
        <span className="sr-only">
          Current theme: {resolvedTheme}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[8rem]">
        {OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onSelect={() => setTheme(opt.value)}
            className={cn(
              "gap-2",
              theme === opt.value && "text-foreground",
            )}
          >
            {opt.icon}
            <span className="flex-1">{opt.label}</span>
            {theme === opt.value && (
              <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
