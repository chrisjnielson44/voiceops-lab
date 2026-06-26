"use client";

import { motion, type Variants } from "framer-motion";

import { cn } from "@/lib/cn";

/**
 * Shared motion presets so every view animates consistently. Keep durations
 * short — this is an ops console, not a marketing page.
 */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
};

export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
};

/** A vertically-staggered list/grid container. */
export function MotionStagger({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** A single fade-up item (use inside MotionStagger or standalone). */
export function MotionItem({
  children,
  className,
  ...props
}: React.ComponentProps<typeof motion.div>) {
  return (
    <motion.div variants={fadeUp} className={cn(className)} {...props}>
      {children}
    </motion.div>
  );
}

/** Page/view wrapper — a clean opacity crossfade on tab switch. No vertical
 *  translate (which caused a layout jump) and a quick duration so switching
 *  pages feels instant rather than flickering through a loader. */
export function MotionView({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
