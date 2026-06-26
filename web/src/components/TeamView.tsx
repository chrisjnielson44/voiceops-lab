"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, ShieldCheck, Trash2, Users } from "lucide-react";

import { admin, organization, useSession } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

/* ----------------------------- types & helpers ---------------------------- */

interface AdminUser {
  id: string;
  name?: string | null;
  email: string;
  role?: string | null;
  banned?: boolean | null;
}
interface Org {
  id: string;
  name: string;
  slug: string;
}
interface Team {
  id: string;
  name: string;
  organizationId: string;
}
interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
}

const UNASSIGNED = "__none__";

// Same resolution the auth client uses, for the custom provision endpoint.
const AUTH_BASE = import.meta.env.VITE_AUTH_BASE_URL || "/api/auth";

/** Better Auth client calls resolve to `{ data, error }`; throw so react-query handles it. */
async function call<T>(p: Promise<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error((error as { message?: string }).message || "Request failed");
  return data as T;
}

/* --------------------------------- view ----------------------------------- */

export function TeamView() {
  const { data: session, isPending } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === "admin";

  if (isPending) {
    return (
      <div className="max-w-5xl space-y-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-5xl">
        <h1 className="text-2xl font-semibold text-foreground">Team</h1>
        <div className="mt-8 flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">Admins only</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            This page manages members and teams. Ask an administrator if you need access.
          </p>
        </div>
      </div>
    );
  }

  return <TeamAdmin />;
}

function TeamAdmin() {
  const qc = useQueryClient();

  // Workspace org (single, seeded "VoiceAdmin").
  const orgsQ = useQuery({
    queryKey: ["orgs"],
    queryFn: () => call<Org[]>(organization.list()),
  });
  const org = orgsQ.data?.[0];
  const orgId = org?.id;

  const fullOrgQ = useQuery({
    queryKey: ["org-full", orgId],
    enabled: !!orgId,
    queryFn: () =>
      call<{ teams?: Team[] }>(
        organization.getFullOrganization({ query: { organizationId: orgId! } }),
      ),
  });
  const teams: Team[] = fullOrgQ.data?.teams ?? [];

  const usersQ = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const data = await call<{ users: AdminUser[] }>(
        admin.listUsers({ query: { limit: 500, sortBy: "createdAt", sortDirection: "desc" } }),
      );
      return data.users;
    },
  });
  const users = usersQ.data ?? [];

  // userId -> [teamId] map, built from each team's membership.
  const teamMembersQ = useQuery({
    queryKey: ["team-members", orgId, teams.map((t) => t.id).join(",")],
    enabled: teams.length > 0,
    queryFn: async () => {
      const map: Record<string, string[]> = {};
      await Promise.all(
        teams.map(async (t) => {
          try {
            const members = await call<TeamMember[]>(
              organization.listTeamMembers({ query: { teamId: t.id } }),
            );
            for (const m of members) (map[m.userId] ??= []).push(t.id);
          } catch {
            /* a team with no members can 4xx in some versions — ignore */
          }
        }),
      );
      return map;
    },
  });
  const teamsByUser = teamMembersQ.data ?? {};

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin-users"] });
    void qc.invalidateQueries({ queryKey: ["org-full", orgId] });
    void qc.invalidateQueries({ queryKey: ["team-members"] });
  };

  /* ------------------------------ mutations ------------------------------- */

  const setRole = useMutation({
    mutationFn: (v: { userId: string; role: string }) =>
      call(admin.setRole({ userId: v.userId, role: v.role as "admin" | "user" })),
    onSuccess: () => {
      toast.success("Role updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeUser = useMutation({
    mutationFn: (userId: string) => call(admin.removeUser({ userId })),
    onSuccess: () => {
      toast.success("User removed");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignTeam = useMutation({
    mutationFn: async (v: { userId: string; teamId: string; current: string[] }) => {
      // Move semantics: drop other team memberships, then add the target.
      await Promise.all(
        v.current
          .filter((tid) => tid !== v.teamId)
          .map((tid) =>
            call(organization.removeTeamMember({ teamId: tid, userId: v.userId })).catch(() => {}),
          ),
      );
      if (v.teamId !== UNASSIGNED && !v.current.includes(v.teamId)) {
        await call(organization.addTeamMember({ teamId: v.teamId, userId: v.userId }));
      }
    },
    onSuccess: () => {
      toast.success("Team updated");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loading = orgsQ.isLoading || usersQ.isLoading;

  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Team</h1>
        <div className="flex items-center gap-2">
          {org && <CreateTeamDialog orgId={org.id} onDone={invalidate} />}
          {orgId && <CreateUserDialog teams={teams} onDone={invalidate} />}
        </div>
      </div>

      {!orgsQ.isLoading && !org && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          No workspace found. Run <code className="rounded bg-muted px-1">npm run seed:admin</code> in
          <code className="rounded bg-muted px-1">auth-server/</code> to create the VoiceAdmin organization and team.
        </div>
      )}

      {/* Teams */}
      <section>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
          <Users className="h-4 w-4 text-muted-foreground" /> Teams
        </div>
        {fullOrgQ.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : teams.length === 0 ? (
          <p className="rounded-xl border border-border px-4 py-6 text-sm text-muted-foreground">
            No teams yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {teams.map((t) => {
              const count = Object.values(teamsByUser).filter((ids) => ids.includes(t.id)).length;
              return (
                <Badge key={t.id} variant="secondary" className="gap-1.5 px-3 py-1.5 text-sm">
                  {t.name}
                  <span className="text-muted-foreground">· {count}</span>
                </Badge>
              );
            })}
          </div>
        )}
      </section>

      {/* Members */}
      <section>
        <div className="mb-3 text-sm font-medium text-foreground">Members</div>
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead className="w-[8rem]">Role</TableHead>
                <TableHead className="w-[12rem]">Team</TableHead>
                <TableHead className="w-[3rem]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    No users yet.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => {
                  const current = teamsByUser[u.id] ?? [];
                  const teamValue = current[0] ?? UNASSIGNED;
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="font-medium text-foreground">{u.name || u.email.split("@")[0]}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={u.role === "admin" ? "admin" : "user"}
                          onValueChange={(role) => setRole.mutate({ userId: u.id, role })}
                        >
                          <SelectTrigger className="h-8 w-[7rem]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">Member</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={teamValue}
                          disabled={teams.length === 0 || assignTeam.isPending}
                          onValueChange={(teamId) =>
                            assignTeam.mutate({ userId: u.id, teamId, current })
                          }
                        >
                          <SelectTrigger className="h-8 w-[11rem]">
                            <SelectValue placeholder="No team" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNASSIGNED}>No team</SelectItem>
                            {teams.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          title="Remove user"
                          onClick={() => {
                            if (confirm(`Remove ${u.email}? This deletes their account.`))
                              removeUser.mutate(u.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------- dialogs ---------------------------------- */

function CreateTeamDialog({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const m = useMutation({
    mutationFn: () => call(organization.createTeam({ name: name.trim(), organizationId: orgId })),
    onSuccess: () => {
      toast.success("Team created");
      setName("");
      setOpen(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> New team
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
          <DialogDescription>Teams group members within the workspace.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="team-name">Team name</Label>
          <Input
            id="team-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VoiceAdmin"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button onClick={() => m.mutate()} disabled={!name.trim() || m.isPending}>
            {m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateUserDialog({ teams, onDone }: { teams: Team[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [teamId, setTeamId] = useState<string>(UNASSIGNED);

  const reset = () => {
    setName("");
    setEmail("");
    setPassword("");
    setRole("user");
    setTeamId(UNASSIGNED);
  };

  const m = useMutation({
    mutationFn: async () => {
      // Org `addMember` is a server-only Better Auth endpoint, so account
      // creation + workspace/team membership happens in the admin-gated
      // /api/auth/provision-user route (see auth-server/server.mjs).
      const res = await fetch(`${AUTH_BASE}/provision-user`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          name: name.trim() || email.split("@")[0],
          role,
          teamId: teamId === UNASSIGNED ? undefined : teamId,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Request failed (${res.status})`);
      }
    },
    onSuccess: () => {
      toast.success("User created");
      reset();
      setOpen(false);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = email.trim() && password.length >= 8 && !m.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> New user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>
            Public sign-up is disabled — provision accounts here. Share the password securely.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nu-name">Name</Label>
            <Input id="nu-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Lee" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nu-email">Email</Label>
            <Input
              id="nu-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jordan@clinic.org"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nu-password">Temporary password</Label>
            <Input
              id="nu-password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Team</Label>
              <Select value={teamId} onValueChange={setTeamId} disabled={teams.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder="No team" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>No team</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => m.mutate()} disabled={!canSubmit}>
            {m.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
