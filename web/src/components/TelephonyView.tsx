"use client";

import { useState } from "react";
import {
  ShieldAlert,
  PhoneOutgoing,
  CheckCircle2,
  XCircle,
  Radio,
  Mic,
  Server,
  Cloud,
  ListChecks,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ProviderStatusResponse } from "@/state/useProviderStatus";
import { useCallStore } from "@/state/useCallStore";
import { useScenario } from "@/state/useScenario";
import { PROVIDER_LABELS } from "@/lib/providers/registry";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MotionItem, MotionStagger } from "@/components/ui/motion";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";

interface CallResult {
  vendor: string;
  ok: boolean;
  demo: boolean;
  detail: string;
}

function ConfigCard({
  label,
  icon,
  configured,
  detail,
  missingEnv,
  badge,
}: {
  label: string;
  icon: React.ReactNode;
  configured: boolean;
  detail: string;
  missingEnv: string[];
  badge?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <MotionItem
      whileHover={reduce ? undefined : { y: -3 }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      className="glass rounded-2xl p-3.5 transition-shadow hover:shadow-glow"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-secondary/60 text-muted-foreground ring-1 ring-inset ring-border">
          {icon}
        </span>
        <span className="font-medium text-foreground">{label}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {badge}
          <StatusChip tone={configured ? "green" : "slate"} dot>
            {configured ? "configured" : "stub"}
          </StatusChip>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      {missingEnv.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {missingEnv.map((env) => (
            <li key={env} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <XCircle className="h-3.5 w-3.5 text-muted-foreground/60" />
              <span className="font-mono text-foreground/80">{env}</span>
              <span className="text-muted-foreground/70">— not set</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" /> All required variables present
        </div>
      )}
    </MotionItem>
  );
}

export function TelephonyView({ providerStatus }: { providerStatus: ProviderStatusResponse | null }) {
  const scenarioId = useCallStore((s) => s.scenarioId);
  const { data: scenario } = useScenario(scenarioId);
  const [vendor, setVendor] = useState<"livekit" | "twilio">("livekit");
  const [toNumber, setToNumber] = useState("");
  const [result, setResult] = useState<CallResult | null>(null);
  const [loading, setLoading] = useState(false);
  const reduce = useReducedMotion();

  const placeCall = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/telephony", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor, toNumber, scenarioId }),
      });
      setResult(await res.json());
    } catch (e) {
      setResult({ vendor, ok: false, demo: true, detail: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setLoading(false);
    }
  };

  const demoMode = providerStatus?.demoMode ?? true;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Integrations" />

      {/* Demo-mode banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-amber-600 dark:text-amber-400">Demo mode is engaged</span>
            <StatusChip tone="amber" dot pulse>
              {demoMode ? "VOICEOPS_DEMO_MODE=true" : "live mode"}
            </StatusChip>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-amber-400/80">
            Outbound dialing is hard-disabled. The control below exercises the real telephony adapter and
            returns a <span className="font-medium text-amber-600 dark:text-amber-400">simulated</span> result — no PSTN/SIP call is ever
            placed, even if credentials are present. Flip{" "}
            <span className="font-mono text-amber-600 dark:text-amber-400">VOICEOPS_DEMO_MODE=false</span> only in an authorized environment
            with a verified callee.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Test call */}
        <Card className="flex flex-col lg:col-span-1">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-muted-foreground"><PhoneOutgoing className="h-4 w-4" /></span>
              <div className="min-w-0">
                <CardTitle className="truncate">Place a call (demo)</CardTitle>
              </div>
            </div>
          </CardHeader>
          <div className="space-y-3 p-4">
            <div>
              <Label className="mb-1 block">Telephony vendor</Label>
              <Tabs value={vendor} onValueChange={(val) => setVendor(val as "livekit" | "twilio")}>
                <TabsList className="w-full">
                  <TabsTrigger value="livekit" className="flex-1">LiveKit</TabsTrigger>
                  <TabsTrigger value="twilio" className="flex-1">Twilio</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div>
              <Label htmlFor="dest-number" className="mb-1 block">
                Destination number
              </Label>
              <Input
                id="dest-number"
                value={toNumber}
                onChange={(e) => setToNumber(e.target.value)}
                placeholder="+1 (555) 010-2233"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Calling {scenario?.payer ?? "—"} for: {(scenario?.title ?? "").toLowerCase()}
              </p>
            </div>
            <Button type="button" onClick={placeCall} disabled={loading} className="w-full">
              <PhoneOutgoing className="h-4 w-4" />
              {loading ? "Dialing…" : "Place call"}
            </Button>
            <AnimatePresence initial={false} mode="wait">
              {result && (
                <motion.div
                  key={result.detail}
                  initial={reduce ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <div
                    className={cn(
                      "rounded-xl border p-3 text-sm",
                      result.demo
                        ? "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <StatusChip tone={result.demo ? "amber" : "green"} dot>
                        {result.demo ? "simulated" : "placed"}
                      </StatusChip>
                      <span className="font-mono text-xs">{result.vendor}</span>
                    </div>
                    {result.detail}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Card>

        {/* Telephony providers */}
        <MotionStagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-2">
          {providerStatus?.telephony.map((t) => (
            <ConfigCard
              key={t.id}
              label={t.label}
              icon={t.vendor === "livekit" ? <Radio className="h-4 w-4" /> : <PhoneOutgoing className="h-4 w-4" />}
              configured={t.configured}
              detail={t.detail}
              missingEnv={t.missingEnv}
              badge={t.demoMode ? <StatusChip tone="amber">dialing gated</StatusChip> : undefined}
            />
          )) ?? <CardSkeleton count={2} />}

          {providerStatus?.voice.map((v) => (
            <ConfigCard
              key={v.id}
              label={`${v.label} · voice`}
              icon={<Mic className="h-4 w-4" />}
              configured={v.configured}
              detail={v.detail}
              missingEnv={v.missingEnv}
              badge={<StatusChip tone="slate">{v.capabilities.join(" · ")}</StatusChip>}
            />
          ))}

          {providerStatus?.llm
            .filter((p) => p.id !== "demo")
            .map((p) => (
              <ConfigCard
                key={p.id}
                label={`${PROVIDER_LABELS[p.id]} · LLM`}
                icon={p.kind === "local" ? <Server className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
                configured={p.configured}
                detail={p.detail}
                missingEnv={p.missingEnv}
                badge={<StatusChip tone={p.kind === "local" ? "violet" : "blue"}>{p.kind}</StatusChip>}
              />
            ))}
        </MotionStagger>
      </div>

      {/* LiveKit voice agent */}
      <Card className="flex flex-col">
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-muted-foreground"><Radio className="h-4 w-4" /></span>
            <div className="min-w-0">
              <CardTitle className="truncate">LiveKit voice agent</CardTitle>
              <p className="truncate text-xs text-muted-foreground">Deployable Python agent in /agent — same tools + local model, over real STT/LLM/TTS</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2"><StatusChip tone="violet">code ready · deploy later</StatusChip></div>
        </CardHeader>
        <div className="space-y-3 p-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            The voice counterpart to the in-app text agent lives in{" "}
            <span className="font-mono text-xs text-foreground/80">/agent</span>. It runs a real STT → LLM → TTS loop
            with the same payer-ops tools, querying the same Neon ground truth, and points its LLM at the local MLX
            server. Deploying to LiveKit Cloud needs an interactive login with your account, so run it yourself:
          </p>
          <pre className="glass-inset overflow-x-auto rounded-xl px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/80">
{`brew install livekit-cli
lk cloud auth            # browser login to your LiveKit account
cd agent && lk agent create   # builds + deploys (uses Dockerfile)`}
          </pre>
        </div>
      </Card>

      {/* Go-live checklist */}
      <Card className="flex flex-col">
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-muted-foreground"><ListChecks className="h-4 w-4" /></span>
            <div className="min-w-0">
              <CardTitle className="truncate">Go-live checklist</CardTitle>
            </div>
          </div>
        </CardHeader>
        <MotionStagger className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { n: 1, t: "Provision telephony", d: "Add LiveKit SIP trunk or Twilio number + credentials to .env.local." },
            { n: 2, t: "Wire voice I/O", d: "Set ElevenLabs key + voice id for real TTS/STT on the media stream." },
            { n: 3, t: "Route a model", d: "Add OPENROUTER_API_KEY or start MLX LM; the same adapters go live." },
            { n: 4, t: "Disable demo mode", d: "Set VOICEOPS_DEMO_MODE=false in an authorized env with a verified callee." },
          ].map((step) => (
            <MotionItem
              key={step.n}
              whileHover={reduce ? undefined : { y: -3 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              className="glass-inset rounded-xl p-3 transition-shadow hover:shadow-glow"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {step.n}
              </span>
              <div className="mt-2 text-sm font-medium text-foreground">{step.t}</div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.d}</p>
            </MotionItem>
          ))}
        </MotionStagger>
      </Card>
    </div>
  );
}

function CardSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-28 animate-pulse rounded-2xl border border-border bg-secondary/60" />
      ))}
    </>
  );
}
