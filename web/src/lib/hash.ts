/**
 * Deterministic, dependency-free hashing used for two things:
 *   1. The audit ledger's tamper-evident hash chain (demo stand-in for SHA-256).
 *   2. Seeded pseudo-random values for analytics/benchmark demo data.
 *
 * NOTE: cyrb53 is NOT cryptographically secure. In production the audit chain
 * would use crypto.subtle.digest('SHA-256', ...). It is used here purely so the
 * demo can show a stable, chained, "immutable-looking" ledger with no deps.
 */

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

function block(str: string, seed: number): string {
  return cyrb53(str, seed).toString(16).padStart(14, "0").slice(0, 16);
}

/** Produce a 64-hex-char digest (SHA-256 shape) deterministically. */
export function digestHex(input: string): string {
  return (
    block(input, 1) +
    block(input, 2) +
    block(input, 3) +
    block(input, 4)
  ).slice(0, 64);
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
