import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceController} from '../src/controller.mjs';
test('copied official QR preserves the live link proof and never copies owner or invitation material',async()=>{
 const status={enabled:true,serverId:'server',pairing:{mode:'relay',available:true},relay:{mode:'relay',official:true,relay:'wss://fixture.example',computerId:'A'.repeat(22),state:'pending',revision:1}};
 const controller=createDeviceController({call:async method=>method==='status'?status:{v:2,relay:status.relay.relay,computerId:status.relay.computerId,computerKey:'A'.repeat(43),serverId:'server',code:'pairing-code',expiresAt:Date.now()+120000,pending:true,access:1,linkNonce:'A'.repeat(43),linkExpiresAt:Date.now()+300000,leaseId:'private-owner-lease',invite:'never-copy'}});
 try{await controller.refresh();await controller.autoPair();let copied='';await controller.copy({writeText:async value=>{copied=value;}});const qr=JSON.parse(copied);assert.equal(qr.access,1);assert.equal(qr.linkNonce,'A'.repeat(43));assert.ok(qr.linkExpiresAt>Date.now());assert.equal(qr.leaseId,undefined);assert.equal(qr.invite,undefined);}
 finally{controller.dispose();}
});
