// Official packages share one build key (from the release workflow, absent from the source), so
// the official app and plugin recognise each other: the plugin tags its pairing codes and relay
// registration, and the app proves itself when it claims a code. A package built without the key
// tags nothing and asks for nothing. The key ships inside the packages, so this keeps other
// builds apart; the relay's admin approval is what actually guards the server.
import {createHmac,timingSafeEqual} from 'node:crypto'
import {BUILD_KEY} from './official.mjs'
export const builtKey=()=>BUILD_KEY||null
export function buildTag(key,purpose,value){return createHmac('sha256',String(key)).update(`dabots-build-v1\n${purpose}\n${value}`).digest('base64url')}
export function sameTag(key,purpose,value,tag){
 if(typeof tag!=='string'||tag.length!==43)return false
 const expected=Buffer.from(buildTag(key,purpose,value)),given=Buffer.from(tag)
 return given.length===expected.length&&timingSafeEqual(given,expected)
}
