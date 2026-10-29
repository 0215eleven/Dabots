import test from 'node:test';
import * as devices from '../src/logic/devices.ts';
import * as hosts from '../src/logic/hosts.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { selectConversation } from '../src/logic/app-navigation.ts';
import { mobileActionAllowed, mobilePanelAllowed, BRIDGE_UNAVAILABLE } from '../src/logic/mobile-access.ts';
import { supportsMobileAction } from '../src/logic/mobile-capabilities.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const minimal = { groups: true, actions: [] };

test('conversation fallback handles an empty team, a removed selection, chief and classic agents', () => {
  const bot = {id:'bot:a',kind:'bot',sessionId:'s1'} as any;
  const room = {id:'room:r',kind:'room'} as any;
  const agent = {id:'agent:x',kind:'agent',sessionId:'s2'} as any;
  assert.equal(selectConversation([], 'missing', false), undefined);
  assert.equal(selectConversation([], '', true), undefined);
  assert.equal(selectConversation([room,bot,agent], 'missing', false, 's1'), bot);
  assert.equal(selectConversation([room,bot], 'missing', false, 'removed'), room);
  assert.equal(selectConversation([room,bot,agent], '', true), agent);
  assert.equal(selectConversation([room,bot], '', true), undefined);
  assert.equal(selectConversation([room,bot,agent], room.id, false, 's1'), room);
  // A just-opened or removed Agent conversation never falls back to another chat.
  assert.equal(selectConversation([room,bot,agent], 'agent:x:new-session', false, 's1'), undefined);
  assert.equal(selectConversation([room,bot,agent], 'agent:y:s3', true), undefined);
  assert.equal(selectConversation([room,bot,agent], agent.id, false, 's1'), agent);
});

function mountComponent(file: string, mocks: Record<string, unknown>, exportName = file.split('/').at(-1)!) {
  const effects: Array<() => unknown> = [];
  const state: unknown[] = [];
  let cursor = 0;
  const react = {
    createElement(type: unknown, props: any, ...children: unknown[]) { return {type,props:{...props,children}}; },
    useState(initial: any) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], (value: any) => {state[index] = typeof value === 'function' ? value(state[index]) : value;}];
    },
    useEffect(fn: () => unknown) { effects.push(fn); },
    useRef(value: unknown) { return {current:value}; },
  };
  const module = {exports:{} as any};
  const source = readFileSync(new URL('../src/' + file + '.tsx', import.meta.url), 'utf8');
  const output = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  runInNewContext(output, {module,exports:module.exports,URL,require(name: string) {
    if (name === 'react') return react;
    if (name in mocks) return mocks[name];
    throw new Error('Unexpected component import: ' + name);
  }});
  return {
    render(props: any) {cursor=0;return module.exports[exportName](props);},
    async runEffects() {for (const effect of effects.splice(0)) effect();await Promise.resolve();},
  };
}
function elements(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...elements(tree.props?.children)];
}
const ui = Object.fromEntries(['ListRow','Button','Field','Icon','IconButton','Label','Notice','PageHeader','Section','SettingRow','Sheet','Tag','ToggleRow','styles'].map(key=>[key,key==='styles'?{}:key]));
Object.assign(ui, {useBottomClearance:()=>24, DOCK_HEIGHT:56, dockBottom:()=>26});
const sharedMocks = {
  'react-native':{Text:'Text',View:'View',ScrollView:'ScrollView',StyleSheet:{hairlineWidth:1}},
  '../components/Motion':{AnimatedPressable:'Pressable',PageTransition:'PageTransition'},
  '../theme':{useTheme:()=>({})},
  '../i18n':{useI18n:()=>({tr:(value:string)=>value})},
  '../logic/mobile-access':{mobileActionAllowed,mobilePanelAllowed,BRIDGE_UNAVAILABLE},
  '../logic/mobile-capabilities':{supportsMobileAction},
  '../components/UI':ui,'../components/Glass':{EdgeFade:'EdgeFade',Glass:'Glass'},'../components/AvatarEditor':{AvatarEditor:'AvatarEditor'},'../components/MyAvatar':{MyAvatar:'MyAvatar',meAsBot:()=>({}),resetMyLook(){},updateMyLook(){},useMyLook:()=>({})},'../logic/devices':devices,'../logic/hosts':hosts,
  '../components/BotAvatar':{BotAvatar:'BotAvatar',RoomAvatar:'RoomAvatar',defaultColor:()=>'',defaultShape:()=>''},
  '../components/WorkingFolderPicker':{WorkingFolderPicker:'WorkingFolderPicker'},
  '../components/ThinkingLevelPicker':{ThinkingLevelPicker:'ThinkingLevelPicker'},
  '../components/ApprovalCards':{ApprovalCards:'ApprovalCards'},
  '../components/GroupProgress':{GroupProgress:'GroupProgress'},
  '../features':{MemoryPanel:'MemoryPanel',SchedulesPanel:'SchedulesPanel'},
  '../host-settings/CapabilitiesPanel':{BotCapabilities:'BotCapabilities'},
  '../types':{errorText:String},
};

function mountCreation(kind: 'bot' | 'group') {
  const insets = { top: 47, bottom: 34, left: 0, right: 0 };
  let closed = 0;
  const mounted = mountComponent('screens/CreationScreen', {
    ...sharedMocks,
    'react-native': { ...sharedMocks['react-native'], KeyboardAvoidingView: 'KeyboardAvoidingView', TextInput: 'TextInput', Platform: { OS: 'ios' }, BackHandler: { addEventListener: () => ({ remove() {} }) } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => insets },
    '../components/BotAvatar': { BotAvatar: 'BotAvatar', botColor: () => '#000000', characterColors: ['blue'], characterShapes: ['gumdrop'], characters: { gumdrop: { label: 'Gumdrop' } } },
  });
  const props = {
    kind, client: {}, team: { mobileCapabilities: { actions: ['create-bot', 'create-room'] }, bots: [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }], rooms: [], models: [] },
    online: true, refresh: async () => {}, openConversation() {}, onClose: () => { closed++; },
  };
  return { insets, render: () => elements(mounted.render(props)), closed: () => closed };
}

test('Bot creation keeps its fixed action above the current home indicator and closes normally', () => {
  const screen = mountCreation('bot');
  for (const bottom of [0, 34, 21, 0]) {
    screen.insets.bottom = bottom;
    const nodes = screen.render();
    const footer = nodes.find(node => node.type === 'View' && node.props.children.some((child: any) => child?.props?.accessibilityLabel === 'Create'));
    assert.equal(footer.props.style.paddingBottom, bottom + 14);
    assert.equal(nodes.find(node => node.type === 'KeyboardAvoidingView').props.keyboardVerticalOffset, screen.insets.top);
  }
  screen.render().find(node => node.type === 'IconButton' && node.props.label === 'Close').props.onPress();
  assert.equal(screen.closed(), 1);
});

test('group creation preserves safe bottom space and selection when returning from details', () => {
  const screen = mountCreation('group');
  for (let index = 0; index < 2; index++) {
    const nodes = screen.render();
    assert.equal(nodes.find(node => node.type === 'ScrollView').props.contentContainerStyle.paddingBottom, screen.insets.bottom + 32);
    nodes.filter(node => node.props.accessibilityRole === 'checkbox')[index].props.onPress();
  }
  let nodes = screen.render();
  const next = nodes.find(node => node.props.accessibilityLabel === 'Next');
  assert.equal(next.props.disabled, false);
  next.props.onPress();
  for (const bottom of [34, 0, 21]) {
    screen.insets.bottom = bottom;
    nodes = screen.render();
    assert.equal(nodes.find(node => node.type === 'ScrollView').props.contentContainerStyle.paddingBottom, bottom + 20);
    assert.equal(nodes.find(node => node.type === 'Button' && node.props.title === 'Create group').props.disabled, false);
  }
  nodes.find(node => node.type === 'IconButton' && node.props.label === 'Back').props.onPress();
  nodes = screen.render();
  assert.equal(screen.closed(), 0);
  assert.equal(nodes.find(node => node.type === 'ScrollView').props.contentContainerStyle.paddingBottom, screen.insets.bottom + 32);
  assert.equal(nodes.filter(node => node.props.accessibilityRole === 'checkbox' && node.props.accessibilityState.checked).length, 2);
  nodes.find(node => node.type === 'IconButton' && node.props.label === 'Close').props.onPress();
  assert.equal(screen.closed(), 1);
});

test('the home dock opens Settings and searches without navigating', async () => {
  const calls: unknown[] = [];
  const mounted=mountComponent('components/HomeDock', {
    'react-native':{View:'View',TextInput:'TextInput',Keyboard:{dismiss:()=>calls.push('dismiss')}},
    'react-native-keyboard-controller':{KeyboardStickyView:'KeyboardStickyView'},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({bottom:34})},
    './UI':ui, './Glass':{Glass:'Glass',EdgeFade:'EdgeFade'}, './Motion':{AnimatedPressable:'Pressable'}, './MyAvatar':{MyAvatar:'MyAvatar'},
    '../theme':sharedMocks['../theme'], '../i18n':sharedMocks['../i18n'],
  });
  const nodes=elements(mounted.render({query:'',onQuery:(value:string)=>calls.push(['query',value]),onSettings:()=>calls.push('settings')}));
  const settings=nodes.find(node=>node.type==='Pressable' && node.props.accessibilityLabel==='Settings');
  assert.ok(nodes.some(node=>node.type==='MyAvatar'));
  assert.ok(settings.props.style({pressed:false}).height>=44);
  nodes.find(node=>node.type==='TextInput').props.onChangeText('ada');
  settings.props.onPress();
  assert.deepEqual(calls, [['query','ada'],'dismiss','settings']);
});

test('the computer pill opens the switcher and saved computer rows pass the selected host', () => {
  const calls: unknown[] = [];
  const mocks = {
    'react-native': sharedMocks['react-native'], './Motion': sharedMocks['../components/Motion'],
    './Glass': sharedMocks['../components/Glass'], './UI': ui, '../theme': sharedMocks['../theme'],
    '../i18n': sharedMocks['../i18n'], '../logic/hosts': hosts,
  };
  const home = { slot: 'home', serverId: 'home-server', url: 'https://home.invalid', name: 'Home' };
  const office = { slot: 'office', serverId: 'office-server', url: 'https://office.invalid', name: 'Office' };
  const pill = mountComponent('components/HostSwitcher', mocks, 'HostPill');
  elements(pill.render({ name: home.name, online: true, onPress: () => calls.push('show') }))
    .find(node => node.type === 'Pressable').props.onPress();
  const sheet = mountComponent('components/HostSwitcher', mocks, 'HostSheet');
  const nodes = elements(sheet.render({ visible: true, hosts: [home, office], current: home, online: true,
    onSwitch: (value: unknown) => calls.push(value), onAdd: () => calls.push('add'), onClose() {}, onRemove() {} }));
  const other = nodes.find(node => node.type === 'Pressable' && node.props.accessibilityLabel === 'Switch to {name}');
  assert.equal(other.props.disabled, false);
  other.props.onPress();
  nodes.find(node => node.type === 'Pressable' && node.props.accessibilityLabel === 'Add a computer').props.onPress();
  assert.deepEqual(calls, ['show', office, 'add']);
});

test('minimal bridge team mounts readable profiles without actions or editable management fields', async () => {
  const calls: string[] = [];
  let opened='';
  const mounted=mountComponent('screens/TeamScreen',sharedMocks);
  const props={
    client:{action:async(name:string)=>{calls.push(name);return {};}},
    team:{mobileCapabilities:minimal,bots:[{id:'a',name:'Alice',role:'Writer'}],rooms:[],models:[]},
    online:true,refresh:async()=>{calls.push('refresh');},openConversation:(id:string)=>{opened=id;},
  };
  let nodes=elements(mounted.render(props));
  nodes.find(node=>node.type==='ListRow' && node.props.title==='Alice').props.onPress();
  nodes=elements(mounted.render(props));
  await mounted.runEffects();
  assert.deepEqual(calls, []);
  assert.equal(nodes.some(node=>node.type==='Field'), false);
  assert.equal(nodes.some(node=>node.type==='WorkingFolderPicker'), false);
  assert.equal(nodes.some(node=>node.type==='Label' && node.props.children.includes('Alice')), true);
  nodes.find(node=>node.type==='Button' && node.props.title==='Open chat').props.onPress();
  assert.equal(opened,'a');
  assert.deepEqual(calls, []);
});

test('team management fields appear only with the independent management capability', () => {
  for (const capabilities of [minimal, {botManagement:true}, {botManagement:true,actions:[]}, {actions:['update-bot']}]) {
    const mounted=mountComponent('screens/TeamScreen',sharedMocks);
    const tree=mounted.render({client:{},team:{mobileCapabilities:capabilities,bots:[{id:'a',name:'Alice'}],rooms:[],models:[]},initialId:'a',online:true});
    assert.equal(elements(tree).some(node=>node.type==='Field'), mobileActionAllowed(capabilities,'update-bot'));
  }
});


test('native team page callbacks push a profile without changing the retained list page', () => {
  const calls: unknown[] = [];
  const mounted = mountComponent('screens/TeamScreen', sharedMocks);
  const props = {
    client: {}, team: { mobileCapabilities: minimal, bots: [{ id: 'a', name: 'Alice' }], rooms: [], models: [] },
    online: true, onNavigatePage: (...args: unknown[]) => calls.push(args),
  };
  let nodes = elements(mounted.render(props));
  nodes.find(node => node.type === 'ListRow' && node.props.title === 'Alice').props.onPress();
  assert.deepEqual(calls, [['bot', 'a', 'bots']]);
  nodes = elements(mounted.render(props));
  assert.equal(nodes.find(node => node.type === 'PageHeader').props.left.props.section, 'bots');
  assert.equal(nodes.some(node => node.type === 'Button' && node.props.title === 'Open chat'), false);
  let pops = 0;
  const profile = mountComponent('screens/TeamScreen', sharedMocks);
  const tree = profile.render({ ...props, initialId: 'a', initialPage: 'model', onBack: () => { pops++; } });
  elements(tree).find(node => node.type === 'PageHeader').props.onBack();
  assert.equal(pops, 1);
  assert.equal(calls.length, 1);
});

test('Settings delegates Appearance and tools children to native routes and its header pops', () => {
  const mocks = {
    ...sharedMocks,
    '../features': { UsagePanel: 'UsagePanel', SchedulesPanel: 'SchedulesPanel' },
    '../host-settings/AboutPanel': { AboutPanel: 'AboutPanel' },
    '../host-settings/PluginUpdateCard': { PluginUpdateCard: 'PluginUpdateCard' },
    '../host-settings/CapabilitiesPanel': { CapabilitiesPanel: 'CapabilitiesPanel' },
    '../host-settings/SkillsPanel': { SkillsPanel: 'SkillsPanel' },
    '../host-settings/PluginsPanel': { PluginsPanel: 'PluginsPanel' },
    '../components/NotificationsPanel': { NotificationsPanel: 'NotificationsPanel' },
    '../host-settings/HostSettingsPanel': { HostSettingsPanel: 'HostSettingsPanel' },
    '../storage': {}, '../theme': { useTheme: () => ({}), THEMES: {}, useColorMode: () => 'system', setColorMode: () => {} },
    '../components/BotAvatar': { inks: Object.fromEntries(['deepseek', 'charcoal', 'graphite', 'rose', 'sky', 'tangerine', 'cobalt'].map(name => [name, ['#000000', '#ffffff']])) },
  };
  const calls: string[] = [];
  const props = { client: {}, host: { url: 'https://fixture.invalid' }, team: { mobileCapabilities: { skills: true }, prefs: {}, bots: [], rooms: [] }, online: true, onNavigatePage: (page: string) => calls.push(page) };
  const mounted = mountComponent('screens/SettingsScreen', mocks);
  let nodes = elements(mounted.render(props));
  nodes.find(node => node.type === 'SettingRow' && node.props.title === 'Appearance').props.onPress();
  assert.deepEqual(calls, ['general']);
  nodes = elements(mounted.render(props));
  assert.equal(nodes.some(node => node.type === 'SettingRow' && node.props.title === 'Appearance'), true);
  const tools = mountComponent('screens/SettingsScreen', mocks);
  nodes = elements(tools.render({ ...props, initialPage: 'tools' }));
  nodes.find(node => node.type === 'SettingRow' && node.props.title === 'Skills').props.onPress();
  assert.deepEqual(calls, ['general', 'skills']);
  let pops = 0;
  const appearance = mountComponent('screens/SettingsScreen', mocks);
  nodes = elements(appearance.render({ ...props, initialPage: 'general', onBack: () => { pops++; } }));
  nodes.find(node => node.type === 'PageHeader').props.onBack();
  assert.equal(pops, 1);
  assert.deepEqual(calls, ['general', 'skills']);
  // Classic Agent mode is offered only when the computer gives the phone Agents,
  // and as a phone-only preference it never waits on the host.
  const classicRow = (nodes: any[]) => nodes.find(node => node.type === 'SettingRow' && node.props.title === 'Classic Agent mode');
  const index = mountComponent('screens/SettingsScreen', mocks);
  assert.equal(classicRow(elements(index.render({ ...props, online: false, classicAvailable: false }))), undefined);
  const row = classicRow(elements(index.render({ ...props, online: false, classicAvailable: true })));
  assert.ok(row);
  assert.equal(elements(row).find(node => node.props && 'value' in node.props).props.disabled, undefined);
});
