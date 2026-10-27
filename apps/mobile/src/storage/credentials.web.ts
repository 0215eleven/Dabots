import { MemoryTokenStore } from "@ds-bot/mobile-sdk";
// The browser is a development preview; device credentials live only in this tab's memory.
const stores = new Map<string, MemoryTokenStore>();
export function tokenStoreFor(slot?: string) {
  const name = slot || "";
  let store = stores.get(name);
  if (!store) stores.set(name, store = new MemoryTokenStore());
  return store;
}
export const tokenStore = tokenStoreFor();
