import { sha256 } from "@noble/hashes/sha2.js";
import { base64url, createPhoneKey, validatePhoneKey, type PhoneKey } from "../logic/relay-access.ts";
import { relayOrigin } from "../logic/pairing.ts";

/** Single-flight reads and serialized replacement prevent two screens creating different identities. */
export function createRelayKeyStore({read,write,randomBytes}: {read:(name:string)=>Promise<string|null>;write:(name:string,value:string)=>Promise<void>;randomBytes:(length:number)=>Uint8Array}) {
  const flights = new Map<string,Promise<PhoneKey>>();
  const nameFor = (relay:string) => "dabots.relay-phone-v1."+base64url(sha256(new TextEncoder().encode(relayOrigin(relay))));
  function start(name:string,work:()=>Promise<PhoneKey>) {
    const result = work(); flights.set(name,result);
    void result.finally(()=>{if(flights.get(name)===result) flights.delete(name);}).catch(()=>{});
    return result;
  }
  async function fresh(name:string) {
    const key = createPhoneKey(randomBytes(32));
    await write(name,JSON.stringify(key)); return key;
  }
  return {
    get(relay:string):Promise<PhoneKey> {
      const name = nameFor(relay);
      return flights.get(name) ?? start(name,async()=>{const saved = await read(name);return saved ? validatePhoneKey(JSON.parse(saved)) : fresh(name);});
    },
    // Only a user-confirmed recovery action calls reset. Revocation never triggers it automatically.
    reset(relay:string):Promise<PhoneKey> {
      const name = nameFor(relay), previous = flights.get(name);
      return start(name,async()=>{await previous?.catch(()=>{}); return fresh(name);});
    },
  };
}
