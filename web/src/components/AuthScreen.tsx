"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { signIn } from "@/lib/auth/client";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useTheme } from "@/components/theme/ThemeProvider";
import Waves from "@/components/ui/backgrounds/Waves";
import "@/components/ui/backgrounds/backgrounds.css";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { WaveMark } from "@/components/ui/WaveMark";

export function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reduce = useReducedMotion();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Sign-in only — accounts are provisioned by an admin (sign-up disabled).
      const res = await signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message ?? "Authentication failed.");
      }
      // On success Better Auth sets the session cookie; useSession revalidates.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* Animated waves backdrop (ReactBits) */}
      <div className="pointer-events-none absolute inset-0 z-0 opacity-70">
        <Waves
          lineColor={isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.18)"}
          backgroundColor="transparent"
        />
      </div>
      <div className="fixed right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        {/* Brand + signature mark */}
        <div className="mb-6 flex flex-col items-center text-center">
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
            className="logo-mark liquid-glass relative mb-4 flex h-16 w-16 items-center justify-center rounded-2xl text-foreground shadow-pop"
          >
            <WaveMark className="h-9 w-9" />
          </motion.div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Voice Labs</h1>
        </div>

        <div className="liquid-glass liquid-glass-edge rounded-3xl p-6 shadow-pop">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Email" htmlFor="auth-email">
              <Input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@clinic.org"
              />
            </Field>
            <Field label="Password" htmlFor="auth-password">
              <Input
                id="auth-password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Your password"
              />
            </Field>

            <AnimatePresence initial={false}>
              {error && (
                <motion.div
                  initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, height: "auto" }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <div className="rounded-xl bg-destructive/15 px-3 py-2 text-sm text-red-600 dark:text-red-400 ring-1 ring-inset ring-destructive/30">
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <Button type="submit" disabled={busy} size="lg" className="mt-1 w-full">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </Button>
          </form>


        </div>
      </motion.div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="mb-1 block">
        {label}
      </Label>
      {children}
    </div>
  );
}
