import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHostClients } from '../src/session/host-clients.ts';
import { createHostTransitions } from '../src/session/host-transitions.ts';
import { activeHost, hostKey, removeHost, restoreHosts, upsertHost } from '../src/logic/hosts.ts';

const require = createRequire(import.meta.url), { transformSync } = require('esbuild');
const noop = () => {};
const office = { url: 'https://office.invalid', serverId: 'A', name: 'Office', slot: 'a' };
const home = { url: 'https://home.invalid', serverId: 'B', name: 'Home', slot: 'b' };
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

// Render the real provider with deterministic React hooks and injected native IO.
// No copy of its switch/pair/remove logic participates in these assertions.
function hooks() {
  let cursor = 0;
  const slots: any[] = [], effects: (() => void)[] = [];
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    createContext: () => ({ Provider: 'Provider' }), useContext: () => null,
    useState(initial: any) {
      const n = cursor++;
      slots[n] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[n].value, (value: any) => { slots[n].value = typeof value === 'function' ? value(slots[n].value) : value; }];
    },
    useRef(initial: any) { const n = cursor++; return slots[n] ??= { current: initial }; },
    useMemo(factory: any, deps: unknown[]) {
      const n = cursor++;
      if (!same(slots[n]?.deps, deps)) slots[n] = { value: factory(), deps };
      return slots[n].value;
    },
    useCallback(factory: any, deps: unknown[]) { return this.useMemo(() => factory, deps); },
    useEffect(effect: any, deps: unknown[]) {
      const n = cursor++;
      if (same(slots[n]?.deps, deps)) return;
      const previous = slots[n];
      slots[n] = { deps };
      effects.push(() => { previous?.cleanup?.(); slots[n].cleanup = effect(); });
    },
    useLayoutEffect: noop, memo: (value: any) => value,
  };
  // Hooks are imported as ordinary functions by esbuild.
  react.useCallback = (factory: any, deps: unknown[]) => react.useMemo(() => factory, deps);
  return {
    react,
    render<T>(run: () => T) { cursor = 0; const value = run(); while (effects.length) effects.shift()!(); return value; },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
function load(path: string, react: any, mocks: Record<string, any>) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'transform' }).code;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', 'React', code)((name: string) => name === 'react' ? react : mocks[name] ?? new Proxy({}, { get: () => noop }), module, module.exports, react);
  return module.exports;
}
function fixture() {
  const h = hooks(), store = new Map<string, any>([['app:hosts', [office, home]], ['app:activeHost', office.slot]]);
  const opened: any[] = [], writes: any[] = [], credentials: any[] = [], navigations: any[] = [];
  let openGate: ((host: typeof office) => Promise<void>) | null = null;
  let writeGate: ((scope: string, key: string, value: any) => Promise<void>) | null = null;
  const clients = createHostClients(async host => {
    await openGate?.(host as typeof office);
    const client = { serverId: host.serverId, disposed: 0, logouts: 0, dispose() { this.disposed++; }, async logout() { this.logouts++; } };
    opened.push(client);
    return client as any;
  });
  const workspace = { team: { prefs: {}, mobileCapabilities: {} }, conversations: [], online: true, refresh: noop, refreshSnapshot: noop };
  const router = { push: (value: any) => navigations.push(value), canDismiss: () => false, dismissAll: noop };
  const cache = {
    readCache: async (scope: string, key: string) => store.get(`${scope}:${key}`) ?? null,
    writeCache: async (scope: string, key: string, value: any) => {
      await writeGate?.(scope, key, value);
      writes.push([scope, key, value]); store.set(`${scope}:${key}`, value);
    },
    clearCache: async (scope: string) => { credentials.push(['cache', scope]); },
    tokenStoreFor: (slot: string) => ({ get: async () => ({ serverId: slot === 'a' ? 'A' : 'B' }), clear: async () => { credentials.push(['token', slot]); } }),
  };
  const mocks = {
    'react-native': { AppState: { currentState: 'active' } }, 'expo-router': { useRouter: () => router }, 'expo-crypto': { randomUUID: () => 'synthetic-test-slot' },
    '../hooks/useWorkspace': { useWorkspace: () => workspace }, '../hooks/useNotifications': { useNotifications: noop },
    '../connection/hub': { createConnectionHub: () => ({ start: noop, stop: noop }) },
    '../outbox/outbox': { createOutbox: () => ({ load: async () => {}, resume: async () => {}, dispose: noop }) },
    '../logic/conversation-streams': { conversationStreams: { clear: noop, reconnectAll: noop }, watchConversationStreamLifecycle: () => noop },
    '../logic/hosts': { activeHost, hostKey, removeHost, restoreHosts, upsertHost },
    '../liveactivity/controller': { endBotActivity: async () => {}, syncBotActivity: noop },
    '../media/notifications': { notificationArrivals: noop, notificationResponses: () => noop },
    '../media/background-notifications': { stopBackgroundNotifications: async () => {} },
    '../logic/mobile-access': { mobileActionAllowed: () => false }, '../storage': cache,
    '../theme': { setColorMode: noop, setThemePreferences: noop }, '../i18n': { setHostLocale: noop, setLocalePreference: noop },
    '../types': { errorText: (error: Error) => error.message }, '../outbox/store': { createDurableOutboxStore: () => ({}) },
    './shared-host-clients': { hostClients: clients }, './host-transitions': { createHostTransitions },
    '../preview/enabled-fixture': { enabledFixture: false }, '../preview/preview-session': { designPreview: false },
  };
  const { SessionProvider } = load('../src/session/SessionProvider.tsx', h.react, mocks);
  let value: any;
  const render = () => value = h.render(() => SessionProvider({ children: null }).props.value);
  async function tick() { await new Promise<void>(resolve => setImmediate(resolve)); return render(); }
  async function ready() { for (let i = 0; i < 20; i++) { await tick(); if (!value.loading) return; } assert.fail('provider restore did not settle'); }
  render();
  return { ready, tick, render, unmount: h.unmount, clients, get value() { return value; }, store, writes, credentials, opened, navigations,
    blockOpen(gate: typeof openGate) { openGate = gate; }, blockWrite(gate: typeof writeGate) { writeGate = gate; } };
}

test('different switch intents cannot overlap a credential read; duplicate intents share one lease', async () => {
  const f = fixture(); await f.ready();
  const gate = deferred(); f.blockOpen(host => host.serverId === 'B' ? gate.promise : Promise.resolve());
  const first = f.value.switchHost(home), duplicate = f.value.switchHost(home);
  assert.equal(first, duplicate);
  await f.tick();
  assert.equal(f.value.switching, true);
  assert.equal(await f.value.switchHost(office), false, 'a conflicting request cannot overtake the pending transaction');
  assert.equal(f.value.host.serverId, 'A');
  assert.equal(f.store.get('app:activeHost'), 'a');
  gate.resolve(); assert.equal(await first, true); await f.tick();
  assert.equal(f.value.host.serverId, 'B'); assert.equal(f.store.get('app:activeHost'), 'b');
  assert.equal(f.opened.filter(client => client.serverId === 'B').length, 1);
  assert.equal(f.opened[0].disposed, 1, 'the old active lease is released after the new client is rendered');
  f.unmount(); assert.equal(f.opened[1].disposed, 1);
});

test('cold-start restore excludes pairing, removal and switching until the saved client is ready', async () => {
  const f = fixture(), gate = deferred();
  f.blockOpen(host => host.serverId === 'A' ? gate.promise : Promise.resolve());
  await f.tick(); assert.equal(f.value.loading, true);
  assert.equal(await f.value.switchHost(home), false);
  await assert.rejects(f.value.connected(home, {}), /already in progress/);
  await assert.rejects(f.value.forgetHost(home), /already in progress/);
  await assert.rejects(f.value.disconnect(), /already in progress/);
  assert.deepEqual(f.credentials, []); assert.deepEqual(f.writes, []);
  gate.resolve(); await f.ready();
  assert.equal(f.value.host.serverId, 'A'); assert.equal(f.store.get('app:activeHost'), 'a');
  assert.equal(await f.value.switchHost(home), true); await f.tick();
  assert.equal(f.value.host.serverId, 'B'); assert.equal(f.store.get('app:activeHost'), 'b'); f.unmount();
});

test('an intent during a pending activeHost write cannot cause a compensating-write failure or cache mismatch', async () => {
  const f = fixture(); await f.ready();
  const gate = deferred(), entered = deferred();
  f.blockWrite(async (scope, key, value) => { if (scope === 'app' && key === 'activeHost' && value === 'b') { entered.resolve(); await gate.promise; } });
  const switched = f.value.switchHost(home); await entered.promise;
  assert.equal(await f.value.switchHost(office), false);
  gate.resolve(); assert.equal(await switched, true); await f.tick();
  assert.equal(f.value.host.serverId, 'B'); assert.equal(f.store.get('app:activeHost'), 'b');
  assert.deepEqual(f.writes.filter(row => row[1] === 'activeHost'), [['app', 'activeHost', 'b']], 'there is no restore write that can fail independently');
  f.unmount();
});

for (const failure of ['credentials', 'storage']) test(`a ${failure} failure preserves the actual computer, cache and client ownership`, async () => {
  const f = fixture(); await f.ready();
  if (failure === 'credentials') f.blockOpen(async host => { if (host.serverId === 'B') throw Error('synthetic credential failure'); });
  else f.blockWrite(async (_scope, key) => { if (key === 'activeHost') throw Error('synthetic storage failure'); });
  assert.equal(await f.value.switchHost(home), false); await f.tick();
  assert.equal(f.value.host.serverId, 'A'); assert.equal(f.store.get('app:activeHost'), 'a'); assert.equal(f.value.switching, false);
  assert.match(f.value.error, /synthetic/);
  assert.equal(f.opened[0].disposed, 0);
  if (failure === 'storage') assert.equal(f.opened[1].disposed, 1, 'an acquired but uncommitted lease is released');
  f.unmount();
});

test('disconnect, forget and pairing refuse overlap before touching credentials or storage', async () => {
  const f = fixture(); await f.ready();
  const gate = deferred(); f.blockOpen(host => host.serverId === 'B' ? gate.promise : Promise.resolve());
  const switched = f.value.switchHost(home); await f.tick();
  await assert.rejects(f.value.disconnect(), /already in progress/);
  await assert.rejects(f.value.forgetHost(home), /already in progress/);
  await assert.rejects(f.value.connected(home, {}), /already in progress/);
  assert.deepEqual(f.credentials, []); assert.deepEqual(f.writes, []); assert.equal(f.opened[0].logouts, 0);
  gate.resolve(); assert.equal(await switched, true); await f.tick();
  assert.equal(f.value.host.serverId, 'B'); assert.equal(f.store.get('app:activeHost'), 'b');
  f.unmount();
});

test('an unmounted provider releases a late lease without changing selection or persistent state', async () => {
  const f = fixture(); await f.ready();
  const gate = deferred(); f.blockOpen(host => host.serverId === 'B' ? gate.promise : Promise.resolve());
  const switched = f.value.switchHost(home); await f.tick(); f.unmount(); gate.resolve();
  assert.equal(await switched, false);
  assert.equal(f.store.get('app:activeHost'), 'a'); assert.equal(f.opened.at(-1).disposed, 1);
  assert.deepEqual(f.writes, []);
});

test('unmount releases a successfully committed client even before its next render/effect', async () => {
  const f = fixture(); await f.ready();
  assert.equal(await f.value.switchHost(home), true);
  // Do not render: the registered client effect still belongs to Office.
  f.unmount();
  assert.deepEqual(f.opened.map(client => client.disposed), [1, 1]);
});

test('final lease cleanup and repeated effect cleanup preserve a background watcher owner', async () => {
  const f = fixture(); await f.ready();
  const peer = await f.clients.acquire(home);
  assert.equal(await f.value.switchHost(home), true);
  f.unmount(); f.unmount();
  assert.equal((peer.client as any).disposed, 0, 'provider cleanup cannot directly dispose the shared peer client');
  assert.equal(f.opened[0].disposed, 1, 'a repeated cleanup does not dispose the old active client twice');
  peer.release(); assert.equal((peer.client as any).disposed, 1);
});

test('unmounting while disconnect is awaiting IO prevents later credential and cache changes', async () => {
  const f = fixture(); await f.ready();
  const gate = deferred(), entered = deferred();
  f.blockWrite(async (_scope, key) => { if (key === 'backgroundOptIn') { entered.resolve(); await gate.promise; } });
  const disconnected = f.value.disconnect(); await entered.promise; f.unmount(); gate.resolve(); await disconnected;
  assert.equal(f.opened[0].logouts, 0); assert.deepEqual(f.credentials, []);
  assert.deepEqual(f.writes.map(row => row[1]), ['backgroundOptIn'], 'only the write already in progress may complete');
  assert.equal(f.store.get('app:activeHost'), 'a');
});

test('a mutation queued immediately before unmount never starts credential or cache IO', async () => {
  const f = fixture(); await f.ready();
  const removed = f.value.forgetHost(home); f.unmount();
  await assert.rejects(removed, /cancelled/);
  assert.deepEqual(f.credentials, []); assert.deepEqual(f.writes, []);
});

test('pairing adoption cancelled during a write rejects so its caller can release the unadopted client', async () => {
  const f = fixture(); await f.ready(); const gate = deferred(), entered = deferred();
  f.blockWrite(async (_scope, key) => { if (key === 'hosts') { entered.resolve(); await gate.promise; } });
  const adopted = f.value.connected({ ...home, serverId: 'C', slot: 'c' }, {});
  await entered.promise; f.unmount(); gate.resolve();
  await assert.rejects(adopted, /cancelled/);
  assert.deepEqual(f.writes.map(row => row[1]), ['hosts'], 'no activeHost write follows the completed IO');
  assert.equal(f.store.get('app:activeHost'), 'a'); assert.deepEqual(f.credentials, []);
});

test('disconnect commits removal then selects the remaining computer inside the same transaction', async () => {
  const f = fixture(); await f.ready();
  await f.value.disconnect(); await f.tick();
  assert.equal(f.value.host.serverId, 'B'); assert.equal(f.store.get('app:activeHost'), 'b');
  assert.deepEqual(f.value.hosts.map((host: typeof office) => host.serverId), ['B']);
  assert.equal(f.opened[0].logouts, 1); assert.equal(f.opened[0].disposed, 1);
  assert.equal(f.value.switching, false); f.unmount();
});

test('a retained caller reads the current selection rather than a stale render of the provider', async () => {
  const f = fixture(); await f.ready(); const retained = f.value;
  assert.equal(await retained.switchHost(home), true); await f.tick();
  await retained.forgetHost(home); await f.tick();
  assert.equal(f.value.host.serverId, 'B'); assert.deepEqual(f.credentials, [], 'the actual active computer cannot be forgotten by an old callback');
  assert.equal(await retained.switchHost(office), true); await f.tick();
  assert.equal(f.value.host.serverId, 'A'); assert.equal(f.store.get('app:activeHost'), 'a'); f.unmount();
});

function homeScreen(f: ReturnType<typeof fixture>) {
  const h = hooks();
  const animation = { duration() { return this; }, reduceMotion() { return this; } };
  const { ConnectedScreen } = load('../openbot/mobile/src/features/agents/screens/connected-screen.tsx', h.react, {
    '@ds/text': { useDsText: () => ({ tr: (text: string) => text }) },
    'heroui-native/hooks': { useThemeColor: (names: any) => Array.isArray(names) ? names.map(() => '#111') : '#111' },
    'react-native': { View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'Spinner', StyleSheet: { hairlineWidth: 0.5 } },
    'react-native-reanimated': { __esModule: true, default: { FlatList: 'FlatList', View: 'AnimatedView' }, Easing: { bezier: noop }, FadeIn: animation, LinearTransition: animation, ReduceMotion: {} },
    'expo-router': { Stack: { Screen: 'Screen' }, router: { push: noop } }, 'heroui-native': { Typography: { Paragraph: 'Paragraph' } },
    '@/features/workspace/context/mobile-workspace-context': { useMobileWorkspace: () => ({ activeAgents: [{ id: `bot-${f.value.host.serverId}` }], agents: [{ id: `bot-${f.value.host.serverId}` }], activeServer: { id: f.value.host.serverId }, pinnedAgentIds: [], pinnedChannelIds: [], hiddenChannelIds: [] }) },
    '@/features/channels/components/use-channels': { useChannels: () => ({ channels: [] }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    '@/shared/components/large-title': { useLargeTitleScroll: () => ({}) }, '@ds/provider': { useDs: () => ({ view: { capabilities: { actions: ['create-bot'] } }, online: true, times: {} }) },
    '@/features/agents/components/agent-list-reveal': { useAgentListReveal: () => ({}) }, '@/shared/lib/motion': { useReducedMotion: () => true },
    '@ds/home-view': { useHomeView: () => ['list', () => {}] }, '@ds/computers': { useComputers: () => f.value, useComputerNames: () => ({ name: (host: typeof office) => host.name }), usePeerHosts: () => ({ peers: {} }), peerBotColor: () => noop, peerRows: () => [] },
    'uniwind': { useUniwind: () => ({ theme: 'light' }) }, '@/features/workspace/components/computer-tag': { ComputerTagContext: { Provider: 'TagProvider' } },
  });
  const walk = (node: any): any[] => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...Object.values(node.props ?? {}).flatMap(walk)] : [];
  return () => {
    const tree = h.render(() => ConnectedScreen()), nodes = walk(tree), list = nodes.find(node => node.type === 'FlatList');
    const chips = walk(list.props.ListHeaderComponent).filter(node => typeof node.type === 'function' && node.type.name === 'ComputerChip');
    return { nodes, chips, rows: list.props.data.map((row: any) => row.id), selected: chips.find(node => node.props.selected)?.props.label };
  };
}

test('real home labels always follow its real provider through rapid B→A, success and later failure', async () => {
  const f = fixture(); await f.ready(); const render = homeScreen(f);
  let screen = render(); screen.chips.find(node => node.props.label === 'Office').props.onPress(); assert.equal(render().selected, 'Office');
  const gate = deferred(); f.blockOpen(host => host.serverId === 'B' ? gate.promise : Promise.resolve());
  render().chips.find(node => node.props.label === 'Home').props.onPress(); await f.tick(); screen = render();
  assert.equal(screen.selected, 'Office'); assert.deepEqual(screen.rows, ['bot-A']);
  assert.ok(screen.chips.every(node => node.props.disabled));
  assert.ok(screen.nodes.some(node => node.type === 'Spinner'));
  assert.ok(screen.nodes.some(node => node.props?.label === 'Add Bot' && node.props.disabled));
  screen.chips.find(node => node.props.label === 'Office').props.onPress();
  gate.resolve(); await f.tick(); screen = render();
  assert.equal(screen.selected, 'Home'); assert.deepEqual(screen.rows, ['bot-B']);
  assert.equal(f.store.get('app:activeHost'), 'b');
  f.blockOpen(async host => { if (host.serverId === 'A') throw Error('synthetic offline'); });
  screen.chips.find(node => node.props.label === 'Office').props.onPress(); await f.tick(); screen = render();
  assert.equal(screen.selected, 'Home'); assert.deepEqual(screen.rows, ['bot-B']);
  assert.ok(screen.nodes.some(node => node.props?.accessibilityRole === 'alert' && node.props.children.includes('synthetic offline')));
  f.unmount();
});

test('the retained drawer reports a busy removal in the current locale without an unhandled rejection', async () => {
  const h = hooks(), alerts: any[] = [], message = 'A computer change is already in progress. Try again.';
  const zh = require('../src/i18n.mobile.zh.json'), tr = (value: string) => zh[value] ?? value;
  const { ServerDrawerContent } = load('../src/openbot/features/servers/components/server-drawer-content.tsx', h.react, {
    '../../../../session/SessionProvider': { useSession: () => ({ host: null, hosts: [office, home], workspace: {} , forgetHost: async () => { throw Error(message); } }) },
    '../../../../i18n': { tr }, '../../../../types': { errorText: (error: Error) => error.message },
    '../../../../logic/hosts': { hostAddress: (host: typeof office) => host.url },
    'react-native': { Alert: { alert: (...args: any[]) => alerts.push(args) }, View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView' },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' }, cubicBezier: noop },
    'heroui-native': { Typography: { Paragraph: 'Paragraph' } },
    'uniwind': { useCSSVariable: () => [] }, '@legacy/shared/lib/haptics': { haptics: { longPress: noop, selection: noop } },
    '@legacy/shared/lib/motion': { useReducedMotion: () => true }, '@legacy/shared/lib/type-scale': { typeScale: {} },
  });
  const walk = (node: any): any[] => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...Object.values(node.props ?? {}).flatMap(walk)] : [];
  const tree = h.render(() => ServerDrawerContent({ muted: '#111', open: true, topInset: 0, onClose: noop, onNavigate: noop }));
  walk(tree).find(node => node.props?.accessibilityLabel === 'Home').props.onLongPress();
  alerts[0][2].find((action: any) => action.style === 'destructive').onPress();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(alerts.at(-1)[1], '正在切换电脑，请稍后重试。');
});

test('a newly approved pairing releases its client if session adoption is refused as busy', async () => {
  const h = hooks(), message = 'A computer change is already in progress. Try again.';
  const client = { disposed: 0, baseUrl: 'https://relay.invalid', info: async () => ({ serverId: 'B' }), pair: async () => ({ claimToken: 'synthetic-claim' }), completePairing: async () => ({ accessToken: 'synthetic-access' }), dispose() { this.disposed++; } };
  const previousDev = (globalThis as any).__DEV__; (globalThis as any).__DEV__ = false;
  try {
    const { PairingScreen } = load('../src/screens/PairingScreen.tsx', h.react, {
      '../network/client': { createMobileClient: () => client }, '../i18n': { useI18n: () => ({ tr: (value: string) => value }) },
      '../theme': { useTheme: () => ({}) }, 'react-native': { View: 'View', ScrollView: 'ScrollView', Text: 'Text', Keyboard: { dismiss: noop }, Platform: { OS: 'ios' } },
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ left: 0, right: 0, bottom: 0 }) },
      '../components/PairingScanner': { PairingScanner: 'Scanner' },
      '../components/UI': { Button: 'Button', Card: 'Card', Field: 'Field', Label: 'Label', Notice: 'Notice', styles: {} },
      '../storage': { tokenStoreFor: () => ({}) }, '../logic/pairing': { parsePairing: () => ({ kind: 'relay', serverId: 'B' }) },
    });
    const render = () => h.render(() => PairingScreen({ slot: 'test', onConnected: async () => { throw Error(message); } }));
    const walk = (node: any): any[] => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...Object.values(node.props ?? {}).flatMap(walk)] : [];
    walk(render()).find(node => node.type === 'Scanner').props.onScan('synthetic-pairing');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(client.disposed, 1);
    assert.ok(walk(render()).some(node => node.type === 'Notice' && node.props.error && node.props.text === message));
    h.unmount(); assert.equal(client.disposed, 1, 'unmount does not dispose a rejected transfer twice');
  } finally { (globalThis as any).__DEV__ = previousDev; }
});
