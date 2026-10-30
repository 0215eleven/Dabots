// Actual imported UI, public DSH 0.2.1-rc.2 and production engine. Requires normal
// development Metro (DESIGN_PREVIEW=0), Playwright and /usr/bin/chromium.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {startProxy} = require('./isolated-bridge-proxy.cjs');
const {pathToFileURL} = require('node:url');
const {resolve,join} = require('node:path');
const {mkdir} = require('node:fs/promises');
const createChat = require('./create-chat.cjs');
const root = resolve(__dirname, '../../..');
const delay = ms => new Promise(r=>setTimeout(r,ms));
async function until(run, timeout=10000){const start=Date.now();let last;while(Date.now()-start<timeout){try{const value=await run();return {value,ms:Date.now()-start}}catch(e){last=e;await delay(100)}}throw last;}
(async()=>{
 const {launchFixture}=await import(pathToFileURL(resolve(root,'plugin/bridge/test/fixture-host.mjs')));
 const fixtures=[], proxies=[];let browser, page, activeHost;const results=[],errors=[],warnings=[],httpErrors=[];let stage='startup';
 const app=process.env.DS_TEST_URL||'http://127.0.0.1:8093';
 const check=(name,detail={})=>{results.push({name,...detail});console.log('PASS',name,JSON.stringify(detail));};
 async function host(){const f=await launchFixture();fixtures.push(f);const p=await startProxy(f.urls.bridgeUrl,app);proxies.push(p);const op=async(endpoint,payload={})=>{const r=await fetch(f.urls.operatorUrl,{method:'POST',headers:{'x-fixture':'bridge-test-only'},body:JSON.stringify({endpoint,payload}),signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,`owner ${endpoint}`);return r.json()};return {f,p,op,call:(action,body={})=>op('test.bot-call',{action,body})};}
 try{
 const h=await host(); activeHost=h; browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(12000);
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')warnings.push(m.text().split('\n')[0])});
 page.on('response',r=>{if(r.status()>=400)httpErrors.push({status:r.status(),path:new URL(r.url()).pathname})});
 const shotDir=process.env.DS_TEST_SCREENSHOTS;
 // Baseline English captures can never replace the Chinese evidence, including
 // when the combined scenario uses the same configured capture root.
 async function capture(name,locale='en'){if(!shotDir)return;assert.ok(resolve(shotDir)!==root&&!resolve(shotDir).startsWith(root+'/'));const directory=join(shotDir,locale);await mkdir(directory,{recursive:true,mode:0o700});await page.screenshot({path:join(directory,name+'.png'),style:'#error-toast {visibility:hidden !important}'});}
 const captureChinese=name=>capture(name,'zh');
 const visible=text=>{const status={'Connected':'Connected','已连接':'已连接','Offline · saved desktop state':'Disconnected','离线 · 已保存的电脑状态':'已断开'}[text];return status?page.getByRole('button',{name:/^(Settings|设置)$/}).and(page.locator(`[aria-valuetext="${status}"]`)).filter({visible:true}):page.getByText(text,{exact:true}).filter({visible:true});};
 async function back(){const link=page.getByRole('link',{name:/, back$/}).filter({visible:true});if(await link.count())await link.click();else {const button=page.getByRole('button',{name:/^(Back|返回)$/,exact:true}).filter({visible:true});if(await button.count())await button.click();else await page.goBack();}}
 async function lostAcknowledgement(h,bot,name){
  stage='lost successful POST acknowledgement';const text='Lost acknowledgement message';let submitted;
  const observe=request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/mobile/v1/submissions'&&request.postDataJSON()?.text===text)submitted=request.postDataJSON();};
  page.on('request',observe);
  const recoveredResponse=page.waitForResponse(response=>response.request().method()==='GET'&&response.status()===200&&new URL(response.url()).pathname===`/mobile/v1/submissions/${submitted?.requestId}`,{timeout:30000});
  recoveredResponse.catch(()=>{});
  try {
   h.p.controls.loseText=text;h.p.controls.loseNext='/mobile/v1/submissions';
   await page.getByLabel(`Message ${name}`,{exact:true}).fill(text);
   await page.getByRole('button',{name:'Send message',exact:true}).click();
   await until(()=>assert.equal(h.p.controls.dropped,1));
   assert.ok(submitted?.requestId);const drop=h.p.controls.drops?.[0];
   assert.equal(drop?.method,'POST','must drop the successful POST, never the pre-submit receipt GET');
   assert.equal(drop.path,'/mobile/v1/submissions');assert.equal(drop.requestId,submitted.requestId);assert.ok(drop.status>=200&&drop.status<300);
   const response=await recoveredResponse,receipt=await response.json();
   assert.equal(receipt.status,'accepted');assert.equal(receipt.requestId,submitted.requestId);assert.equal(receipt.conversationId,bot.id);assert.equal(receipt.sessionId,bot.sessionId);
   // UI-issued authorization stays only in memory for canonical public readback.
   const authorization=await response.request().headerValue('authorization');assert.ok(authorization);
   async function canonical(){const r=await fetch(`${h.p.url}/mobile/v1/conversations/${encodeURIComponent(bot.id)}/messages`,{headers:{authorization}});assert.equal(r.status,200);const history=await r.json();const rows=history.messages.filter(row=>row.requestId===submitted.requestId);assert.equal(rows.length,1);assert.equal(rows[0].text,text);assert.equal(history.messages.filter(row=>row.role==='user'&&row.text===text).length,1);return rows[0];}
   await until(canonical);const upgradesBeforeSettlement=h.p.controls.upgrades;
   const automatic=await until(async()=>{assert.equal(await visible(text).count(),1);assert.equal(await visible('Accepted by computer · waiting for transcript').count(),0);});
   assert.equal(h.p.controls.upgrades,upgradesBeforeSettlement,'pending must settle without reconnect');
   const visibleRowsBeforeReconnect=await visible(text).count();
   const upgrades=h.p.controls.upgrades;h.p.disconnect();await until(()=>assert.ok(h.p.controls.upgrades>upgrades));await until(async()=>assert.equal(await visible(text).count(),1));await canonical();
   assert.equal(h.p.controls.writes.filter(w=>w.path==='/mobile/v1/submissions'&&w.body.requestId===submitted.requestId).length,1);
   assert.equal(h.p.controls.writes.filter(w=>w.path==='/mobile/v1/submissions'&&w.body.text===text).length,1);
   check(stage,{requestId:submitted.requestId,droppedMethod:drop.method,droppedStatus:drop.status,recoveredReceipt:receipt.status,submissions:1,canonicalHistoryItems:1,automaticSettlementMs:automatic.ms,visibleRowsBeforeReconnect,visibleRowsAfterReconnect:1});
  }finally{page.off('request',observe);}
 }
 async function pair(h){const code=await h.op('pairing.create');await page.locator('textarea').fill(JSON.stringify({...code,url:h.p.url}));await page.getByRole('switch').check();await page.getByText(/^(Connect to my host|连接我的主机)$/).click();await until(async()=>{const s=await h.op('status');assert.ok(s.pending.length);await h.op('pairing.approve',{requestId:s.pending[0].requestId??s.pending[0].id})});await visible('Connected').or(visible('已连接')).waitFor();}
 await page.goto(app,{timeout:180000});
 // Keep Metro's development-only warning toast from covering product controls;
 // console/page errors remain captured and reported below.
 await page.addStyleTag({content:'#error-toast {pointer-events:none !important}'});await page.getByText('Connect your host',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>Boolean(globalThis.__DS_TEST_FIXTURE__)),false);
 stage='real UI pairing';await pair(h);await visible('Chief').waitFor();await visible('Candidate group').waitFor();check(stage);
 let state=await h.call('state'), bot=state.bots[0];
 if(process.env.DS_TEST_SCENARIO==='create-feedback'){await require('./ds-create-feedback.cjs')({page,h,visible,back,check,until,capture});assert.deepEqual(errors,[]);return;}
 if(process.env.DS_TEST_SCENARIO==='computer-names'){await require('./ds-computer-names.cjs')({page,h,host,pair,visible,back,check,until,capture});assert.deepEqual(errors,[]);return;}
 if(process.env.DS_TEST_SCENARIO==='theme-navigation'){await require('./ds-theme-navigation.cjs')({page,h,bot,visible,back,check,until,capture});assert.deepEqual(errors,[]);return;}
 if(process.env.DS_TEST_SCENARIO==='creation-menu'){
  const trigger=page.getByRole('button',{name:'New chat',exact:true});
  await trigger.focus();await trigger.press('Enter');
  await until(async()=>assert.equal(await page.getByRole('menuitem',{name:'Add Bot',exact:true}).evaluate(e=>e===document.activeElement),true));
  await page.keyboard.press('ArrowDown');
  await until(async()=>assert.equal(await page.getByRole('menuitem',{name:'New group',exact:true}).evaluate(e=>e===document.activeElement),true));
  await page.keyboard.press('Escape');await page.getByRole('menu').waitFor({state:'hidden'});
  assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
  await trigger.click();await page.getByRole('menu').waitFor();await page.mouse.click(195,30);await page.getByRole('menu').waitFor({state:'hidden'});
  check('creation menu supports keyboard focus, arrow navigation, Escape and outside dismissal');
  await createChat(page,'Add Bot');await page.getByLabel('Bot name',{exact:true}).waitFor();check('real home creation menu opens Bot form');await back();
  await createChat(page,'New group');await page.getByLabel('Group name',{exact:true}).waitFor();check('real home creation menu opens group form');assert.deepEqual(errors,[]);return;
 }
 if(process.env.DS_TEST_SCENARIO==='final-queue'){await require('./ds-final-fixes.cjs').queue({page,h,bot,visible,back,check,until});assert.deepEqual(errors,[]);return;}
 if(process.env.DS_TEST_SCENARIO==='final-all'){stage='final fixes';await require('./ds-final-fixes.cjs').draft({page,h,bot,pair,visible,back,check,until});await require('./ds-final-fixes.cjs').queue({page,h,bot,visible,back,check,until});await require('./ds-final-fixes.cjs').ownership({page,h,bot,visible,back,check});}
 if(process.env.DS_TEST_SCENARIO==='final-draft'){stage='final draft';await require('./ds-final-fixes.cjs').draft({page,h,bot,pair,visible,back,check,until});assert.deepEqual(errors,[]);return;}
 if(process.env.DS_TEST_SCENARIO==='pending-locale'){stage='pending locale';await require('./ds-chinese.cjs').pending({page,h,visible,back,capture:captureChinese,check,until});assert.deepEqual(errors,[]);return;}
 if(process.env.DS_TEST_SCENARIO==='chinese-settings'){stage='Chinese settings and captures';await require('./ds-chinese.cjs').settings({page,h,visible,back,capture:captureChinese,check,until});assert.deepEqual(errors,[]);return;}
 if(process.env.DS_TEST_SCENARIO==='chinese'){stage='Chinese actual core UI';await require('./ds-chinese.cjs')({page,h,host,pair,visible,back,capture:captureChinese,check,until});assert.deepEqual(errors,[]);return;}
 if(process.env.DS_TEST_SCENARIO==='lost-ack'){await visible(bot.name).click();await lostAcknowledgement(h,bot,bot.name);assert.deepEqual(errors,[]);assert.equal(warnings.some(w=>/colorKit|POP_TO_TOP/.test(w)),false);check('zero uncaught browser errors and corrected web warnings');return;}
 stage='desktop edit foreground visibility';const start=Date.now();await h.call('update-bot',{id:bot.id,name:'Desktop Chief'});await visible('Desktop Chief').waitFor({timeout:10000});check(stage,{ms:Date.now()-start});
 stage='desktop existing history';await h.call('bridge.submit',{version:1,conversationId:bot.id,expectedSessionId:bot.sessionId,requestId:'desktop_existing_history',content:[{type:'text',text:'Desktop existing acceptance history'}]});await visible('Desktop Chief').click();await visible('Desktop existing acceptance history').waitFor();check(stage);
 stage='mobile send and desktop public history';await page.getByLabel('Message Desktop Chief',{exact:true}).fill('Mobile acceptance message');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await until(async()=>assert.ok(JSON.stringify(await h.op('test.session-history',{sessionId:bot.sessionId})).includes('Mobile acceptance message')),30000);check(stage);await capture('02-chat-history');
 await lostAcknowledgement(h,bot,'Desktop Chief');
 stage='reconnect without duplicate history';const before=h.p.controls.upgrades;h.p.disconnect();await until(()=>assert.ok(h.p.controls.upgrades>before));await visible('Mobile acceptance message').waitFor();assert.equal(await visible('Mobile acceptance message').count(),1);check(stage);
 stage='running and stopped states';await page.getByLabel('Message Desktop Chief',{exact:true}).fill('长任务 20 1');await page.getByRole('button',{name:'Send message',exact:true}).click();await page.getByRole('button',{name:'Stop Desktop Chief',exact:true}).waitFor({timeout:10000});await page.getByRole('button',{name:'Stop Desktop Chief',exact:true}).click();await page.getByRole('button',{name:'Stop Desktop Chief',exact:true}).waitFor({state:'hidden',timeout:10000});check(stage);
 stage='edit Bot/model canonical host readback';await page.getByRole('button',{name:'Info for Desktop Chief',exact:true}).click();await page.getByLabel('Bot name',{exact:true}).fill('Phone Chief');state=await h.call('state');const model=state.models.at(-1);await page.getByRole('button',{name:model.name,exact:true}).click();const reasoning=await h.call('efforts',{ref:model.ref});const effort=reasoning.efforts.at(-1);assert.ok(effort);await page.getByRole('button',{name:effort.name,exact:true}).click();await page.getByRole('button',{name:state.models.at(-1).name,exact:true}).scrollIntoViewIfNeeded();await capture('03-bot-model');await page.getByRole('button',{name:'Save changes',exact:true}).click();await until(async()=>{const s=await h.call('state'),b=s.bots.find(b=>b.id===bot.id);assert.equal(b.name,'Phone Chief');assert.equal(b.model,model.ref);assert.equal(b.effort,effort.id)});check(stage);
 await page.getByRole('button',{name:/Saving|Save changes/}).waitFor({state:'hidden'});await back();await page.getByLabel('Message Phone Chief',{exact:true}).waitFor();await back();
 stage='mobile create Bot';await createChat(page,'Add Bot');await page.getByLabel('Bot name',{exact:true}).fill('Phone Created');await page.getByLabel('Role',{exact:true}).fill('Acceptance');await page.getByRole('button',{name:'Create Bot',exact:true}).click();await visible('Phone Created').waitFor();state=await h.call('state');const created=state.bots.find(b=>b.name==='Phone Created');assert.equal(created.role,'Acceptance');check(stage);
 stage='mobile create group';await createChat(page,'New group');await page.getByLabel('Group name',{exact:true}).fill('Phone Group');await page.getByRole('checkbox',{name:'Phone Chief',exact:true}).click();await page.getByRole('checkbox',{name:'Phone Created',exact:true}).click();await page.getByRole('button',{name:'Create group',exact:true}).click();await visible('Phone Group').waitFor();state=await h.call('state');const group=state.rooms.find(g=>g.name==='Phone Group');assert.deepEqual(new Set(group.members),new Set([bot.id,created.id]));check(stage);await capture('01-conversation-list');
 stage='mobile group edit';await visible('Phone Group').click();await page.getByRole('button',{name:'Info for Phone Group',exact:true}).click();await page.getByLabel('Group name',{exact:true}).fill('Phone Group Edited');await capture('04-group-edit');await page.getByRole('button',{name:'Save group',exact:true}).click();await until(async()=>assert.equal((await h.call('state')).rooms.find(g=>g.id===group.id).name,'Phone Group Edited'));check(stage);await page.getByRole('button',{name:/Saving|Save group/}).waitFor({state:'hidden'});await page.getByLabel('Message Phone Group Edited',{exact:true}).waitFor();await back();
 stage='shared settings';await page.getByRole('button',{name:'Settings',exact:true}).click();await visible('Computer appearance').waitFor();assert.equal(await page.getByRole('heading',{name:'Settings',exact:true}).filter({visible:true}).count(),0,'settings has no redundant title');assert.ok((await visible('Accent').boundingBox()).width>=40,'Accent label must not collapse on a 390px phone');assert.equal(await page.locator('stop[stop-color="#000000"]').count(),0,'web must render surface fade, not a black native mask');await page.getByRole('radio',{name:'#3b6fd8',exact:true}).click();await until(async()=>assert.equal((await h.call('state')).prefs.accent,'#3b6fd8'));await page.locator('select').nth(1).selectOption('quiet');await until(async()=>assert.equal((await h.call('state')).prefs.motion,'quiet'));check(stage);await until(async()=>assert.equal(await page.getByRole('radio',{name:'#3b6fd8',exact:true}).isEnabled(),true));await capture('05-settings');await visible('Motion').scrollIntoViewIfNeeded();await capture('06-settings-preferences');
 stage='denied write remains unchanged';h.p.controls.denyNext='/actions';await page.getByRole('radio',{name:'#d97757',exact:true}).click();await page.getByText(/Controlled isolated owner denial/).waitFor();assert.equal((await h.call('state')).prefs.accent,'#3b6fd8');check(stage);
 await back();stage='pinned hidden Bot shown on request';
 const observedFlags=[];const observeFlags=async response=>{if(response.request().method()==='GET'&&new URL(response.url()).pathname==='/mobile/v1/state'&&response.status()===200){const value=await response.json().catch(()=>null);const item=value?.bots?.find(b=>b.id===created.id);observedFlags.push({at:Date.now(),hidden:item?.hidden,pinned:item?.pinned});}};
 page.on('response',observeFlags);const flagsStarted=Date.now();
 try{await h.call('set-flags',{id:created.id,pinned:true,hidden:true});const canonical=(await h.call('state')).bots.find(b=>b.id===created.id);assert.equal(canonical.hidden,true);assert.equal(canonical.pinned,true);await until(async()=>assert.equal(await visible('Phone Created').count(),0));console.log('FLAGS_SYNC',JSON.stringify({ms:Date.now()-flagsStarted,observed:observedFlags.map(row=>({...row,at:row.at-flagsStarted}))}));}
 catch(error){console.log('FLAGS_SYNC_FAILURE',JSON.stringify({ms:Date.now()-flagsStarted,observed:observedFlags.map(row=>({...row,at:row.at-flagsStarted}))}));throw error;}finally{page.off('response',observeFlags);}
 await page.getByRole('button',{name:'Show hidden chats',exact:true}).click();await visible('Phone Created').waitFor();check(stage);
 stage='removed entity invalidates current route';await visible('Phone Created').click();await page.getByRole('button',{name:'Info for Phone Created',exact:true}).click();await h.call('delete-bot',{id:created.id});await visible('Unavailable on this computer').waitFor({timeout:10000});assert.equal(await page.getByRole('button',{name:'Save changes',exact:true}).count(),0);await page.getByRole('button',{name:'Return to chats',exact:true}).click();check(stage);
 stage='host switch';const other=await host();await other.call('update-bot',{id:other.f.urls.botId,name:'Other Computer Bot'});await page.getByRole('button',{name:'Settings',exact:true}).click();await visible('Pair a computer').click();await pair(other);await visible('Other Computer Bot').waitFor();assert.equal(await visible('Phone Chief').count(),0);await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button').filter({has:page.getByText(new URL(h.p.url).host,{exact:true})}).click();await visible('Phone Chief').waitFor();assert.equal(await visible('Other Computer Bot').count(),0);check(stage);
 if(!['baseline','final-all'].includes(process.env.DS_TEST_SCENARIO)){stage='Chinese actual core UI';await require('./ds-chinese.cjs')({page,h,other,host,pair,visible,back,capture:captureChinese,check,until});}
 stage='revoked device';const status=await h.op('status');const device=status.devices.find(d=>!d.revokedAt);assert.ok(device);await h.op('device.revoke',{id:device.id});await visible('Offline · saved desktop state').waitFor({timeout:10000});await visible('Phone Chief').click();await page.getByText('Pair this device with your server.',{exact:true}).waitFor();assert.equal(await page.getByLabel('Message Phone Chief',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Send message',exact:true}).count(),0);const submissionsAfterRevoke=h.p.controls.writes.filter(w=>w.path==='/mobile/v1/submissions').length;await page.waitForTimeout(500);assert.equal(h.p.controls.writes.filter(w=>w.path==='/mobile/v1/submissions').length,submissionsAfterRevoke,'revoked UI offers no send and issues no submissions');check(stage);
 assert.deepEqual(errors,[]);assert.equal(warnings.some(w=>/colorKit|POP_TO_TOP/.test(w)),false,'no color parsing or empty-stack navigation errors');check('zero uncaught browser errors and corrected web warnings');
 }catch(e){console.error('FAIL',stage,e.message);if(stage!=='real UI pairing'){console.log('DIAGNOSTIC UI',await page?.locator('body').innerText().catch(()=>''));console.log('DIAGNOSTIC nav',await page.locator('a,button').filter({visible:true}).evaluateAll(es=>es.map(e=>({tag:e.tagName,label:e.getAttribute('aria-label'),text:e.textContent?.slice(0,80)}))));console.log('DIAGNOSTIC mutations',JSON.stringify(activeHost?.p.controls.writes));}process.exitCode=1;}finally{if(browser)await browser.close();for(const p of proxies.reverse())await p.close();for(const f of fixtures.reverse())await f.close();console.log(JSON.stringify({results,pageErrors:errors,consoleErrors:[...new Set(warnings)],httpErrors},null,2));if(errors.length)process.exitCode=1;}
})().catch(e=>{console.error(e.message);process.exitCode=1});
