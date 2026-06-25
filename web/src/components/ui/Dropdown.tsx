"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Lightweight dropdown: a trigger button plus a menu that closes on outside
 * click or item selection. Avoids a popover dependency for a small need.
 */
export function Dropdown({
  button,
  children,
  align = "left",
  widthClass = "w-72",
  className,
}: {
  button: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  widthClass?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {button}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            onClick={() => setOpen(false)}
            className={cn(
              "glass scroll-thin absolute z-40 mt-1.5 max-h-[60vh] animate-fade-in overflow-auto rounded-2xl p-1.5 shadow-pop",
              align === "right" ? "right-0" : "left-0",
              widthClass,
            )}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

export function DropdownItem({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors",
        active ? "bg-accent text-accent-foreground" : "text-foreground/90 hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
