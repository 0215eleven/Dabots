import * as SecureStore from "expo-secure-store";
import type { Session, TokenStore } from "@ds-bot/mobile-sdk";
const key = "ds-bot.mobile.session";
const stores = new Map<string, TokenStore>();
/** Each paired computer keeps its own credentials; hosts paired before multi-host use the original key. */
export function tokenStoreFor(slot?: string): TokenStore {
  const name = slot ? `${key}.${slot}` : key;
  let store = stores.get(name);
  if (!store) {
    store = {
      async get() {
        const value = await SecureStore.getItemAsync(name);
        return value ? (JSON.parse(value) as Session) : null;
      },
      async set(value) {
        await SecureStore.setItemAsync(name, JSON.stringify(value), {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      },
      async clear() {
        await SecureStore.deleteItemAsync(name);
      },
    };
    stores.set(name, store);
  }
  return store;
}
export const tokenStore = tokenStoreFor();
