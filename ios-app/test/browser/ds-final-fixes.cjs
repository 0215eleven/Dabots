const assert=require('node:assert/strict');
exports.draft=async({page,h,bot,pair,visible,back,check,until})=>{
 const hosts=await page.evaluate(()=>JSON.parse(localStorage.getItem('ds-bot:cache:'+JSON.stringify(['app','hosts']))));
 const serverId=hosts[0].serverId,key='ds-bot:cache:'+JSON.stringify([serverId,'draft:'+bot.id]);
 await page.evaluate(({key})=>localStorage.setItem(key,JSON.stringify('Pre-upgrade saved draft')),{key});
 await visible(bot.name).click();const input=()=>page.getByLabel('Message '+bot.name,{exact:true});
 await until(async()=>assert.equal(await input().inputValue(),'Pre-upgrade saved draft'));check('I1 actual old raw-key draft restore');
 await input().fill('Draft across navigation');await back();await visible(bot.name).click();await until(async()=>assert.equal(await input().inputValue(),'Draft across navigation'));check('I1 actual navigation remount');
 // Web intentionally keeps credentials in memory; restart requires real pairing again.
 await page.goto(new URL(page.url()).origin);await page.addStyleTag({content:'#error-toast {pointer-events:none !important}'});await page.getByText('Connect your host',{exact:true}).waitFor();for(const device of (await h.op('status')).devices.filter(d=>!d.revokedAt))await h.op('device.revoke',{id:device.id});await pair(h);await visible(bot.name).click();await until(async()=>assert.equal(await input().inputValue(),'Draft across navigation'));check('I1 browser restart + re-pair restores existing local draft');
 await page.route(h.p.url+'/**',route=>route.abort());h.p.disconnect();await back();await visible('Offline · saved desktop state').waitFor({timeout:12000});await visible(bot.name).click();await input().waitFor();await input().fill('Offline draft edit');assert.equal(await page.getByRole('button',{name:'Send message',exact:true}).isEnabled(),false);await until(async()=>assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key),'Offline draft edit'));check('I1 actual offline editor and disabled send');
 await page.unroute(h.p.url+'/**');await input().fill('');await back();await until(async()=>assert.equal(await visible('Offline · saved desktop state').count(),0),12000);
};
exports.queue=async({page,h,bot,visible,back,check,until})=>{
 let authorization;const readAuth=async request=>{if(request.url().startsWith(h.p.url+'/mobile/v1/'))authorization=await request.headerValue('authorization')||authorization;};page.on('request',readAuth);
 try{
 await visible(bot.name).click();await page.getByLabel('Message '+bot.name,{exact:true}).fill('长任务 20 1');await page.getByRole('button',{name:'Send message',exact:true}).click();await page.getByRole('button',{name:'Stop '+bot.name,exact:true}).waitFor();
 await page.getByLabel('Message '+bot.name,{exact:true}).fill('Mobile subsequent queued input');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await h.call('bridge.submit',{version:1,conversationId:bot.id,expectedSessionId:bot.sessionId,requestId:'desktop_final_queue',content:[{type:'text',text:'Desktop subsequent queued input'}]});
 let queue;await until(async()=>{assert.ok(authorization);const r=await fetch(h.p.url+'/mobile/v1/actions',{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify({endpoint:'queue',payload:{conversationId:bot.id}})});assert.equal(r.status,200);queue=await r.json();assert.equal(queue.conversationId,bot.id);assert.equal(queue.sessionId,bot.sessionId);assert.ok(queue.items.some(i=>i.text==='Mobile subsequent queued input'));assert.ok(queue.items.some(i=>i.requestId==='desktop_final_queue'));});
 assert.ok(queue.items.every(i=>i.target==='next-turn'));const start=Date.now();await visible('Next turn · Desktop subsequent queued input').waitFor({timeout:10000});await visible('Next turn · Mobile subsequent queued input').waitFor();await visible('Queued on computer · separate from current turn').waitFor();assert.ok(await page.getByRole('button',{name:'Stop '+bot.name,exact:true}).count());check('I3 actual public host queue distinguishes mobile + desktop inputs from running task',{items:queue.items.length,targets:queue.items.map(i=>i.target),visibilityMs:Date.now()-start});
 await page.getByRole('button',{name:'Stop '+bot.name,exact:true}).click();await back();assert.equal(h.p.controls.writes.some(w=>w.body.endpoint==='queue-remove'),false);
 }finally{page.off('request',readAuth);}
};
exports.ownership=async({page,h,bot,visible,back,check})=>{
 const {pathToFileURL}=require('node:url'),{resolve}=require('node:path');const src=resolve(__dirname,'../../src/ds');
 const {createDsCore}=await import(pathToFileURL(src+'/core.ts')),{guardManagement}=await import(pathToFileURL(src+'/management.ts')),{dsId}=await import(pathToFileURL(src+'/identity.ts'));
 const queueReply=page.waitForResponse(r=>r.url()===h.p.url+'/mobile/v1/actions'&&r.request().postDataJSON()?.endpoint==='queue'&&r.status()===200);await visible(bot.name).click();const authorization=await (await queueReply).request().headerValue('authorization');assert.ok(authorization);await back();
 async function request(path,body){const r=await fetch(h.p.url+'/mobile/v1/'+path,{method:body?'POST':'GET',headers:{authorization,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,200);return r.json();}
 for(const operation of ['createBot','duplicateBot'])for(const stage of ['after-ack','during-readback','lost-reply']){
  let active=true,writes=0,reads=0,ack;const key=JSON.stringify(['fixture',h.p.url,operation,stage]);let snap;
  const client={action:async(endpoint,payload)=>{writes++;ack=await request('actions',{endpoint,payload});if(stage!=='during-readback')active=false;if(stage==='lost-reply')throw Error('controlled lost reply after server ACK');return ack;}};
  const snapshot=async client=>({serverId:'fixture',client,source:'live',team:{...await request('state'),mobileCapabilities:(await request('info')).capabilities},conversations:(await request('conversations')).conversations});snap=await snapshot(client);
  const core=createDsCore({client,serverId:'fixture',outbox:null,isOnline:()=>true,isCurrent:()=>active,getSnapshot:()=>snap,refresh:async()=>{reads++;const result=await snapshot(client);active=false;return result;}}),guard=guardManagement(core,key);
  const invoke=c=>operation==='createBot'?c.createBot({name:'Final race '+stage}):c.duplicateBot(dsId('fixture','bot',bot.id));
  await assert.rejects(invoke(guard.core),error=>{assert.equal(error.mutation,stage==='lost-reply'?'unknown':'acknowledged');assert.equal(error.code,stage==='lost-reply'?'MUTATION_UNCONFIRMED':'READBACK_FAILED');return true;});assert.equal(writes,1);assert.equal(reads,stage==='during-readback'?1:0);assert.equal(guard.issues().length,1);assert.ok((await request('state')).bots.some(b=>b.id===ack.id));core.dispose();
  const fresh={action:async()=>{throw Error('repeat must remain blocked');}},freshSnap=await snapshot(fresh);active=true;
  const returned=guardManagement(createDsCore({client:fresh,serverId:'fixture',outbox:null,isOnline:()=>true,isCurrent:()=>active,getSnapshot:()=>freshSnap,refresh:async()=>snapshot(fresh)}),key);
  await assert.rejects(invoke(returned.core));const reviewed=await returned.review();assert.equal(reviewed.length,1);returned.acknowledge(reviewed);assert.equal(returned.issues().length,0);returned.core.dispose();check('I2 public host '+operation+' '+stage,{writes,oldOwnerReadbacks:reads,canonicalCreated:true,freshClientReview:true});
 }
};
