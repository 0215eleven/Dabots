import * as Crypto from "expo-crypto";
import { createRelayKeyStore } from "./relay-key-store";
// Browser preview identities stay in this tab's memory, never localStorage or synced storage.
const keys = new Map<string,string>();
const store = createRelayKeyStore({read:async name=>keys.get(name)??null,write:async(name,value)=>{keys.set(name,value);},randomBytes:length=>Crypto.getRandomBytes(length)});
export const relayPhoneKey = store.get;
export const resetRelayPhoneKey = store.reset;
