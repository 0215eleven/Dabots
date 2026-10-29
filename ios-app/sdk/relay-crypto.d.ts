export interface RelayContext {relay:string;computerId:string;serverId:string;streamId:string;epoch:string}
export interface RelayMessage {kind:string;[key:string]:unknown}
export type SecureRandom=(size:number)=>Uint8Array;
export interface RelayChannel {readonly confirmed:boolean;send(message:RelayMessage):Uint8Array;receive(record:Uint8Array):RelayMessage|Uint8Array|null;close():void}
export function createBoxKeyPair(randomBytes:SecureRandom):{publicKey:Uint8Array;secretKey:Uint8Array};
export function createPhoneHandshake(options:{computerKey:Uint8Array;context:RelayContext;randomBytes:SecureRandom}):RelayChannel & {offer:Uint8Array};
export function acceptPhoneHandshake(options:{offer:Uint8Array;computerSecret:Uint8Array;context:RelayContext;randomBytes:SecureRandom}):RelayChannel & {ready:Uint8Array};
