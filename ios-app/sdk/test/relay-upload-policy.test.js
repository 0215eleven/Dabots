import test from 'node:test';
import assert from 'node:assert/strict';
import {limitRelayUploads} from '../relay-transport.js';
import {validateRelayRequest} from '../relay-rpc.js';
test('old or unrecognized relays never advertise 100 MB despite a new desktop plugin',()=>{
 const info={capabilities:{attachments:true,uploadTransfers:1,transferLimits:{maxBytes:100000000},uploadLimits:{maxBytes:2097152}}};
 for(const policy of [undefined,{}, {uploadTransfers:1,maxUploadBytes:2097152}]){
  const result=limitRelayUploads(info,policy);assert.equal(result.capabilities.uploadTransfers,false);assert.equal(result.capabilities.transferLimits,null);assert.equal(info.capabilities.uploadTransfers,1);
 }
 assert.equal(limitRelayUploads(info,{uploadTransfers:1,maxUploadBytes:100000000}).capabilities.uploadTransfers,1);
});
test('bounded upload-transfer routes preserve the RPC destination allowlist',()=>{
 for(const [method,path] of [['POST','/mobile/v1/upload-transfers'],['PUT','/mobile/v1/upload-transfers/receipt?offset=262144'],['POST','/mobile/v1/upload-transfers/receipt/complete'],['DELETE','/mobile/v1/upload-transfers/receipt']])assert.equal(validateRelayRequest({method,path}).method,method);
 assert.throws(()=>validateRelayRequest({method:'PUT',path:'/mobile/v1/upload-transfers/receipt?url=https://other'}));
});
