import * as Crypto from "expo-crypto";
import { createAdminKey, type AdminKey } from "../logic/relay-admin";

// The browser is a development preview: the admin key lives only in this tab's memory.
let key: AdminKey | null = null;
export async function relayAdminKey(): Promise<AdminKey> {
  key ??= createAdminKey(Crypto.getRandomBytes(32));
  return key;
}
