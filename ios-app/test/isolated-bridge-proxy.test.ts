import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {createRequire} from 'node:module';
const {startProxy}=createRequire(import.meta.url)('./browser/isolated-bridge-proxy.cjs');
const origin='http://127.0.0.1:8093';
async function fixture(t:any) {
  const seen:string[]=[]; const sockets=new Set<any>(); let postStatus=201;
  const upstream=http.createServer((req,res)=>{
    seen.push(`${req.method} ${req.url}`);req.resume();
    const status=req.method==='GET'&&req.url?.endsWith('/missing')?404:req.method==='POST'?postStatus:200;
    res.writeHead(status,{'content-type':'application/json'}).end(JSON.stringify({requestId:'stable',status:'accepted'}));
  });
  upstream.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  upstream.on('upgrade',(req,socket)=>{seen.push(`WS ${req.url}`);socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');});
  await new Promise<void>(done=>upstream.listen(0,'127.0.0.1',done));
  const address=upstream.address() as net.AddressInfo;
  const proxy=await startProxy(`http://127.0.0.1:${address.port}`,origin);
  t.after(async()=>{await proxy.close();for(const s of sockets)s.destroy();await new Promise<void>(done=>upstream.close(()=>done()));});
  function request(path:string,method='GET',requestOrigin=origin) {
    return new Promise<number>((resolve,reject)=>{
      const req=http.request(proxy.url,{path,method,headers:{origin:requestOrigin,'content-type':'application/json'}},res=>{res.on('error',reject);res.resume();res.on('end',()=>resolve(res.statusCode!));});
      req.on('error',reject);req.end(method==='POST'?JSON.stringify({requestId:'stable',text:'synthetic'}):undefined);
    });
  }
  async function upgrade(path:string,requestOrigin=origin) {
    return new Promise<string>((resolve,reject)=>{
      const socket=net.connect(new URL(proxy.url).port as any,'127.0.0.1');let result='';
      socket.setTimeout(2000,()=>socket.destroy(Error('upgrade timeout')));
      socket.on('connect',()=>socket.write(`GET ${path} HTTP/1.1\r\nHost: ${new URL(proxy.url).host}\r\nOrigin: ${requestOrigin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`));
      socket.on('data',chunk=>{result+=chunk.toString();socket.destroy();});socket.on('close',()=>resolve(result));socket.on('error',reject);
    });
  }
  return {proxy,seen,request,upgrade,setPostStatus:(status:number)=>{postStatus=status}};
}
test('lost acknowledgement targets only the exact successful submission POST, preserving receipt lookups and failures',async t=>{
  const f=await fixture(t);f.proxy.controls.loseNext='/mobile/v1/submissions';
  assert.equal(await f.request('/mobile/v1/submissions/missing'),404);
  assert.equal(await f.request('/mobile/v1/submissions/stable'),200);
  assert.equal(await f.request('/mobile/v1/actions','POST'),201);
  assert.equal(await f.request('/mobile/v1/submissions/extra','POST'),201);
  f.setPostStatus(503);assert.equal(await f.request('/mobile/v1/submissions','POST'),503);
  assert.equal(f.proxy.controls.dropped,0);
  f.setPostStatus(201);await assert.rejects(f.request('/mobile/v1/submissions','POST'),{code:'ECONNRESET'});
  assert.deepEqual(f.proxy.controls.drops,[{method:'POST',path:'/mobile/v1/submissions',requestId:'stable',status:201}]);
  assert.equal(f.proxy.controls.dropped,1);assert.equal(f.proxy.controls.loseNext,null);
  assert.equal(await f.request('/mobile/v1/submissions/stable'),200);
  assert.equal(await f.request('/mobile/v1/submissions','POST'),201);
});
test('HTTP proxy rejects plain and encoded traversal before upstream forwarding',async t=>{
  const f=await fixture(t);
  for(const path of ['/mobile/v1/../../outside','/mobile/v1/%2e%2e/%2E%2E/outside','/mobile/v1/.%2e/%2e./outside','//other.invalid/mobile/v1/state'])assert.equal(await f.request(path),403,path);
  assert.deepEqual(f.seen,[]);assert.equal(await f.request('/mobile/v1/state'),200);assert.deepEqual(f.seen,['GET /mobile/v1/state']);
  assert.equal(await f.request('/mobile/v1/state','GET','http://other.invalid'),403);
});
test('WebSocket proxy rejects traversal and foreign origins, while forwarding a valid API upgrade',async t=>{
  const f=await fixture(t);
  for(const path of ['/mobile/v1/../../outside','/mobile/v1/%2e%2e/%2e%2e/outside'])assert.equal(await f.upgrade(path),'',path);
  assert.equal(await f.upgrade('/mobile/v1/events','http://other.invalid'),'');assert.deepEqual(f.seen,[]);
  assert.match(await f.upgrade('/mobile/v1/events'),/^HTTP\/1.1 101/);assert.deepEqual(f.seen,['WS /mobile/v1/events']);
});
