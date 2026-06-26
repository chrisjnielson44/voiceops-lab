"use client";

import { AnimatePresence, motion } from "framer-motion";

import { cn } from "@/lib/cn";

/**
 * Height/opacity-animated disclosure used across the AI-Elements kit
 * (Reasoning / Tool / Sources). No extra dependency — pure framer-motion so it
 * shares the app's motion language.
 */
export function CollapsibleContent({
  open,
  children,
  className,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="collapsible"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className={cn("overflow-hidden", className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
