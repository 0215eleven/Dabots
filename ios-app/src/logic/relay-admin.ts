// The relay admin on this phone: an Ed25519 key that signs every request to the relay's admin API
// (plugin/tools/relay/approvals.mjs). The relay keeps only the public key, so nothing it stores
// can act as this phone.
import nacl from "tweetnacl";
import { sha256 } from "@noble/hashes/sha2.js";

export interface AdminKey { publicKey: string; secretKey: string }
export interface RelayDevice { computerId: string; name: string | null; firstSeenAt?: number; lastSeenAt?: number; approvedAt?: number }

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function base64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[n & 63];
  }
  return out;
}
function fromBase64url(text: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0, bits = 0;
  for (const char of text) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error("Invalid key.");
    buffer = (buffer << 6) | value; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255); }
  }
  return Uint8Array.from(bytes);
}
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");

/** A new admin key from 32 random bytes (the caller's secure random source). */
export function createAdminKey(seed: Uint8Array): AdminKey {
  if (seed.length !== 32) throw new Error("An admin key needs 32 random bytes.");
  const pair = nacl.sign.keyPair.fromSeed(seed);
  return { publicKey: base64url(pair.publicKey), secretKey: base64url(pair.secretKey) };
}

/** The exact text the relay verifies; it must match adminMessage in approvals.mjs. */
export function adminMessage(origin: string, method: string, path: string, time: number, body: string): string {
  return JSON.stringify(["dabots-relay-admin-v1", origin, method, path, String(time), hex(sha256(new TextEncoder().encode(body)))]);
}

export class RelayAdminError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}

/** Signed calls to one relay. `relay` is its wss:// origin. */
export function createRelayAdmin({ relay, key, fetch = globalThis.fetch, now = () => Date.now() }: { relay: string; key: AdminKey; fetch?: typeof globalThis.fetch; now?: () => number }) {
  const origin = new URL(relay).origin;
  const base = origin.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  const secret = fromBase64url(key.secretKey);
  async function call<T>(method: "GET" | "POST", path: string, body?: object): Promise<T> {
    const text = body ? JSON.stringify(body) : "", time = now();
    const signature = base64url(nacl.sign.detached(new TextEncoder().encode(adminMessage(origin, method, path, time, text)), secret));
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", "x-dabots-admin-key": key.publicKey, "x-dabots-admin-time": String(time), "x-dabots-admin-signature": signature },
      ...(text ? { body: text } : {}),
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new RelayAdminError(typeof value?.code === "string" ? value.code : "RELAY_ERROR", response.status);
    return value as T;
  }
  return {
    status: () => call<{ admin: boolean; claimable: boolean }>("GET", "/v1/admin/status"),
    claim: (code: string) => call<{ admin: true }>("POST", "/v1/admin/claim", { code: code.trim() }),
    devices: () => call<{ pending: RelayDevice[]; approved: RelayDevice[] }>("GET", "/v1/admin/devices"),
    approve: (computerId: string) => call("POST", "/v1/admin/approve", { computerId }),
    deny: (computerId: string) => call("POST", "/v1/admin/deny", { computerId }),
    revoke: (computerId: string) => call("POST", "/v1/admin/revoke", { computerId }),
  };
}
