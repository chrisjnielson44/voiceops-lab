"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Layers,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MotionItem, MotionStagger } from "@/components/ui/motion";
import { useSettings } from "@/state/useSettings";
import {
  type ScenarioSummary,
  useScenarioCatalog,
  useScenarioMutations,
} from "@/state/useScenarios";
import { ScenarioEditor } from "@/components/ScenarioEditor";
import { cn } from "@/lib/cn";

const PACK_TONE: Record<string, Tone> = {
  healthcare: "violet",
  banking: "blue",
  telecom: "green",
  custom: "amber",
};

const DIFFICULTIES = ["routine", "moderate", "complex"] as const;

export function ScenariosView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const setPlaygroundDefaults = useSettings((s) => s.setPlaygroundDefaults);
  const { data, isLoading } = useScenarioCatalog();
  const { remove } = useScenarioMutations();

  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ScenarioSummary | null>(null);

  const all = useMemo(() => data?.scenarios ?? [], [data]);

  // Filter by free-text + difficulty, then group by owning pack so the catalog
  // reads like a library. Custom scenarios always get their own section.
  const packs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = all.filter((s) => {
      if (difficulty && s.difficulty !== difficulty) return false;
      if (!q) return true;
      return [s.title, s.payer, s.objective, s.category, s.packLabel]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    const map = new Map<string, { label: string; custom: boolean; items: ScenarioSummary[] }>();
    for (const s of filtered) {
      const entry = map.get(s.pack) ?? { label: s.packLabel, custom: s.custom, items: [] };
      entry.items.push(s);
      map.set(s.pack, entry);
    }
    return [...map.entries()];
  }, [all, query, difficulty]);

  const customCount = all.filter((s) => s.custom).length;
  const hasCustomSection = packs.some(([id]) => id === "custom");

  const launch = (id: string) => {
    setPlaygroundDefaults({ scenarioId: id });
    onNavigate("/simulate");
  };

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (s: ScenarioSummary) => {
    setEditing(s);
    setEditorOpen(true);
  };
  const onDelete = async (s: ScenarioSummary) => {
    if (!window.confirm(`Delete "${s.title}"? This can't be undone.`)) return;
    try {
      await remove.mutateAsync(s.id);
      toast.success("Scenario deleted", { description: s.title });
    } catch (e) {
      toast.error("Couldn't delete scenario", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Scenarios"
        actions={
          <>
            {data && (
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {all.length} scenarios · {packs.length || "0"} {packs.length === 1 ? "pack" : "packs"}
                {customCount > 0 && ` · ${customCount} custom`}
              </span>
            )}
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> New scenario
            </Button>
          </>
        }
      />

      {/* Toolbar: search + difficulty filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search scenarios, payers, objectives…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDifficulty((cur) => (cur === d ? null : d))}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
                difficulty === d
                  ? "border-transparent bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="h-44">
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="mt-auto h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : all.length === 0 ? null : packs.length === 0 ? (
        <EmptyState title="No scenarios match" description="Try a different search or clear the difficulty filter." />
      ) : (
        packs.map(([packId, pack]) => (
          <section key={packId} className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Layers className="h-4 w-4" />
              {pack.label}
              <StatusChip tone={PACK_TONE[packId] ?? "slate"}>{pack.items.length}</StatusChip>
            </div>
            <MotionStagger className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {pack.items.map((s) => (
                <ScenarioCard
                  key={s.id}
                  s={s}
                  onLaunch={() => launch(s.id)}
                  onEdit={() => openEdit(s)}
                  onDelete={() => onDelete(s)}
                />
              ))}
            </MotionStagger>
          </section>
        ))
      )}

      {/* Custom empty-state nudge when there are no custom scenarios yet. */}
      {!isLoading && !hasCustomSection && !query && !difficulty && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Create your own scenario</h3>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                Define the objective, the facts the counterparty knows, and the fields to capture. It runs on
                the same agent loop as the built-ins — in both Simulate and Live.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={openCreate}>
              <Plus className="h-4 w-4" /> New scenario
            </Button>
          </CardContent>
        </Card>
      )}

      <ScenarioEditor open={editorOpen} onOpenChange={setEditorOpen} editing={editing} />
    </div>
  );
}

function ScenarioCard({
  s,
  onLaunch,
  onEdit,
  onDelete,
}: {
  s: ScenarioSummary;
  onLaunch: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <MotionItem whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
      <Card className="group flex h-full flex-col">
        <CardContent className="flex flex-1 flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-foreground">{s.title}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{s.payer}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Badge variant="outline" className="capitalize">
                {s.category.replace(/-/g, " ")}
              </Badge>
              {s.custom && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={onEdit}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onDelete} className="text-red-600 focus:text-red-600 dark:text-red-400">
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
            <Target className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-3">{s.objective || "No objective set."}</span>
          </p>

          {s.requiredFields.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {s.requiredFields.slice(0, 4).map((f) => (
                <StatusChip key={f} tone="slate">
                  {f.replace(/_/g, " ")}
                </StatusChip>
              ))}
              {s.requiredFields.length > 4 && <StatusChip tone="slate">+{s.requiredFields.length - 4}</StatusChip>}
            </div>
          )}

          <div className="mt-auto flex items-center gap-2 pt-1">
            <Button variant="outline" size="sm" className="flex-1" onClick={onLaunch}>
              Launch in Studio
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Button>
            {s.custom && (
              <Button variant="ghost" size="sm" onClick={onEdit} title="Edit scenario">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </MotionItem>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="max-w-md text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
