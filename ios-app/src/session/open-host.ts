import { createMobileClient } from "../network/client";
import { cache, Host, tokenStoreFor } from "../storage";

/** Open a saved computer with its stored pairing; refuses a changed identity. */
export async function openHost(saved: Host) {
  const session = await tokenStoreFor(saved.slot).get();
  if (!session || session.serverId !== saved.serverId) throw new Error("This computer is no longer paired. Pair it again.");
  if (saved.tlsPin !== session.tlsPin) throw new Error("The computer identity has changed. Pair this device again.");
  return createMobileClient({
    baseUrl: saved.url,
    tlsPin: session.tlsPin,
    ...(saved.relay ? { relay: { ...saved.relay, serverId: saved.serverId } } : {}),
    tokenStore: tokenStoreFor(saved.slot),
    cache,
    allowInsecure: __DEV__ && saved.allowInsecure,
  });
}
