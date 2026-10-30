// Exercises the normal app against the same disposable public DSH as the functional suite.
const assert = require('node:assert/strict');
const createChat = require('./create-chat.cjs');
module.exports = async function chinese({page, h, other, host, pair, visible, back, capture, check, until}) {
  const settings = () => page.getByRole('button', {name: /^(Settings|设置)$/, exact: true});
  const home = async () => {
    await until(async()=>assert.equal(await page.getByRole('heading', {name: 'DeepSeek Bot Pro', exact: true}).filter({visible:true}).count(), 1, 'one home heading'));
    const button = settings();
    assert.equal(await button.locator('svg[viewBox="0 0 24 24"]').count(), 1, 'settings action uses the menu icon');
    assert.equal((await button.innerText()).trim(), '', 'menu button has an accessible name without a text action');
    const box = await button.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44 && box.y >= 0 && box.x + box.width <= 390);
  };
  await settings().click();
  const language = page.locator('select').filter({has:page.locator('option[value="zh"]')});
  assert.equal(await language.locator('option[value="en"]').innerText(), 'English');
  assert.equal(await language.locator('option[value="zh"]').innerText(), '简体中文');
  await language.selectOption('zh');
  await visible('电脑外观').waitFor();
  await visible('手机外观与偏好').waitFor();
  assert.equal(await language.inputValue(), 'zh');
  await back(); await home(); await visible('已连接').waitFor();
  await page.getByRole('button', {name:'新对话',exact:true}).waitFor();
  await capture('01-conversation-list');
  check('Chinese selection updates mounted home and accessible menu settings button');
  const state = await h.call('state'), bot = state.bots[0];
  await visible(bot.name).click();
  const input = page.getByLabel(`给 ${bot.name} 发消息`,{exact:true});
  await input.fill('Task 5 原始消息 · unchanged text');
  await page.getByRole('button',{name:'发送消息',exact:true}).click();
  await visible('Task 5 原始消息 · unchanged text').waitFor();
  await until(async()=>{
    assert.ok(JSON.stringify(await h.op('test.session-history',{sessionId:bot.sessionId})).includes('Task 5 原始消息 · unchanged text'));
    assert.equal(await visible('Task 5 原始消息 · unchanged text').count(),1);
    assert.equal(await visible('sending').count(),0);
    assert.equal(await visible('发送中').count(),0);
    assert.equal(await visible('电脑已接受 · 等待对话记录').count(),0);
  },30000);
  await capture('02-chat-history');
  await page.getByRole('button',{name:`${bot.name} 的信息`,exact:true}).click();
  await page.getByLabel('机器人名称',{exact:true}).waitFor();
  const model = state.models.at(-1), options = await h.call('efforts',{ref:model.ref}), effort = options.efforts.at(-1);
  await page.getByRole('button',{name:model.name,exact:true}).click();
  const effortLabel=({Off:'关闭',Low:'低',High:'高',Max:'最高'})[effort.name]??effort.name;
  await page.getByRole('button',{name:effortLabel,exact:true}).click();
  await visible('模型与推理 · 电脑').scrollIntoViewIfNeeded();
  await visible(model.ref).waitFor();
  await capture('03-bot-model');
  await page.getByRole('button',{name:'保存更改',exact:true}).click();
  await until(async()=>{const b=(await h.call('state')).bots.find(b=>b.id===bot.id);assert.equal(b.model,model.ref);assert.equal(b.effort,effort.id);assert.equal(b.name,bot.name);});
  await page.getByRole('button',{name:/保存中|保存更改/}).waitFor({state:'hidden'});
  await back(); await input.waitFor(); await back();
  check('Chinese single chat, Bot form and canonical DSH model and reasoning controls preserve raw data');
  const group = (await h.call('state')).rooms[0];
  await visible(group.name).click();
  await page.getByRole('button',{name:`${group.name} 的信息`,exact:true}).click();
  await page.getByLabel('群组名称',{exact:true}).waitFor();
  await visible('群组负责人').waitFor();
  await page.getByRole('button',{name:'管理员',exact:true}).waitFor();
  await capture('04-group-edit');
  await back(); await back();
  await createChat(page,'添加机器人');
  await page.getByLabel('机器人名称',{exact:true}).waitFor();
  await visible('继承电脑设置').waitFor();
  await back();
  await createChat(page,'新建群组');
  await page.getByLabel('群组名称',{exact:true}).waitFor(); await back();
  check('Chinese create Bot and create/edit group labels and real back navigation');
  await settings().click();
  await capture('05-settings');
  await language.scrollIntoViewIfNeeded();
  await capture('06-settings-preferences');
  const cache = () => page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('ds-bot:cache:')&&k.endsWith(',"mobile-preferences"]')).map(k=>[JSON.parse(k.slice('ds-bot:cache:'.length))[0],JSON.parse(localStorage.getItem(k))])));
  const before = await cache(), scope = Object.keys(before).find(k=>before[k].locale==='zh');
  assert.ok(scope); assert.equal(before[scope].locale,'zh');
  // Existing browser cache intentionally swallows generic setItem failures. The language
  // preference must verify readback and tell the user that this selection is session-only.
  await page.evaluate(()=>{window.__localeSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.endsWith(',"mobile-preferences"]'))throw new Error('isolated locale storage denial');return window.__localeSetItem.call(this,k,v);};});
  try{await language.selectOption('en');await visible('Language changed for this session, but could not be saved on this device.').waitFor();assert.equal((await cache())[scope].locale,'zh');}
  finally{await page.evaluate(()=>{Storage.prototype.setItem=window.__localeSetItem;delete window.__localeSetItem;});}
  await language.selectOption('zh');await visible('电脑外观').waitFor();
  check('Chinese locale persists under original host identity and storage denial is visible');
  // A successful desktop mutation whose POST acknowledgement is lost must stay reviewable,
  // including when the locale changes while this very settings screen is mounted.
  let lostAction = false;
  const loseAction = async route => {
    if(!lostAction && route.request().method()==='POST' && route.request().postDataJSON()?.endpoint==='set-prefs') {
      const response=await route.fetch();assert.ok(response.status()>=200&&response.status()<300);
      lostAction=true;
      await route.fulfill({response,body:'{',headers:{...response.headers(),'content-length':'1'}});
    } else await route.continue();
  };
  await page.route('**/mobile/v1/actions',loseAction);
  try{await page.getByRole('radio',{name:'#228866',exact:true}).click();await visible('更改需要确认').waitFor();assert.equal(lostAction,true);}
  finally{await page.unroute('**/mobile/v1/actions',loseAction);}
  await visible('未收到回复，修改可能已在电脑上生效。请刷新并检查后再进行其他修改。').first().waitFor();
  await language.selectOption('en');await visible('Changes need review').waitFor();
  await language.selectOption('zh');await visible('更改需要确认').waitFor();
  await visible('读取电脑当前状态').click();await visible('我已检查当前状态').click();
  assert.equal((await h.call('state')).prefs.accent,'#228866');
  check('mounted uncertain-save review and errors follow Chinese and English immediately');
  await language.selectOption('system');await visible('Computer appearance').waitFor();
  assert.equal(await language.inputValue(),'system');
  await language.selectOption('host');await visible('Computer appearance').waitFor();
  assert.equal(await language.inputValue(),'host');
  await language.selectOption('zh');await visible('电脑外观').waitFor();
  if(!other){other=await host();await other.call('update-bot',{id:other.f.urls.botId,name:'Other Locale Bot'});await visible('配对电脑').click();await pair(other);await visible('Other Locale Bot').waitFor();await settings().click();}
  else{await page.getByRole('button').filter({has:page.getByText(new URL(other.p.url).host,{exact:true})}).click();await visible('Connected').waitFor();await settings().click();}
  assert.equal(await language.inputValue(),'host','another computer keeps its own follow preference');
  await language.selectOption('en');
  await until(async()=>assert.equal(Object.values(await cache()).filter(p=>p.locale==='en').length,1));
  await page.getByRole('button').filter({has:page.getByText(new URL(h.p.url).host,{exact:true})}).click();
  await visible('已连接').waitFor();await home();
  await settings().click();assert.equal(await language.inputValue(),'zh');
  const after=await cache();assert.equal(after[scope].locale,'zh');assert.ok(Object.values(after).some(p=>p.locale==='en'));
  await language.selectOption('en');await visible('Computer appearance').waitFor();
  await back();await visible('Connected').waitFor();await home();
  await page.getByRole('button',{name:'New chat',exact:true}).waitFor();
  check('host/system fallback, per-host locale restoration and English round trip');
  // Browser history navigation exercises the second real home route without reloading
  // this development tab's intentionally memory-only pairing credentials.
  await page.evaluate(()=>{history.pushState(null,'','/connected');dispatchEvent(new PopStateEvent('popstate',{state:null}));});
  await page.waitForURL('**/connected');await home();
  await settings().click();await visible('Computer appearance').waitFor();await back();await page.waitForURL('**/connected');await home();
  check('both home routes have one heading, a 44pt menu button, and working settings/back navigation');
};

// A focused regression for pending text. Hold one real POST, exercise the same
// outbox through navigation and language changes, then release it to public DSH.
module.exports.pending = async function pending({page,h,visible,back,capture,check,until}) {
  const state=await h.call('state'),bot=state.bots[0],text='Task 5 中文消息 · canonical history';
  const language=page.locator('select').filter({has:page.locator('option[value="zh"]')});
  const gear=()=>page.getByRole('button',{name:/^(Settings|设置)$/,exact:true});
  async function choose(value){await gear().click();await language.selectOption(value);await back();await visible(bot.name).waitFor();}
  await choose('zh');await visible(bot.name).click();
  let release;const gate=new Promise(resolve=>{release=resolve;});let held=0;const requests=[];let inFlight=Promise.resolve();
  const hold=route=>{inFlight=(async()=>{if(route.request().method()==='POST'){held++;requests.push(route.request().postDataJSON());await gate;}await route.continue();})();return inFlight;};
  await page.route('**/mobile/v1/submissions',hold);
  try {
    await page.getByLabel(`给 ${bot.name} 发消息`,{exact:true}).fill(text);
    await page.getByRole('button',{name:'发送消息',exact:true}).click();
    await visible('发送中').waitFor();assert.equal(await visible('sending').count(),0);
    await back();await choose('en');await visible(bot.name).click();await visible('sending').waitFor();
    await back();await choose('zh');await visible(bot.name).click();await visible('发送中').waitFor();
    assert.equal(held,1);assert.equal(requests.length,1);assert.ok(requests[0].requestId);
    check('one pending intent translates sending through Chinese/English navigation without another POST');
  } finally {release();await inFlight;await page.unroute('**/mobile/v1/submissions',hold);}
  await until(async()=>{
    assert.ok(JSON.stringify(await h.op('test.session-history',{sessionId:bot.sessionId})).includes(text));
    assert.equal(await visible(text).count(),1);assert.equal(await visible('发送中').count(),0);
    assert.equal(await visible('电脑已接受 · 等待对话记录').count(),0);
    assert.ok(await page.getByText(/收到：Task 5 中文消息/).filter({visible:true}).count());
  },30000);
  assert.equal(h.p.controls.writes.filter(w=>w.path==='/mobile/v1/submissions'&&w.body.requestId===requests[0].requestId).length,1);
  await until(async()=>assert.equal(Boolean((await h.call('state')).work?.bots?.[bot.id]),false),30000);
  await back();await visible(bot.name).waitFor();await visible(bot.name).click();
  await visible(text).waitFor();
  await page.getByText('正在思考…',{exact:true}).filter({visible:true}).waitFor({state:'hidden',timeout:30000});
  await capture('02-chat-history');
  check('Chinese canonical single-chat history and real response replace pending with one submission');
};

// Focused review follow-up: actual settings feedback plus only the four captures
// that need replacement. The previously verified canonical chat image stays intact.
module.exports.settings = async function settings({page,h,visible,back,capture,check,until}) {
  const language=page.locator('select').filter({has:page.locator('option[value="zh"]')});
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await language.selectOption('zh');await visible('电脑外观').first().waitFor();
  let lost=false;
  const lose=async route=>{
    if(!lost&&route.request().method()==='POST'&&route.request().postDataJSON()?.endpoint==='set-prefs'){
      const response=await route.fetch();assert.ok(response.status()>=200&&response.status()<300);lost=true;
      await route.fulfill({response,body:'{',headers:{...response.headers(),'content-length':'1'}});
    }else await route.continue();
  };
  await page.route('**/mobile/v1/actions',lose);
  try{await page.getByRole('radio',{name:'#228866',exact:true}).click();await visible('更改需要确认').waitFor();assert.equal(lost,true);}
  finally{await page.unroute('**/mobile/v1/actions',lose);}
  const zhManagement='未收到回复，修改可能已在电脑上生效。请刷新并检查后再进行其他修改。';
  const enManagement='The reply was lost. The change may already exist on the computer. Refresh and check it before making another change.';
  await until(async()=>assert.equal(await visible(zhManagement).count(),2));
  await page.evaluate(()=>{window.__localeSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.endsWith(',"mobile-preferences"]'))throw Error('isolated preference write denial');return window.__localeSetItem.call(this,k,v);};});
  try{
    await language.selectOption('en');
    await visible('Language changed for this session, but could not be saved on this device.').waitFor();
    assert.equal(await visible(enManagement).count(),2,'locale failure must retain both current management feedback and its review row');
  }finally{await page.evaluate(()=>{Storage.prototype.setItem=window.__localeSetItem;delete window.__localeSetItem;});}
  await language.selectOption('zh');await visible('电脑外观').first().waitFor();
  await until(async()=>assert.equal(await visible('本次会话的语言已更改，但无法保存到此设备。').count(),0));
  assert.equal(await visible(zhManagement).count(),2);
  assert.equal((await h.call('state')).prefs.accent,'#228866');
  check('current locale failure and successful retry keep mounted localized management feedback');
  await visible('读取电脑当前状态').click();await visible('我已检查当前状态').click();
  await visible('连接方式').scrollIntoViewIfNeeded();
  await capture('05-settings');
  await language.scrollIntoViewIfNeeded();assert.equal(await language.inputValue(),'zh');await capture('06-settings-preferences');
  await back();const state=await h.call('state'),bot=state.bots[0];await visible(bot.name).click();
  await page.getByRole('button',{name:`${bot.name} 的信息`,exact:true}).click();
  await page.getByLabel('机器人名称',{exact:true}).waitFor();await page.getByLabel('颜色',{exact:true}).waitFor();
  const model=state.models.at(-1),options=await h.call('efforts',{ref:model.ref}),effort=options.efforts.at(-1);
  await page.getByRole('button',{name:model.name,exact:true}).click();
  await page.getByRole('button',{name:({Off:'关闭',Low:'低',High:'高',Max:'最高'})[effort.name]??effort.name,exact:true}).click();
  await visible('模型与推理 · 电脑').scrollIntoViewIfNeeded();await visible(model.ref).waitFor();await capture('03-bot-model');
  await page.getByRole('button',{name:'保存更改',exact:true}).click();
  await page.getByRole('button',{name:/保存中|保存更改/}).waitFor({state:'hidden'});
  await until(async()=>{const b=(await h.call('state')).bots.find(b=>b.id===bot.id);assert.equal(b.model,model.ref);assert.equal(b.effort,effort.id);});
  await back();await page.getByLabel(`给 ${bot.name} 发消息`,{exact:true}).waitFor();await back();
  const group=(await h.call('state')).rooms[0];await visible(group.name).click();
  await page.getByRole('button',{name:`${group.name} 的信息`,exact:true}).click();
  await page.getByLabel('群组名称',{exact:true}).waitFor();await page.getByRole('button',{name:'管理员',exact:true}).waitFor();
  await page.getByLabel('公告',{exact:true}).fill('隔离测试群公告');await capture('04-group-edit');
  await page.getByRole('button',{name:'保存群组',exact:true}).click();
  await until(async()=>assert.equal((await h.call('state')).rooms.find(g=>g.id===group.id).notice,'隔离测试群公告'));
  await page.getByLabel(`给 ${group.name} 发消息`,{exact:true}).waitFor();
  check('four Chinese model/group/settings captures and canonical writes use isolated zh directory');
};
