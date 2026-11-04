import nacl from "tweetnacl";
import { sha256 } from "@noble/hashes/sha2.js";
import { relayOrigin } from "./pairing.ts";

export interface PhoneKey { publicKey: string; secretKey: string }
export interface PhoneChallenge { relay: string; nonce: string; computerId: string; computerKey: string; serverId: string }
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function base64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += alphabet[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += alphabet[n & 63];
  }
  return out;
}
function decode(text: string, length: number): Uint8Array {
  if (typeof text !== "string") throw new Error("Invalid phone identity.");
  let buffer = 0, bits = 0;
  const bytes: number[] = [];
  for (const char of text) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error("Invalid phone identity.");
    buffer = (buffer << 6) | value; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255); }
  }
  const value = Uint8Array.from(bytes);
  if (value.length !== length || base64url(value) !== text) throw new Error("Invalid phone identity.");
  return value;
}
export function createPhoneKey(seed: Uint8Array): PhoneKey {
  if (seed.length !== 32) throw new Error("A phone identity needs 32 random bytes.");
  const pair = nacl.sign.keyPair.fromSeed(seed);
  return { publicKey: base64url(pair.publicKey), secretKey: base64url(pair.secretKey) };
}
export function validatePhoneKey(key: PhoneKey): PhoneKey {
  const secret = decode(key.secretKey, 64), expected = createPhoneKey(secret.slice(0, 32));
  if (key.publicKey !== expected.publicKey || key.secretKey !== expected.secretKey) throw new Error("Invalid phone identity.");
  return key;
}
const encode = (text: string) => new TextEncoder().encode(text);
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
export function signPhoneConnection(challenge: PhoneChallenge, key: PhoneKey): {type:"authenticate";key:string;signature:string} {
  const origin = relayOrigin(challenge.relay);
  decode(challenge.nonce,32); decode(challenge.computerId,16); decode(challenge.computerKey,32);
  if (!challenge.serverId) throw new Error("Invalid computer identity.");
  const message = JSON.stringify(["dabots-phone-connect-v1", origin, challenge.nonce, challenge.computerId, challenge.computerKey, challenge.serverId]);
  return { type: "authenticate", key: key.publicKey, signature: base64url(nacl.sign.detached(encode(message),decode(validatePhoneKey(key).secretKey,64))) };
}
export class RelayAccessError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(code === "PHONE_REVOKED" || code === "REVOKED" ? "This phone's invitation access was revoked. Reset its phone identity and use a new invitation." : "The official connection refused this request. Check your invitation or scan a fresh computer code and retry.");
    this.code = code; this.status = status;
  }
}
/** Each request proves possession of this relay's device identity; invitations are never retained. */
export function createRelayAccess({relay,key,fetch = globalThis.fetch,now = () => Date.now(),randomBytes}: {
  relay: string; key: PhoneKey; fetch?: typeof globalThis.fetch; now?: () => number; randomBytes: (length:number) => Uint8Array;
}) {
  const origin = relayOrigin(relay), base = origin.replace(/^wss:/,"https:");
  const secret = decode(validatePhoneKey(key).secretKey,64);
  async function call<T>(method:"GET"|"POST",path:string,body?:object):Promise<T> {
    const raw = body ? JSON.stringify(body) : "", time = String(now()), nonce = base64url(randomBytes(16));
    if (!/^\d{13}$/.test(time)) throw new Error("Check this phone's clock and retry.");
    decode(nonce,16);
    const message = JSON.stringify(["dabots-phone-request-v1",origin,method,path,time,nonce,hex(sha256(encode(raw)))]);
    const response = await fetch(base+path,{method,redirect:"error",headers:{"content-type":"application/json","x-dabots-phone-key":key.publicKey,"x-dabots-time":time,"x-dabots-nonce":nonce,"x-dabots-signature":base64url(nacl.sign.detached(encode(message),secret))},...(raw ? {body:raw} : {})});
    const value = await response.json().catch(()=>({}));
    if (!response.ok) throw new RelayAccessError(typeof value?.code === "string" ? value.code : "RELAY_ERROR",response.status);
    return value as T;
  }
  return {
    status: async () => { const value = await call<{protocol:1;enrolled:boolean}>("GET","/v1/access/status"); if (value.protocol !== 1 || typeof value.enrolled !== "boolean") throw new RelayAccessError("UPGRADE_REQUIRED",409); return value; },
    redeem: async (code:string) => { const value = await call<{enrolled:true;phoneId:string}>("POST","/v1/access/redeem",{code:code.trim()}); if (value.enrolled !== true || !value.phoneId) throw new RelayAccessError("INVALID_RESPONSE",502); return value; },
    associate: async (computer:{computerId:string;computerKey:string;serverId:string;linkNonce:string}) => {
      decode(computer.computerId,16); decode(computer.computerKey,32); decode(computer.linkNonce,32);
      if (!computer.serverId) throw new Error("Invalid computer identity.");
      const value = await call<{associated:true}>("POST","/v1/access/associate",{computerId:computer.computerId,computerKey:computer.computerKey,serverId:computer.serverId,linkNonce:computer.linkNonce});
      if(value.associated !== true) throw new RelayAccessError("INVALID_RESPONSE",502);
      return value;
    },
  };
}
