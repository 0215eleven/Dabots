// Real routes and public disposable DSH fixture; run through ds-isolated-host.cjs.
const assert=require('node:assert/strict');
const createChat=require('./create-chat.cjs');
module.exports=async function({page,h,bot,visible,back,check,until,capture}){
  const settings=()=>page.getByRole('button',{name:/^(Settings|设置)$/,exact:true});
  const appearance=()=>page.locator('select').filter({has:page.locator('option[value="dark"]')});
  async function canvas(){return page.evaluate(()=>{
    const heading=[...document.querySelectorAll('[role="heading"]')].find(e=>e.textContent==='Settings'||e.textContent==='MyBot'||e.textContent==='设置');
    const key=heading&&Object.keys(heading).find(k=>k.startsWith('__reactFiber$'));
    let fiber=key&&heading[key], themes=[];
    for(;fiber;fiber=fiber.return){
      for(let c=fiber.dependencies?.firstContext;c;c=c.next){const v=c.memoizedValue;
        if(v&&typeof v.dark==='boolean'&&v.colors?.card&&v.colors?.background&&v.fonts)themes.push({component:fiber.type?.name??fiber.type?.displayName??'',dark:v.dark,colors:v.colors});
      }
    }
    return {body:getComputedStyle(document.body).backgroundColor,html:getComputedStyle(document.documentElement).backgroundColor,scheme:getComputedStyle(document.documentElement).colorScheme,themes};
  });}
  async function expectCanvas(background,rgb,dark){
    await until(async()=>{
      const value=await canvas();
      assert.equal(value.body,rgb,'underlying window/body must follow phone appearance');
      assert.equal(value.html,rgb,'web document canvas must follow phone appearance');
      assert.equal(value.scheme,dark?'dark':'light');
      // The app navigator lives inside the layout's provider, below Expo
      // Router's outer container. Inspect the actual navigator consumer.
      const navigator=value.themes.find(t=>t.component==='StandardRouterNavigator');
      assert.ok(navigator,'inspect the actual mounted route navigator');
      assert.equal(navigator.dark,dark);assert.equal(navigator.colors.background,background);assert.equal(navigator.colors.card,background);
    });
  }
  async function widthFits(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,'no horizontal document overflow');}
  async function edges(){
    await page.mouse.move(200,500);await page.mouse.wheel(0,10000);await widthFits();
    await page.mouse.wheel(0,-10000);await widthFits();
  }
  async function homeActions(){
    const menu=settings(),plus=page.getByRole('button',{name:/^(New chat|新对话)$/,exact:true});
    const left=await menu.boundingBox(),right=await plus.boundingBox();
    assert.ok(left&&right);assert.equal(left.width,44);assert.equal(left.height,44);assert.equal(left.x,16);
    assert.equal(right.width,44);assert.equal(right.height,44);assert.equal(right.x,330);assert.equal(left.y,right.y);
    assert.ok(left.y<100,'navigation stays at the top, with no floating bottom action');
    assert.equal(await menu.locator('svg[viewBox="0 0 24 24"]').count(),1,'home information/settings uses the navigation menu icon');
    assert.equal(await page.getByRole('heading',{name:'MyBot',exact:true}).filter({visible:true}).count(),1);
  }
  await settings().focus();await page.keyboard.press('Enter');await appearance().selectOption('dark');
  await visible('Computer appearance').waitFor();await expectCanvas('#000000','rgb(0, 0, 0)',true);
  console.log('DARK_CANVAS',JSON.stringify(await canvas()));
  await edges();await back();await homeActions();await edges();await homeActions();
  check('manual dark on a light system reaches canvas and real navigator; ordinary menu/plus positions and keyboard settings work');
  await createChat(page,'Add Bot');await page.getByLabel('Bot name',{exact:true}).waitFor();
  await widthFits();await edges();await capture('form-dark');await back();await homeActions();
  await createChat(page,'New group');await page.getByLabel('Group name',{exact:true}).waitFor();await edges();await back();
  check('existing creation menu opens both real forms with dark navigation and returns once');

  await settings().click();
  const computerTheme=page.locator('select').filter({has:page.locator('option[value="paper"]')});
  await computerTheme.selectOption('paper');await expectCanvas('#1f1e1b','rgb(31, 30, 27)',true);
  await until(async()=>assert.equal((await h.call('state')).prefs.theme,'paper'));
  await appearance().selectOption('light');await expectCanvas('#faf9f5','rgb(250, 249, 245)',false);
  await page.emulateMedia({colorScheme:'dark'});await expectCanvas('#faf9f5','rgb(250, 249, 245)',false);
  await appearance().selectOption('system');await expectCanvas('#1f1e1b','rgb(31, 30, 27)',true);
  await page.emulateMedia({colorScheme:'light'});await expectCanvas('#faf9f5','rgb(250, 249, 245)',false);
  await computerTheme.selectOption('deepseek');await expectCanvas('#ffffff','rgb(255, 255, 255)',false);
  await back();await homeActions();await capture('home-light');
  check('custom DSH palette, explicit light on dark system, and System appearance update navigation and canvas without reload');

  for(let i=0;i<9;i++)await h.call('create-bot',{name:`Scroll check ${i}`,role:'Isolated layout check'});
  await visible('Scroll check 8').scrollIntoViewIfNeeded();await edges();
  await settings().click();await appearance().selectOption('dark');
  const language=page.locator('select').filter({has:page.locator('option[value="zh"]')});
  await language.selectOption('zh');await visible('电脑外观').waitFor();await expectCanvas('#000000','rgb(0, 0, 0)',true);
  await capture('settings-dark','zh');await back();await homeActions();
  await until(async()=>assert.ok(await visible(bot.name).evaluate(el=>{let opacity=1;for(let n=el;n;n=n.parentElement)opacity*=Number(getComputedStyle(n).opacity);return opacity;})>.99));
  await capture('home-dark','zh');
  await visible(bot.name).click();
  const text='滚动布局检查，保留正常换行。'.repeat(60);
  await page.getByLabel(`给 ${bot.name} 发消息`,{exact:true}).fill(text);
  await page.getByRole('button',{name:'发送消息',exact:true}).click();
  await until(async()=>assert.ok(JSON.stringify(await h.op('test.session-history',{sessionId:bot.sessionId})).includes(text)),30000);
  await edges();await capture('chat-dark','zh');await back();await homeActions();
  check('Chinese dark home with long roster, long chat, and settings scroll at both ends without document overflow');

  await settings().click();await visible('配对电脑').click();
  const returnButton=page.getByRole('button',{name:'返回我的电脑',exact:true});
  for(const size of [{width:390,height:844},{width:375,height:667},{width:844,height:390}]){
    await page.setViewportSize(size);const b=await returnButton.boundingBox();
    assert.ok(b&&b.y>=0&&b.y+b.height<=size.height&&b.width>=44&&b.height>=44,'return is in the initial viewport, independent of scrolling');
    assert.equal(await page.locator('textarea').inputValue(),'','screenshots must not contain a pairing ticket');
    const pairingHeader=page.getByText('添加另一台电脑。',{exact:true}).locator('..');
    assert.equal(await pairingHeader.locator('svg').count(),0,'no decorative robot above the pairing form (exclude retained underlying home)');
    await edges();await returnButton.focus();await widthFits();
  }
  await page.setViewportSize({width:390,height:844});await capture('pairing-dark','zh');
  // Exercise the existing waiting/cancel path without approving or replacing the
  // active host; no screenshot is taken while the disposable ticket is present.
  const code=await h.op('pairing.create');await page.locator('textarea').fill(JSON.stringify({...code,url:h.p.url}));
  await page.getByRole('switch').check();await page.getByRole('button',{name:'连接我的主机',exact:true}).click();
  await until(async()=>assert.ok((await h.op('status')).pending.length));
  assert.equal(await returnButton.isDisabled(),true);
  await page.getByRole('button',{name:'取消配对',exact:true}).click();await until(async()=>assert.equal(await returnButton.isEnabled(),true));
  await page.locator('textarea').fill('');await returnButton.focus();await page.keyboard.press('Enter');
  await visible('电脑外观').waitFor();await back();await visible(bot.name).waitFor();await homeActions();
  check('pairing return remains visible on phone/compact/landscape; waiting stays guarded, cancel preserves the existing computer');
  await settings().click();await appearance().selectOption('light');await language.selectOption('en');await back();await homeActions();
  await visible(bot.name).click();await edges();await capture('chat-light');await back();
  await settings().click();await visible('Pair a computer').click();
  await page.getByRole('button',{name:'Back to my computers',exact:true}).waitFor();await capture('pairing-light');
  check('light-mode chat and pairing remain usable after Chinese/dark round trip');
};
