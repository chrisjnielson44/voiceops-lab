"use client";

import { useState } from "react";
import { AudioWaveform, Loader2, ShieldCheck, Database, Cpu } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { signIn, signUp } from "@/lib/auth/client";
import { Segmented } from "@/components/ui/Segmented";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type Mode = "signin" | "signup";

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reduce = useReducedMotion();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "signin"
          ? await signIn.email({ email, password })
          : await signUp.email({ email, password, name: name || email.split("@")[0] });
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
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="fixed right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md"
      >
        {/* Brand + signature mark */}
        <div className="mb-6 flex flex-col items-center text-center">
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
            className="relative mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-primary text-primary-foreground shadow-pop"
          >
            <motion.span
              animate={reduce ? undefined : { rotate: [0, 8, -8, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="relative"
            >
              <AudioWaveform className="h-8 w-8" />
            </motion.span>
          </motion.div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">VoiceOps Lab</h1>
          <p className="mt-1 text-sm text-muted-foreground">Healthcare voice-agent operations cockpit</p>
        </div>

        <div className="glass rounded-3xl p-6 shadow-pop">
          <Segmented
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
            options={[
              { value: "signin", label: "Sign in" },
              { value: "signup", label: "Create account" },
            ]}
            className="mb-5"
          />

          <form onSubmit={submit} className="space-y-3">
            <AnimatePresence initial={false}>
              {mode === "signup" && (
                <motion.div
                  key="name-field"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, height: "auto" }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <div className="pb-3">
                    <Field label="Name" htmlFor="auth-name">
                      <Input
                        id="auth-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                        placeholder="Jordan Lee"
                      />
                    </Field>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <Field label="Work email" htmlFor="auth-email">
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
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                placeholder="At least 8 characters"
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
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="mt-5 flex items-center justify-center gap-4 border-t border-border pt-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" /> Better Auth
            </span>
            <span className="flex items-center gap-1">
              <Database className="h-3.5 w-3.5" /> Neon Postgres
            </span>
            <span className="flex items-center gap-1">
              <Cpu className="h-3.5 w-3.5" /> Local model
            </span>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Real sessions, real local inference. No PHI is real — all records are synthetic.
        </p>
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
