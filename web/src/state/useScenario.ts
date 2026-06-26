import { useQuery } from "@tanstack/react-query";

/**
 * The real scenario record, served by GET /api/scenarios/{id} (backed by the
 * pack registry + seeded Neon members/coverage/claims/prior_auths). This is the
 * single source of truth for scenario metadata + member/provider/claim context
 * in the UI — there is no client-side scenario catalog.
 *
 * NOTE: the API also returns scripted `turns`; we intentionally never render
 * them. The live transcript comes from the SSE call store (useCallStore.feed).
 */
export interface ScenarioDetail {
  id: string;
  title: string;
  payer: string;
  payerId: string;
  category: string;
  objective: string;
  requiredFields: string[];
  patient: { name: string; memberId: string; dob: string };
  provider: { name: string; npi: string; taxId: string };
  claim?: { id: string; dos: string; cpt: string; amount: number } | null;
}

export function useScenario(scenarioId: string | undefined) {
  return useQuery({
    queryKey: ["scenario", scenarioId],
    enabled: !!scenarioId,
    queryFn: async () => {
      const r = await fetch(`/api/scenarios/${scenarioId}`);
      if (!r.ok) throw new Error(`scenario ${r.status}`);
      return (await r.json()) as ScenarioDetail;
    },
  });
}
