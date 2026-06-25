import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Class name combiner used across the cockpit. Backed by clsx (conditional
 * classes) + tailwind-merge (last-wins conflict resolution) so shadcn-style
 * variant overrides behave correctly.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
