import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const zh = JSON.parse(readFileSync(new URL('../src/i18n.ds2.zh.json', import.meta.url), 'utf8'));
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const heroButton = { Label: 'Button.Label' };

function elements(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...elements(tree.props?.children)];
}
function text(tree: any): string {
  if (typeof tree === 'string') return tree;
  if (Array.isArray(tree)) return tree.map(text).join('');
  return tree && typeof tree === 'object' ? text(tree.props?.children) : '';
}
function button(nodes: any[], title: string) {
  const found = nodes.find(node => node.type === 'Button' ? node.props.title === title
    : node.type === heroButton && text(node) === title);
  assert.ok(found, `Missing button: ${title}`);
  return found.props;
}

// Mount the real route and screen components at their native UI/network boundaries.
// The admin-relay hook is real too: an empty saved-host list must not gate setup.
function fixture({ official = 'wss://relay.invalid', locale = 'en', dark = false, paired = false } = {}) {
  const tr = (key: string) => locale === 'zh' ? zh[key] ?? key : key;
  const routes = ['/pairing'];
  const claims: string[] = [], adminRelays: string[] = [], connections: unknown[][] = [];
  const host = { name: 'Existing computer', serverId: 'existing', url: 'https://host.invalid', slot: 'existing' };
  const session = { loading: false, host: paired ? host : null, hosts: paired ? [host] : [], pairingSlot: 'new-slot',
    connected: async (...args: unknown[]) => { connections.push(args); } };
  const theme = { bg: dark ? '#111111' : '#ffffff', ink: dark ? '#ffffff' : '#111111' };
  const router = { push: (path: string) => routes.push(path), back: () => routes.pop(),
    replace: (path: string) => { routes[routes.length - 1] = path; }, canGoBack: () => routes.length > 1 };
  let claimed = false, pending = false, clientsCreated = 0;
  const client = { baseUrl: 'https://host.invalid', tlsPin: undefined, dispose() {},
    info: async () => pending ? new Promise<never>(() => {}) : { serverId: 'fixture-server', name: 'Fixture computer' },
    pair: async () => ({ claimToken: 'fixture-claim' }), completePairing: async () => ({ accessToken: 'fixture-token' }) };
  const shared: Record<string, any> = {
    'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', Switch: 'Switch',
      Platform: { OS: 'ios' }, Keyboard: { dismiss() {} }, Alert: { alert() {} } },
    'expo-router': { Redirect: 'Redirect', useRouter: () => router },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) },
    'expo-clipboard': { getStringAsync: async () => '' },
    'heroui-native': { Button: heroButton, Typography: { Paragraph: 'Paragraph' } },
    '@/features/agents/screens/connected-screen': { ConnectedScreen: 'ConnectedScreen' },
    '@/shared/components/sheet-scroll-view': { SheetScrollView: 'SheetScrollView' },
    '@/shared/components/sheet-form-field': { SheetFormField: 'SheetFormField' },
    '@/features/settings/components/settings-content': { SettingsRow: 'SettingsRow', SettingsSection: 'SettingsSection' },
    '../src/screens/PairingScreen': { PairingScreen: 'PairingScreen' },
    '../components/PairingScanner': { PairingScanner: 'PairingScanner' },
    '../components/UI': { Button: 'Button', Card: 'Card', Field: 'Field', Label: 'Label', Notice: 'Notice', styles: { page: {} } },
    '../network/client': { createMobileClient: () => { clientsCreated++; return client; } },
    '@ds-bot/mobile-sdk': { validateServerUrl: (url: string) => url },
    '../storage': { cache: {}, tokenStoreFor: () => ({}) },
    '../logic/pairing': { parsePairing: () => ({ kind: 'direct', url: client.baseUrl, serverId: 'fixture-server', code: 'fixture-code' }) },
    '../logic/build-match': { matchPairing: () => undefined },
    '../logic/relay-approve': { approveWaitingComputer: async () => {} },
    '../src/storage/admin-key': { relayAdminKey: async () => ({ publicKey: 'fixture-public-key' }) },
    '../storage/admin-key': { relayAdminKey: async () => ({ publicKey: 'fixture-public-key' }) },
    '../src/media/haptics': { errorFeedback() {}, successFeedback() {} },
    '../src/logic/relay-admin': { RelayAdminError: class extends Error {}, createRelayAdmin: ({ relay }: { relay: string }) => {
      adminRelays.push(relay);
      return { status: async () => ({ admin: claimed, claimable: !claimed }), devices: async () => ({ pending: [], approved: [] }),
        claim: async (code: string) => { claims.push(code); claimed = true; } };
    } },
  };
  for (const name of ['../src/session/SessionProvider', './SessionProvider']) shared[name] = { useSession: () => session };
  for (const name of ['../src/logic/hosts', '../logic/hosts']) shared[name] = { officialRelay: () => official || null };
  for (const name of ['../src/theme', '../theme']) shared[name] = { useTheme: () => theme };
  for (const name of ['../src/i18n', '../i18n']) shared[name] = { tr, useI18n: () => ({ tr }) };

  function mount(file: string) {
    const values: any[] = [], effects: Array<() => unknown> = [];
    let cursor = 0;
    const react = { Fragment: 'Fragment',
      createElement: (type: unknown, props: any, ...children: unknown[]) => ({ type, props: { ...props, children } }),
      useState(initial: any) { const slot = cursor++; if (!(slot in values)) values[slot] = typeof initial === 'function' ? initial() : initial;
        return [values[slot], (next: any) => { values[slot] = typeof next === 'function' ? next(values[slot]) : next; }]; },
      useRef(initial: unknown) { const slot = cursor++; return values[slot] ??= { current: initial }; },
      useCallback: (callback: unknown) => callback,
      useEffect(effect: () => unknown, deps: unknown[]) {
        const slot = cursor++;
        if (!values[slot] || deps.some((value, index) => value !== values[slot][index])) effects.push(effect);
        values[slot] = deps;
      },
    };
    function load(sourceFile: string): any {
      const module = { exports: {} as any };
      const source = readFileSync(new URL(sourceFile, import.meta.url), 'utf8');
      const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
      runInNewContext(output, { module, exports: module.exports, React: react, __DEV__: false, setTimeout, require(name: string) {
        if (name === 'react') return react;
        if (name === '../src/session/admin-relay') return load('../src/session/admin-relay.ts');
        if (name in shared) return shared[name];
        throw new Error(`Unexpected component import: ${name}`);
      } });
      return module.exports;
    }
    const component = load(file);
    return { render(props?: unknown) { cursor = 0; return (component.default ?? component.PairingScreen)(props); },
      async flush() { for (const effect of effects.splice(0)) effect(); await tick(); } };
  }
  const index = mount('../app/index.tsx'), route = mount('../app/pairing.tsx'), pairing = mount('../src/screens/PairingScreen.tsx');
  const admin = mount('../app/relay-admin.tsx');
  const pairingNodes = () => {
    const props = elements(route.render()).find(node => node.type === 'PairingScreen').props;
    return elements(pairing.render(props));
  };
  return { tr, theme, routes, claims, adminRelays, connections, session, index, admin, pairingNodes,
    adminNodes: () => elements(admin.render()), clientsCreated: () => clientsCreated, setPending: () => { pending = true; } };
}

for (const locale of ['en', 'zh']) for (const dark of [false, true]) {
  test(`a fresh ${locale} phone (${dark ? 'dark' : 'light'}) claims the official relay and returns to its pairing draft`, async () => {
    const f = fixture({ locale, dark });
    assert.equal(f.index.render().props.href, '/pairing');
    let nodes = f.pairingNodes();
    assert.equal(nodes[0].props.style.backgroundColor, f.theme.bg);
    nodes.find(node => node.type === 'Field' && node.props.label !== f.tr('Device name')).props.onChangeText('saved pairing draft');
    button(nodes, f.tr('Relay admin')).onPress();
    assert.deepEqual(f.routes, ['/pairing', '/relay-admin']);
    f.adminNodes(); await f.admin.flush();
    nodes = f.adminNodes();
    assert.deepEqual(f.adminRelays, ['wss://relay.invalid']);
    nodes.find(node => node.type === 'SheetFormField').props.onChangeText('fixture-bootstrap-code');
    nodes = f.adminNodes();
    const claim = button(nodes, f.tr('Become the admin'));
    assert.equal(claim.isDisabled, false);
    claim.onPress(); await tick();
    assert.deepEqual(f.claims, ['fixture-bootstrap-code']);
    button(f.adminNodes(), f.tr('Back to pairing')).onPress();
    assert.deepEqual(f.routes, ['/pairing']);
    assert.ok(f.pairingNodes().some(node => node.type === 'Field' && node.props.value === 'saved pairing draft'));
    assert.deepEqual(f.session.hosts, []);
    assert.equal(f.connections.length, 0);
    assert.equal(f.clientsCreated(), 0);
  });
}

test('source builds without an official relay keep direct pairing and offer a way back from an empty admin page', () => {
  const f = fixture({ official: '' });
  assert.equal(f.pairingNodes().some(node => node.type === 'Button' && node.props.title === f.tr('Relay admin')), false);
  assert.ok(f.pairingNodes().some(node => node.type === 'PairingScanner'));
  f.routes[0] = '/relay-admin';
  button(f.adminNodes(), f.tr('Back to pairing')).onPress();
  assert.deepEqual(f.routes, ['/pairing']);
});

test('an unpaired phone opening admin without navigation history returns to pairing', () => {
  const f = fixture(); f.routes[0] = '/relay-admin';
  button(f.adminNodes(), f.tr('Back to pairing')).onPress();
  assert.deepEqual(f.routes, ['/pairing']);
});

test('adding a computer preserves the existing paired back action and successful pairing destination', async () => {
  const f = fixture({ paired: true }); f.routes.unshift('/');
  assert.equal(f.index.render().type, 'ConnectedScreen');
  button(f.pairingNodes(), 'Back to my computers').onPress();
  assert.deepEqual(f.routes, ['/']);
  f.routes.push('/pairing');
  const scanner = f.pairingNodes().find(node => node.type === 'PairingScanner');
  scanner.props.onScan('fixture-pairing'); await tick();
  assert.equal(f.connections.length, 1);
  assert.equal((f.connections[0][0] as { slot: string }).slot, 'new-slot');
  assert.equal(f.routes.at(-1), '/');
  assert.equal(f.adminNodes().some(node => node.type === heroButton && text(node) === f.tr('Back to pairing')), false);
});

test('relay management is disabled during pairing and available again after cancellation', () => {
  const f = fixture(); f.setPending();
  f.pairingNodes().find(node => node.type === 'PairingScanner').props.onScan('fixture-pairing');
  let nodes = f.pairingNodes();
  assert.equal(button(nodes, f.tr('Relay admin')).disabled, true);
  button(nodes, 'Cancel pairing').onPress();
  assert.equal(button(f.pairingNodes(), f.tr('Relay admin')).disabled, false);
});
