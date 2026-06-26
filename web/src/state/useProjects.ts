"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Projects are a local, persisted organizational layer over the sandbox — the
 * console-style "Default project" switcher at the top of the sidebar. Creation
 * and switching are fully functional and survive reloads (localStorage). Data
 * is not yet scoped server-side; the active project is a client-side context.
 */
export interface Project {
  id: string;
  name: string;
  createdAt: number;
}

const DEFAULT_PROJECT: Project = {
  id: "default",
  name: "Default project",
  createdAt: 0,
};

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `proj_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

interface ProjectsState {
  projects: Project[];
  activeId: string;
  /** Create a project and make it active. Returns the new id. */
  addProject: (name: string) => string;
  setActive: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;

  // Ephemeral: drives the "New project" dialog (not persisted).
  projectDialogOpen: boolean;
  setProjectDialogOpen: (open: boolean) => void;

  activeProject: () => Project;
}

export const useProjects = create<ProjectsState>()(
  persist(
    (set, get) => ({
      projects: [DEFAULT_PROJECT],
      activeId: DEFAULT_PROJECT.id,

      addProject: (name) => {
        const id = newId();
        const project: Project = { id, name: name.trim() || "Untitled project", createdAt: Date.now() };
        set((s) => ({ projects: [...s.projects, project], activeId: id }));
        return id;
      },
      setActive: (id) => set({ activeId: id }),
      renameProject: (id, name) =>
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p)),
        })),
      deleteProject: (id) =>
        set((s) => {
          if (id === DEFAULT_PROJECT.id || s.projects.length <= 1) return s;
          const projects = s.projects.filter((p) => p.id !== id);
          const activeId = s.activeId === id ? projects[0]?.id ?? DEFAULT_PROJECT.id : s.activeId;
          return { projects, activeId };
        }),

      projectDialogOpen: false,
      setProjectDialogOpen: (open) => set({ projectDialogOpen: open }),

      activeProject: () => {
        const { projects, activeId } = get();
        return projects.find((p) => p.id === activeId) ?? projects[0] ?? DEFAULT_PROJECT;
      },
    }),
    {
      name: "voiceops-projects",
      // Persist only the data, never the transient dialog flag.
      partialize: (s) => ({ projects: s.projects, activeId: s.activeId }),
    },
  ),
);
