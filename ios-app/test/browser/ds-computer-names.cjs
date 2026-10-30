// The normal app with disposable public DSH hosts, real storage and actual UI.
const assert=require('node:assert/strict');
module.exports=async function({page,h,host,pair,visible,back,check,until,capture}){
  const settings=()=>page.getByRole('button',{name:/^(Settings|设置)$/,exact:true});
  const field=()=>page.getByLabel('电脑名称',{exact:true});
  async function references(remember=false){return page.evaluate(remember=>{
    for(const element of document.querySelectorAll('[role="heading"], [role="button"]')){
      if(!element.getClientRects().length)continue;
      const key=Object.keys(element).find(k=>k.startsWith('__reactFiber$'));
      for(let fiber=key&&element[key];fiber;fiber=fiber.return)for(let c=fiber.dependencies?.firstContext;c;c=c.next){
        const v=c.memoizedValue;
        if(v?.host&&v.client&&v.outbox&&typeof v.switchHost==='function'){
          if(remember)window.__computerNameRefs={host:v.host,client:v.client,outbox:v.outbox};
          const old=window.__computerNameRefs;
          return {serverId:v.host.serverId,rawName:v.host.name,sameHost:old?.host===v.host,sameClient:old?.client===v.client,sameOutbox:old?.outbox===v.outbox};
        }
      }
    }throw Error('Actual session context not found');
  },remember);}
  async function edit(name){await page.getByRole('button',{name:'重命名 '+name,exact:true}).click();await field().waitFor();await until(async()=>assert.equal(await field().isEnabled(),true));}
  async function save(name){await field().fill(name);await page.getByRole('button',{name:'保存名称',exact:true}).click();await field().waitFor({state:'hidden'});}
  async function home(name){await back();await settings().waitFor();assert.equal(await visible(name).count(),0,'the home has no visible computer title');}
  async function selected(id){await settings().waitFor();await until(async()=>assert.equal((await references()).serverId,id));}
  const initial=await references(true),upgrades=h.p.controls.upgrades;
  await settings().click();
  await page.locator('select').filter({has:page.locator('option[value="dark"]')}).selectOption('dark');
  await page.locator('select').filter({has:page.locator('option[value="zh"]')}).selectOption('zh');
  await edit(initial.rawName);await field().fill('  ');
  assert.equal(await page.getByRole('button',{name:'保存名称',exact:true}).isDisabled(),true);
  await field().fill('长'.repeat(41));assert.equal(await page.getByRole('button',{name:'保存名称',exact:true}).isDisabled(),true);
  await save('家里的电脑 🤖');
  await until(async()=>assert.equal(await visible('家里的电脑 🤖').count(),2,'connection and saved computer use one label without a redundant title'));
  await capture('settings-nickname','zh');await home('家里的电脑 🤖');await capture('home-nickname','zh');
  const after=await references();assert.ok(after.sameHost&&after.sameClient&&after.sameOutbox);assert.equal(after.rawName,initial.rawName);assert.equal(h.p.controls.upgrades,upgrades);
  check('one confirmed nickname reaches connection and saved computers without replacing host/client/outbox or reconnecting');

  await settings().click();await edit('家里的电脑 🤖');await field().fill('没有保存的名字');await page.getByRole('button',{name:'取消',exact:true}).click();
  await visible('家里的电脑 🤖').first().waitFor();
  await edit('家里的电脑 🤖');
  await page.evaluate(()=>{window.__nameSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.includes('computer-name:'))throw Error('isolated nickname write denial');return window.__nameSetItem.call(this,k,v)}});
  try{await field().fill('不能保存的名字');await page.getByRole('button',{name:'保存名称',exact:true}).click();await visible('未能确认电脑昵称已保存，请重试。').waitFor();assert.equal(await field().isVisible(),true);}
  finally{await page.evaluate(()=>{Storage.prototype.setItem=window.__nameSetItem;delete window.__nameSetItem})}
  await page.getByRole('button',{name:'取消',exact:true}).click();await home('家里的电脑 🤖');check('invalid input, cancel and swallowed storage failure cannot report a successful rename');

  await settings().click();await edit('家里的电脑 🤖');await page.getByRole('button',{name:'恢复电脑原名',exact:true}).click();await field().waitFor({state:'hidden'});await home(initial.rawName);
  await settings().click();await edit(initial.rawName);await save('家里的电脑');
  const other=await host();await other.call('update-bot',{id:other.f.urls.botId,name:'第二台机器人'});
  await visible('配对电脑').click();await pair(other);await visible('第二台机器人').waitFor();
  const second=await references();assert.notEqual(second.serverId,initial.serverId);
  await settings().click();await page.locator('select').filter({has:page.locator('option[value="zh"]')}).selectOption('zh');await edit(second.rawName);await save('办公室');
  await edit('家里的电脑');assert.equal((await references()).serverId,second.serverId,'renaming an inactive row must not switch computers');
  await save('家里的电脑 A');assert.equal((await references()).serverId,second.serverId);
  await page.getByRole('button').filter({has:page.getByText(new URL(h.p.url).host,{exact:true})}).click();await selected(initial.serverId);
  await settings().click();await page.getByRole('button').filter({has:page.getByText(new URL(other.p.url).host,{exact:true})}).click();await selected(second.serverId);
  check('reset restores paired name; two computers retain independent labels and inactive edits preserve selection');

  await settings().click();await page.getByRole('button').filter({has:page.getByText(new URL(h.p.url).host,{exact:true})}).click();await selected(initial.serverId);
  await page.context().setOffline(true);h.p.disconnect();await visible('Offline · saved desktop state').or(visible('离线 · 已保存的电脑状态')).waitFor({timeout:15000});await capture('home-disconnected','zh');
  await settings().click();await edit('家里的电脑 A');await save('离线的家用电脑');await home('离线的家用电脑');
  await page.context().setOffline(false);await visible('Connected').or(visible('已连接')).waitFor({timeout:20000});
  assert.equal((await references()).serverId,initial.serverId);assert.equal(h.p.controls.writes.length,0);assert.equal(other.p.controls.writes.length,0);
  check('offline nickname changes require no Bridge action and survive connection recovery');

  await page.goto(new URL('/settings',page.url()).href);await visible('离线的家用电脑').first().waitFor();await visible('办公室').waitFor();
  // Browser credentials intentionally stay in JS memory: reload checks saved
  // display preferences, not restored authorization or a native-device session.
  check('saved nicknames hydrate after a real page reload; browser authorization is not claimed restored');
};
