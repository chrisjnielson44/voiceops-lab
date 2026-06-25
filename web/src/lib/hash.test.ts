import { describe, it, expect } from "vitest";
import { digestHex, chainHash, GENESIS_HASH } from "@/lib/hash";
import { auditCanonical, verifyLedger } from "@/lib/audit/ledger";
import type { AuditEvent } from "@/lib/audit/types";

describe("sha256 audit hashing", () => {
  it("digestHex is real SHA-256 (matches the backend vector)", () => {
    // Canonical SHA-256("abc") — the backend (hashlib) asserts the same value,
    // which is what makes the cross-language audit chain verifiable.
    expect(digestHex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(digestHex("anything")).toHaveLength(64);
  });

  it("chainHash composes prev|payload", () => {
    const payload = "0|call.start|0|operator|hi||0||none|model|v1";
    expect(chainHash(GENESIS_HASH, payload)).toBe(digestHex(`${GENESIS_HASH}|${payload}`));
  });

  it("verifyLedger accepts a valid chain and rejects tampering", () => {
    const drafts = [
      { seq: 0, type: "call.session.open", atMs: 0, actor: "operator", summary: "open", phi: false, redaction: "none" },
      { seq: 1, type: "model.invoke", atMs: 100, actor: "agent", summary: "turn", phi: false, redaction: "none" },
    ];
    let prev = GENESIS_HASH;
    const events: AuditEvent[] = drafts.map((d, i) => {
      const hash = chainHash(prev, auditCanonical(d as never));
      const e = { ...d, id: `evt-${i}`, clock: "00:00:00", hash, prevHash: prev } as AuditEvent;
      prev = hash;
      return e;
    });
    expect(verifyLedger(events)).toBe(true);

    events[1].summary = "tampered";
    expect(verifyLedger(events)).toBe(false);
  });
});
