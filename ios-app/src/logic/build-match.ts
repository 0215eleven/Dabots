// The official app and plugin share one build key (DABOTS_BUILD_KEY in the release workflow, absent
// from the source). With it, this app pairs only with codes the official plugin tagged, and proves
// itself to that plugin when it claims a code (plugin/bridge/src/build-tag.mjs). A build without the
// key checks nothing. The key ships inside the packages: this keeps other builds apart, while the
// relay's admin approval is what guards the server.
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64url } from "./relay-admin.ts";

export const builtKey = (): string | null => process.env.EXPO_PUBLIC_DABOTS_BUILD_KEY || null;

export function buildTag(key: string, purpose: "plugin" | "app" | "relay", value: string): string {
  const encode = (text: string) => new TextEncoder().encode(text);
  return base64url(hmac(sha256, encode(key), encode(`dabots-build-v1\n${purpose}\n${value}`)));
}

export class BuildMismatchError extends Error {}

/** Refuses a code that the matching plugin did not make; returns the proof to send with the claim. */
export function matchPairing(pairing: { serverId: string; code: string; build?: string }, key = builtKey()): string | undefined {
  if (!key) return undefined;
  if (pairing.build !== buildTag(key, "plugin", pairing.serverId)) throw new BuildMismatchError("This code is not from the official Dabots plugin. Install the official plugin on your computer.");
  return buildTag(key, "app", pairing.code);
}
