import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createRelayKeyStore } from "./relay-key-store";

const store = createRelayKeyStore({read:name=>SecureStore.getItemAsync(name),write:(name,value)=>SecureStore.setItemAsync(name,value,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY}),randomBytes:length=>Crypto.getRandomBytes(length)});
export const relayPhoneKey = store.get;
export const resetRelayPhoneKey = store.reset;
