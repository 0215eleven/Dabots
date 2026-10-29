import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { URL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const deferred = () => { let resolve!: (value?: any) => void, reject!: (reason?: any) => void; const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const plain = (value: any) => JSON.parse(JSON.stringify(value));

function mountAvatar(storage: { readCache: (...args: any[]) => Promise<any>; writeCache: (...args: any[]) => Promise<void> }) {
  const state: any[] = [], effects: (() => unknown)[] = [], modules = new Map<string, any>();
  let cursor = 0;
  const react = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useState(initial: any) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], (next: any) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }]; },
    useEffect(effect: () => unknown, deps: any[]) { const index = cursor++; if (!state[index] || deps.some((item, at) => item !== state[index][at])) { state[index] = deps; effects.push(effect); } },
  };
  const load = (file: string): any => {
    if (modules.has(file)) return modules.get(file);
    const module = { exports: {} as any };
    modules.set(file, module.exports);
    const source = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    runInNewContext(output, { module, exports: module.exports, require(name: string) {
      if (name === 'react') return react;
      if (name === 'react-native') return { View: 'View' };
      if (name === '../storage') return storage;
      if (name === './BotAvatar') return { BotAvatar: 'BotAvatar' };
      if (name === './UI') return { Notice: 'Notice', Button: 'Button' };
      if (name === '../i18n') return { useI18n: () => ({ tr: (value: string) => value }) };
      if (name === '../logic/my-look') return load('logic/my-look.ts');
      throw Error('Unexpected avatar dependency: ' + name);
    } });
    return module.exports;
  };
  const avatar = load('components/MyAvatar.tsx');
  return {
    avatar,
    render(name = 'useMyLook') { cursor = 0; return avatar[name](); },
    effects() { for (const effect of effects.splice(0)) effect(); },
  };
}

function elements(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object') return [];
  return [value, ...elements(value.props?.children)];
}

function webCache(localStorage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }) {
  const module = { exports: {} as any };
  const source = readFileSync(new URL('../src/storage/cache.web.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(output, { module, exports: module.exports, localStorage });
  return module.exports;
}

// Keep promise scheduling in the same realm as the calling app. Separate VM
// realms can add thenable assimilation turns and conceal save completion races.
function lookStore() {
  const module = { exports: {} as any };
  const source = readFileSync(new URL('../src/logic/my-look.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('module', 'exports', output)(module, module.exports);
  return module.exports.createMyLookStore;
}

test('an edit made during initial loading wins while untouched saved avatar fields survive', async () => {
  const read = deferred(), writes: any[] = []; let saved: any = { color: 'old', avatar: { shape: 'cat' } }, firstRead = true;
  const mounted = mountAvatar({ readCache: async () => { if (firstRead) { firstRead = false; return read.promise; } return saved; }, writeCache: async (_scope, _key, value) => { saved = plain(value); writes.push(saved); } });
  mounted.render(); mounted.effects();
  mounted.avatar.updateMyLook({ color: 'new' });
  assert.equal(mounted.render().color, 'new');
  read.resolve({ color: 'old', avatar: { shape: 'cat' } }); await flush();
  assert.deepEqual(plain(mounted.render()), { color: 'new', avatar: { shape: 'cat' } });
  assert.deepEqual(writes.at(-1), { color: 'new', avatar: { shape: 'cat' } });
});

test('a reset during loading cannot resurrect the saved avatar and is persisted', async () => {
  const read = deferred(); let saved: any = { avatar: { shape: 'cat' } }, firstRead = true;
  const mounted = mountAvatar({ readCache: async () => { if (firstRead) { firstRead = false; return read.promise; } return saved; }, writeCache: async (_scope, _key, value) => { saved = plain(value); } });
  mounted.render(); mounted.effects(); mounted.avatar.resetMyLook();
  read.resolve({ avatar: { shape: 'cat' } }); await flush();
  assert.deepEqual(plain(mounted.render()), {});
  assert.deepEqual(saved, {});
});

test('failed saves are visible, keep the edited preview, and retry can persist it', async () => {
  let saved: any = { color: 'old' }, fail = true;
  const mounted = mountAvatar({ readCache: async () => saved, writeCache: async (_scope, _key, value) => { if (fail) throw Error('private storage detail'); saved = plain(value); } });
  mounted.render(); mounted.effects(); await flush();
  await mounted.avatar.updateMyLook({ color: 'new' }); await flush();
  assert.equal(mounted.render().color, 'new');
  assert.equal(typeof mounted.avatar.MyLookPersistence, 'function');
  const nodes = elements(mounted.render('MyLookPersistence'));
  assert.ok(nodes.some(node => node.type === 'Notice' && node.props.error && /not saved/i.test(node.props.text)));
  assert.equal(JSON.stringify(nodes).includes('private storage detail'), false);
  fail = false;
  await nodes.find(node => node.type === 'Button' && node.props.title === 'Retry saving avatar').props.onPress(); await flush();
  assert.deepEqual(saved, { color: 'new' });
  assert.equal(elements(mounted.render('MyLookPersistence')).some(node => node.type === 'Notice' && node.props.error), false);
});

test('writes never overlap and the newest edit survives a simulated app restart', async () => {
  const firstWrite = deferred(), writes: any[] = []; let saved: any = {}, active = 0, peak = 0;
  const storage = { readCache: async (scope: string, key: string) => { assert.equal(scope, 'app'); assert.equal(key, 'myLook'); return saved; }, writeCache: async (scope: string, key: string, value: any) => {
    assert.equal(scope, 'app'); assert.equal(key, 'myLook'); peak = Math.max(peak, ++active); writes.push(plain(value));
    if (writes.length === 1) await firstWrite.promise;
    saved = plain(value); active--;
  } };
  const mounted = mountAvatar(storage); mounted.render(); mounted.effects(); await flush();
  const first = mounted.avatar.updateMyLook({ color: 'first' }); await flush();
  const latest = mounted.avatar.updateMyLook({ color: 'latest', avatar: { image: 'data:image/webp;base64,fixture' } }); await flush();
  assert.equal(peak, 1);
  assert.equal(writes.length, 1);
  firstWrite.resolve(); await Promise.all([first, latest]); await flush();
  assert.deepEqual(saved, { color: 'latest', avatar: { image: 'data:image/webp;base64,fixture' } });
  const restarted = mountAvatar(storage); restarted.render(); restarted.effects(); await flush();
  assert.deepEqual(plain(restarted.render()), saved);
});

test('a failed save can restore the last saved look without losing later edit ordering', async () => {
  let saved: any = { color: 'saved' }, fail = true;
  const mounted = mountAvatar({ readCache: async () => saved, writeCache: async (_scope, _key, value) => { if (fail) throw Error('failed'); saved = plain(value); } });
  mounted.render(); mounted.effects(); await flush();
  await mounted.avatar.updateMyLook({ color: 'unsaved' }); await flush();
  assert.equal(typeof mounted.avatar.MyLookPersistence, 'function');
  const restore = elements(mounted.render('MyLookPersistence')).find(node => node.type === 'Button' && node.props.title === 'Restore saved avatar');
  assert.ok(restore);
  fail = false; await restore.props.onPress(); await flush();
  assert.equal(mounted.render().color, 'saved');
  assert.deepEqual(saved, { color: 'saved' });
});

test('a storage adapter that silently fails is detected by read-back verification', async () => {
  const mounted = mountAvatar({ readCache: async () => ({ color: 'old' }), writeCache: async () => {} });
  mounted.render(); mounted.effects(); await flush();
  await mounted.avatar.updateMyLook({ color: 'new' }); await flush();
  assert.equal(typeof mounted.avatar.MyLookPersistence, 'function');
  assert.ok(elements(mounted.render('MyLookPersistence')).some(node => node.type === 'Notice' && node.props.error));
});

test('the avatar status never claims persistence before initial loading completes', async () => {
  const read = deferred();
  const mounted = mountAvatar({ readCache: () => read.promise, writeCache: async () => {} });
  const nodes = elements(mounted.render('MyLookPersistence'));
  assert.ok(nodes.some(node => node.type === 'Notice' && node.props.text === 'Loading your saved avatar…'));
  assert.equal(nodes.some(node => node.type === 'Notice' && node.props.text === 'Avatar saved on this phone only.'), false);
  read.resolve({});
});

test('failed loading cannot overwrite stored fields and retry recovers the pending edit', async () => {
  let failed = true, saved: any = { color: 'old', avatar: { shape: 'cat' } }, writes = 0;
  const mounted = mountAvatar({ readCache: async () => { if (failed) throw Error('read denied'); return saved; }, writeCache: async (_scope, _key, value) => { writes++; saved = plain(value); } });
  mounted.render(); mounted.effects(); await flush();
  await mounted.avatar.updateMyLook({ color: 'new' }); await flush();
  assert.equal(writes, 0);
  const nodes = elements(mounted.render('MyLookPersistence'));
  assert.ok(nodes.some(node => node.type === 'Notice' && node.props.error && /Could not load/.test(node.props.text)));
  failed = false;
  await nodes.find(node => node.type === 'Button' && node.props.title === 'Retry loading avatar').props.onPress(); await flush();
  assert.deepEqual(saved, { color: 'new', avatar: { shape: 'cat' } });
  assert.equal(writes, 1);
});

test('real web cache read errors stay visible and cannot erase an unread saved photo', async () => {
  let failRead = true, writes = 0, saved = JSON.stringify({ color: 'old', avatar: { image: 'data:image/webp;base64,saved-local-photo' } });
  const cache = webCache({
    getItem(key) { assert.equal(key, 'ds-bot:cache:["app","myLook"]'); if (failRead) throw Error('temporary storage denial'); return saved; },
    setItem(key, value) { assert.equal(key, 'ds-bot:cache:["app","myLook"]'); writes++; saved = value; },
  });
  // Ordinary cache consumers keep their existing best-effort behavior.
  assert.equal(await cache.readCache('app', 'myLook'), null);
  const mounted = mountAvatar(cache);
  mounted.render(); mounted.effects(); await flush();
  await mounted.avatar.updateMyLook({ color: 'new' }); await flush();
  assert.equal(writes, 0);
  const retry = elements(mounted.render('MyLookPersistence')).find(node => node.type === 'Button' && node.props.title === 'Retry loading avatar');
  assert.ok(retry);
  failRead = false; await retry.props.onPress(); await flush();
  assert.deepEqual(JSON.parse(saved), { color: 'new', avatar: { image: 'data:image/webp;base64,saved-local-photo' } });
});

test('an edit in the save completion microtask is persisted before its promise resolves', async () => {
  const pending = deferred(), writes: any[] = [];
  const store = lookStore()({ read: async () => ({}), write(value: any) {
    writes.push(plain(value));
    return writes.length === 1 ? pending.promise : Promise.resolve(true);
  } });
  await store.load();
  const first = store.update({ color: 'first' }); await flush();
  let latest: Promise<boolean> | undefined;
  pending.resolve(true);
  queueMicrotask(() => { latest = store.update({ color: 'latest' }); });
  await first; await latest; await flush();
  assert.deepEqual(writes, [{ color: 'first' }, { color: 'latest' }]);
  assert.equal(store.snapshot().dirty, false);
  assert.equal(store.snapshot().saving, false);
});

test('real web cache write refusal is visible and retry persists the same local photo', async () => {
  let failWrite = true, saved = JSON.stringify({ color: 'old' });
  const cache = webCache({
    getItem() { return saved; },
    setItem(_key, value) { if (failWrite) throw Error('local storage quota'); saved = value; },
  });
  const mounted = mountAvatar(cache);
  mounted.render(); mounted.effects(); await flush();
  await mounted.avatar.updateMyLook({ avatar: { image: 'data:image/webp;base64,phone-only' } }); await flush();
  const retry = elements(mounted.render('MyLookPersistence')).find(node => node.type === 'Button' && node.props.title === 'Retry saving avatar');
  assert.ok(retry);
  assert.deepEqual(JSON.parse(saved), { color: 'old' });
  failWrite = false; await retry.props.onPress(); await flush();
  assert.deepEqual(JSON.parse(saved), { color: 'old', avatar: { image: 'data:image/webp;base64,phone-only' } });
});
