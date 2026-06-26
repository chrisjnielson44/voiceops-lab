"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, FolderPlus, Plus, Box } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/state/useProjects";
import { cn } from "@/lib/cn";

export function ProjectSwitcher() {
  const projects = useProjects((s) => s.projects);
  const activeId = useProjects((s) => s.activeId);
  const setActive = useProjects((s) => s.setActive);
  const dialogOpen = useProjects((s) => s.projectDialogOpen);
  const setDialogOpen = useProjects((s) => s.setProjectDialogOpen);

  const active = projects.find((p) => p.id === activeId) ?? projects[0];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Switch project"
            className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-background/60 px-2.5 text-sm transition-colors hover:bg-accent group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:hover:bg-accent"
          >
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
              <Box className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate text-left font-medium text-foreground group-data-[collapsible=icon]:hidden">
              {active?.name ?? "Project"}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[15rem]">
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Projects
          </DropdownMenuLabel>
          {projects.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => setActive(p.id)} className="gap-2">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
                <Box className="h-3 w-3" />
              </span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.id === activeId && <Check className="h-4 w-4 shrink-0 text-foreground" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
            <FolderPlus className="h-4 w-4" />
            New project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const addProject = useProjects((s) => s.addProject);
  const [name, setName] = useState("");
  const trimmed = name.trim();

  const create = () => {
    if (!trimmed) return;
    addProject(trimmed);
    setName("");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setName("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> New project
          </DialogTitle>
          <DialogDescription>
            Group your sessions, scenarios, and runs under a named project.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="project-name">Project name</Label>
          <Input
            id="project-name"
            autoFocus
            value={name}
            placeholder="e.g. Q3 Payer Pilot"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!trimmed} className={cn(!trimmed && "opacity-60")}>
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
