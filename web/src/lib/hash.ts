/**
 * Hashing primitives.
 *   1. The audit ledger's tamper-evident chain uses REAL SHA-256 (digestHex /
 *      chainHash) — byte-identical to the backend's hashlib.sha256, so the chain
 *      verifies on both sides.
 *   2. cyrb53 + seeded floats are a fast, NON-cryptographic hash used only for
 *      deterministic analytics/benchmark demo data.
 */
import { sha256 } from "js-sha256";

/** cyrb53 — fast 53-bit string hash. Returns a non-negative integer. */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Real SHA-256 hex digest (64 chars). Matches the backend's hashlib.sha256. */
export function digestHex(input: string): string {
  return sha256(input);
}

/** Chain a new payload onto a previous hash, like a tamper-evident log. */
export function chainHash(prevHash: string, payload: string): string {
  return digestHex(`${prevHash}|${payload}`);
}

export const GENESIS_HASH = "0".repeat(64);

/** mulberry32 — small seeded PRNG for deterministic demo series. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic float in [min, max) seeded by an arbitrary string key. */
export function seededFloat(key: string, min: number, max: number): number {
  const r = cyrb53(key) / 4294967296 / 2097152; // normalise to ~[0,1)
  const unit = r - Math.floor(r);
  return min + unit * (max - min);
}
