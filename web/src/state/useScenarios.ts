import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * The scenario catalog served by GET /api/scenarios — built-in domain packs
 * plus user-authored custom scenarios. Each entry advertises its owning pack and
 * a `custom` flag (custom scenarios are editable/deletable; built-ins are not).
 */
export interface ScenarioSummary {
  id: string;
  title: string;
  payer: string;
  payerId: string;
  category: string;
  difficulty: string;
  outcome: string;
  objective: string;
  requiredFields: string[];
  pack: string;
  packLabel: string;
  custom: boolean;
  facts?: string | null;
  patient?: { name: string; memberId: string; dob: string };
  provider?: { name: string; npi: string; taxId: string };
}

/** Editor payload — mirrors the backend CustomScenarioInput. */
export interface CustomScenarioInput {
  title: string;
  payer: string;
  category: string;
  difficulty: string;
  outcome: string;
  objective: string;
  subjectName: string;
  subjectId: string;
  callerName: string;
  requiredFields: string[];
  facts: string;
}

async function jsonOrThrow(r: Response) {
  if (!r.ok) {
    const detail = await r.json().catch(() => null);
    throw new Error(detail?.detail || `request failed (${r.status})`);
  }
  return r.status === 204 ? null : r.json();
}

export function useScenarioCatalog() {
  return useQuery({
    queryKey: ["scenarios"],
    queryFn: async () => {
      const r = await fetch("/api/scenarios");
      if (!r.ok) throw new Error(`scenarios ${r.status}`);
      return (await r.json()) as { scenarios: ScenarioSummary[] };
    },
  });
}

/** Create / update / delete a custom scenario, invalidating every consumer
 * (the catalog, the Studio/PreConfig options, and any open scenario detail). */
export function useScenarioMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["scenarios"] });
    qc.invalidateQueries({ queryKey: ["voice-options"] });
    qc.invalidateQueries({ queryKey: ["scenario"] });
  };

  const create = useMutation({
    mutationFn: async (input: CustomScenarioInput) =>
      jsonOrThrow(
        await fetch("/api/scenarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      ) as Promise<ScenarioSummary>,
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: CustomScenarioInput }) =>
      jsonOrThrow(
        await fetch(`/api/scenarios/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }),
      ) as Promise<ScenarioSummary>,
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => jsonOrThrow(await fetch(`/api/scenarios/${id}`, { method: "DELETE" })),
    onSuccess: invalidate,
  });

  return { create, update, remove };
}
