import { officialRelay } from "./hosts.ts";
// The two pairing codes a computer shows: its direct address, or (v: 2) the
// owner's relay plus the computer's relay identity.
export interface RelayAddress { relay: string; computerId: string; computerKey: string }
export type Pairing =
  | { kind: "direct"; url: string; code: string; serverId: string; tlsPin?: string; build?: string }
  | ({ kind: "relay"; code: string; serverId: string; build?: string; pending?: boolean; access?:1; linkNonce?:string; linkExpiresAt?:number } & RelayAddress);

export class PairingFormatError extends Error {}

export function relayOrigin(value: unknown) {
  if (typeof value !== "string" || value.length > 2048 || !/^wss:\/\/[^/?#@\s\\]+\/?$/i.test(value)) throw new PairingFormatError("This relay address is not valid. Generate a new code on your computer.");
  return new URL(value).origin;
}

export function parsePairing(input: string): Pairing {
  let data: Record<string, unknown>;
  try { data = JSON.parse(input.trim()); } catch { throw new PairingFormatError("This is not valid pairing JSON. Copy the complete code shown on your host."); }
  if (!data || typeof data !== "object") throw new PairingFormatError("This is not valid pairing JSON. Copy the complete code shown on your host.");
  const text = (key: string) => (typeof data[key] === "string" && data[key] ? data[key] as string : "");
  if (!text("code") || !text("serverId")) throw new PairingFormatError("Paste the complete pairing JSON from your host and enter a device name.");
  // Legacy tags are inert metadata; admission uses the invited phone identity.
  const build = text("build") ? { build: text("build") } : {};
  if (data.v === 2) {
    const origin = relayOrigin(data.relay), official = officialRelay();
    const required = !!official && origin === relayOrigin(official);
    if (required && data.access !== 1) throw new PairingFormatError("Upgrade the computer plugin and generate a new code for the official connection.");
    if (data.access !== undefined || data.linkNonce !== undefined || data.linkExpiresAt !== undefined) {
      if (data.access !== 1 || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(text("linkNonce")) || typeof data.linkExpiresAt !== "number" || !Number.isSafeInteger(data.linkExpiresAt) || data.linkExpiresAt <= Date.now())
        throw new PairingFormatError("This computer code has expired or is invalid. Generate a new code on your computer.");
    }
    if (!/^[A-Za-z0-9_-]{22}$/.test(text("computerId")) || !/^[A-Za-z0-9_-]{43}$/.test(text("computerKey")))
      throw new PairingFormatError("This pairing code has an invalid computer identity.");
    return { kind: "relay", relay: origin, computerId: text("computerId"), computerKey: text("computerKey"), code: text("code"), serverId: text("serverId"), ...build, ...(data.pending === true ? { pending: true } : {}), ...(data.access === 1 ? {access:1 as const,linkNonce:text("linkNonce"),linkExpiresAt:data.linkExpiresAt as number} : {}) };
  }
  if (!text("url")) throw new PairingFormatError("Paste the complete pairing JSON from your host and enter a device name.");
  return { kind: "direct", url: text("url"), code: text("code"), serverId: text("serverId"), ...(text("tlsPin") ? { tlsPin: text("tlsPin") } : {}), ...build };
}
