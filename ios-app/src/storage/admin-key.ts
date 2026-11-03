import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createAdminKey, type AdminKey } from "../logic/relay-admin";

const NAME = "dabots.relay-admin-key";
/** This phone's relay admin key, created on first use and kept in the Keychain on this device only. */
export async function relayAdminKey(): Promise<AdminKey> {
  const saved = await SecureStore.getItemAsync(NAME);
  if (saved) return JSON.parse(saved) as AdminKey;
  const key = createAdminKey(Crypto.getRandomBytes(32));
  await SecureStore.setItemAsync(NAME, JSON.stringify(key), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  return key;
}
