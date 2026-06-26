"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Wand2, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  type CustomScenarioInput,
  type ScenarioSummary,
  useScenarioMutations,
} from "@/state/useScenarios";

const EMPTY: CustomScenarioInput = {
  title: "",
  payer: "",
  category: "general",
  difficulty: "moderate",
  outcome: "completed",
  objective: "",
  subjectName: "",
  subjectId: "",
  callerName: "",
  requiredFields: [],
  facts: "",
};

/** Map an existing custom scenario back into the editable input shape. */
function toInput(s: ScenarioSummary): CustomScenarioInput {
  return {
    title: s.title,
    payer: s.payer,
    category: s.category,
    difficulty: s.difficulty,
    outcome: s.outcome,
    objective: s.objective,
    subjectName: s.patient?.name ?? "",
    subjectId: s.patient?.memberId ?? "",
    callerName: s.provider?.name ?? "",
    requiredFields: s.requiredFields ?? [],
    facts: s.facts ?? "",
  };
}

export function ScenarioEditor({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: ScenarioSummary | null;
}) {
  const { create, update } = useScenarioMutations();
  const [form, setForm] = useState<CustomScenarioInput>(EMPTY);
  const [fieldDraft, setFieldDraft] = useState("");

  // Reseed the form whenever the dialog opens (for create or a specific edit).
  useEffect(() => {
    if (open) {
      setForm(editing ? toInput(editing) : EMPTY);
      setFieldDraft("");
    }
  }, [open, editing]);

  const set = <K extends keyof CustomScenarioInput>(key: K, value: CustomScenarioInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const addField = (raw: string) => {
    const parts = raw
      .split(",")
      .map((p) => p.trim().replace(/\s+/g, "_"))
      .filter(Boolean);
    if (!parts.length) return;
    setForm((f) => ({ ...f, requiredFields: [...new Set([...f.requiredFields, ...parts])] }));
    setFieldDraft("");
  };
  const removeField = (f: string) =>
    setForm((cur) => ({ ...cur, requiredFields: cur.requiredFields.filter((x) => x !== f) }));

  const ready = form.title.trim() && form.payer.trim();
  const pending = create.isPending || update.isPending;

  const submit = async () => {
    if (!ready || pending) return;
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, input: form });
        toast.success("Scenario updated", { description: form.title });
      } else {
        await create.mutateAsync(form);
        toast.success("Scenario created", { description: form.title });
      }
      onOpenChange(false);
    } catch (e) {
      toast.error("Couldn't save scenario", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-brand-500" />
            {editing ? "Edit scenario" : "New scenario"}
          </DialogTitle>
          <DialogDescription>
            Custom scenarios run on the generic agent loop — the counterparty answers from the facts you
            provide, so no database seeding is needed. Runnable in both Simulate and Live.
          </DialogDescription>
        </DialogHeader>

        <div className="scroll-thin max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Title" htmlFor="sc-title">
              <Input id="sc-title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Refund a duplicate charge" />
            </Field>
            <Field label="Counterparty / org being called" htmlFor="sc-payer">
              <Input id="sc-payer" value={form.payer} onChange={(e) => set("payer", e.target.value)} placeholder="Acme Retail" />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Category" htmlFor="sc-cat">
              <Input id="sc-cat" value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="refund" />
            </Field>
            <Field label="Difficulty">
              <Select value={form.difficulty} onValueChange={(v) => set("difficulty", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="routine">Routine</SelectItem>
                  <SelectItem value="moderate">Moderate</SelectItem>
                  <SelectItem value="complex">Complex</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Expected outcome">
              <Select value={form.outcome} onValueChange={(v) => set("outcome", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="escalated">Escalated</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Objective" htmlFor="sc-obj">
            <textarea
              id="sc-obj"
              value={form.objective}
              onChange={(e) => set("objective", e.target.value)}
              rows={2}
              placeholder="What the agent is trying to accomplish on the call."
              className="scroll-thin w-full resize-y rounded-lg border border-input bg-background/60 p-3 text-sm leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Subject name" htmlFor="sc-subj">
              <Input id="sc-subj" value={form.subjectName} onChange={(e) => set("subjectName", e.target.value)} placeholder="Sam Carter" />
            </Field>
            <Field label="Subject reference / ID" htmlFor="sc-subjid">
              <Input id="sc-subjid" value={form.subjectId} onChange={(e) => set("subjectId", e.target.value)} placeholder="ORD-99812" />
            </Field>
            <Field label="Caller / on behalf of" htmlFor="sc-caller">
              <Input id="sc-caller" value={form.callerName} onChange={(e) => set("callerName", e.target.value)} placeholder="Sam Carter (customer)" />
            </Field>
          </div>

          <Field label="Required fields to capture" hint="Enter or comma to add">
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background/60 p-2">
              {form.requiredFields.map((f) => (
                <span key={f} className="flex items-center gap-1 rounded-full bg-secondary/70 px-2 py-0.5 text-[11px] font-medium text-foreground">
                  {f.replace(/_/g, " ")}
                  <button type="button" onClick={() => removeField(f)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                value={fieldDraft}
                onChange={(e) => setFieldDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addField(fieldDraft);
                  } else if (e.key === "Backspace" && !fieldDraft && form.requiredFields.length) {
                    removeField(form.requiredFields[form.requiredFields.length - 1]);
                  }
                }}
                onBlur={() => addField(fieldDraft)}
                placeholder={form.requiredFields.length ? "" : "order_id, refund_amount…"}
                className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
              />
            </div>
          </Field>

          <Field label="Ground-truth facts" hint="what the counterparty knows">
            <textarea
              value={form.facts}
              onChange={(e) => set("facts", e.target.value)}
              rows={6}
              placeholder={"ORDER ORD-99812 was charged twice ($42.00).\nPolicy: refund the duplicate and issue an RMA on request.\nAUTH: verify with order ID and email on file."}
              className="scroll-thin w-full resize-y rounded-lg border border-input bg-background/60 p-3 font-mono text-[12px] leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              The counterparty model answers ONLY from these records. Be specific — include the values the
              agent must confirm, plus any authentication step or escalation trigger.
            </p>
          </Field>
        </div>

        <DialogFooter className="gap-2 border-t border-border px-5 py-3">
          {editing && <StatusChip tone="violet" className="mr-auto">editing · {editing.id}</StatusChip>}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ready || pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {editing ? "Save changes" : "Create scenario"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        {label}
        {hint && <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}
