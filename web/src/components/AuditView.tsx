"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { AuditLedger } from "@/components/AuditLedger";

/** The hash-chained compliance ledger as its own page (split out of Logs). */
export function AuditView() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Audit" />
      <AuditLedger />
    </div>
  );
}
