import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createSource, indexRoster } from '../src/client/sources.js'

// Exercise apply()'s actual public action face, automatic sidebar hook and list
// opener. Only host bindings, timers and RPC arrival are synthetic.
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/client/index.js', import.meta.url))], bundle: true,
  write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives', './api.js'],
})
const state = (revision = 1) => ({ revision, mainBotId: 'GPT', mainBotIds: ['GPT'],
  bots: [{ id: 'GPT', name: 'GPT', sessionId: 'GPT', parts: [] }, { id: 'QW', name: 'QW', sessionId: 'QW', parts: [] }],
  rooms: [{ id: 'room', name: 'Room', members: ['GPT', 'QW'] }], agents: [{ id: 'agent', name: 'Agent', sessions: ['agent-session'] }],
  prefs: {}, exchangeTurns: {}, questions: {}, work: { bots: {}, rooms: {}, approvals: [], waiting: {} },
})
const turn = () => new Promise(resolve => setImmediate(resolve))

function fixture({ listed = ['GPT', 'QW', 'room', 'agent-session'], selected = 'GPT', ready = true, bindings } = {}) {
  const rows = ids => Object.fromEntries(ids.map(id => [id, { id, title: id, blank: false, ...(id === selected ? { retainedBy: { mainView: 1 } } : {}) }]))
  const list = createSource({ ids: listed, byId: rows(listed) }), opened = [], calls = [], effects = new Map(), slots = [], timers = new Map()
  const storage = new Map(), refs = [], hookEffects = []
  let timer = 0, refAt = 0, hookCleanup, response = () => Promise.resolve(state(2)), refreshes = 0
  const setMain = id => list.set(snapshot => ({ ...snapshot, byId: Object.fromEntries(Object.entries(snapshot.byId).map(([key, row]) => [key, { ...row, retainedBy: { mainView: key === id ? 1 : 0 } }])) }))
  const react = { createElement: (type, props, ...children) => ({ type, props, children }), Fragment: Symbol('Fragment'),
    useMemo: make => make(), useState: initial => [initial, () => {}], useRef: value => refs[refAt++] ??= { current: value },
    useEffect: run => hookEffects.push(run), useLayoutEffect() {},
  }
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
  const module = { exports: {} }
  const context = { module, exports: module.exports, localStorage,
    window: bindings?.window ?? { addEventListener() {}, removeEventListener() {}, innerWidth: 1280 }, document: bindings?.document ?? { hidden: false }, console,
    MutationObserver: bindings?.window.MutationObserver,
    requestAnimationFrame: run => setTimeout(run, 0), cancelAnimationFrame: clearTimeout,
    setTimeout: (run, ms) => { timers.set(++timer, { run, ms }); return timer }, clearTimeout: id => timers.delete(id),
    require: name => name === './api.js' ? { call: async (endpoint, payload) => { calls.push([endpoint, payload]); return response(endpoint, payload) } }
      : name === 'react' ? bindings?.React ?? react : name === 'react-dom' ? bindings?.ReactDOM ?? {}
        : { FishLogo: () => null, MarkdownText: ({ children }) => children },
  }
  runInNewContext(bundled.outputFiles[0].text + '\nObject.assign(module.exports, { landingHook: useLandOnMainBot, TeamSidebar, HeaderPill, Overlays });', context)
  const ctx = {
    get: () => undefined, effect: (run, name) => { effects.set(name, run) }, inject: () => ({ dispose() {} }),
    slots: { inject: (_name, run) => run(), register: (options, component) => { slots.push({ options, component }); return () => {} }, entries: () => [] },
    sessions: { list, refresh: () => { refreshes++ } },
    uiWorkspace: { openSession: id => { assert.ok(list.getSnapshot().byId[id], 'the host only opens a listed Session'); opened.push(id); setMain(id) } },
    layout: { toggleSidebar() {}, selectPanel() {} },
  }
  module.exports.apply(ctx)
  const face = slots.find(slot => slot.options.id === 'bot-return').options.inject()
  if (ready) face.hooks.roster.set(indexRoster(state()))
  const stopSurface = effects.get('ds-bot: agent surface')()
  const stopNavigation = effects.get('ds-bot: navigation')()
  const renderLanding = () => {
    hookCleanup?.(); refAt = 0; hookEffects.length = 0
    module.exports.landingHook(face.hooks.roster.getSnapshot(), pick => pick(list.getSnapshot()), face.actions)
    for (const run of hookEffects) hookCleanup = run()
  }
  return { ...face, components: module.exports, list, opened, calls, timers, setMain, renderLanding,
    rpc: value => { response = value }, refreshes: () => refreshes,
    put: id => list.set(snapshot => ({ ...snapshot, ids: [...snapshot.ids, id], byId: { ...snapshot.byId, [id]: { id, blank: false } } })),
    runTimer: ms => { const entry = [...timers].find(([, value]) => value.ms === ms); assert.ok(entry, 'expected pending timer'); timers.delete(entry[0]); entry[1].run() },
    close: () => { hookCleanup?.(); stopNavigation(); stopSurface(); timers.clear() },
  }
}

test('a late automatic roster pull cannot replace a newer explicit QW selection', async t => {
  const f = fixture(); t.after(f.close)
  let release
  f.rpc(() => new Promise(resolve => { release = resolve }))
  const landing = f.actions.landOn('GPT', { botId: 'GPT', sessionId: 'GPT' })
  f.actions.openSession('QW')
  release(state(2)); await landing
  assert.deepEqual(f.opened, ['QW'])
})

test('rapid GPT/QW round trips and repeated clicks supersede an older pull even on returning to GPT', async t => {
  const f = fixture(); t.after(f.close)
  let release
  f.rpc(() => new Promise(resolve => { release = resolve }))
  const landing = f.actions.landOn('GPT', { botId: 'GPT', sessionId: 'GPT' })
  for (const id of ['QW', 'GPT', 'QW', 'QW', 'GPT']) f.actions.openSession(id)
  release(state(2)); await landing
  assert.deepEqual(f.opened, ['QW', 'GPT', 'QW', 'QW', 'GPT'])
})

test('an external host round trip invalidates an automatic pull too', async t => {
  const f = fixture(); t.after(f.close)
  let release
  f.rpc(() => new Promise(resolve => { release = resolve }))
  const landing = f.actions.landOn('GPT', { botId: 'GPT', sessionId: 'GPT' })
  f.setMain('QW'); f.setMain('GPT')
  release(state(2)); await landing
  assert.deepEqual(f.opened, [])
})

test('a cold roster and delayed list resolve only the latest Bot selection to its current part', t => {
  const f = fixture({ listed: ['GPT'], ready: false }); t.after(f.close)
  f.actions.openSession('GPT')
  f.actions.openSession('QW')
  f.put('QW')
  assert.deepEqual(f.opened, [], 'do not guess a part before the roster arrives')
  const roster = state(2)
  roster.bots[1].sessionId = 'QW-new'; roster.bots[1].parts = ['QW']
  f.hooks.roster.set(indexRoster(roster))
  assert.deepEqual(f.opened, [])
  f.put('QW-new')
  assert.deepEqual(f.opened, ['QW-new'])
})

test('a pending Bot selection follows a changed part instead of opening a stale listed part', t => {
  const f = fixture({ listed: ['GPT'] }); t.after(f.close)
  f.actions.openSession('QW')
  const roster = state(2); roster.bots[1].sessionId = 'QW-new'; roster.bots[1].parts = ['QW']
  f.hooks.roster.set(indexRoster(roster))
  f.put('QW')
  assert.deepEqual(f.opened, [])
  f.put('QW-new')
  assert.deepEqual(f.opened, ['QW-new'])
})

test('automatic initialization still lands when nobody has navigated', async t => {
  const f = fixture({ selected: null }); t.after(f.close)
  f.renderLanding(); f.runTimer(400); await turn()
  assert.deepEqual(f.opened, ['GPT'])
})

test('the current Bot changing part automatically follows the new listed conversation', async t => {
  const f = fixture(); t.after(f.close)
  f.renderLanding()
  const roster = state(2); roster.bots[0].sessionId = 'GPT-new'; roster.bots[0].parts = ['GPT']
  f.hooks.roster.set(indexRoster(roster)); f.renderLanding()
  assert.deepEqual(f.opened, [])
  f.put('GPT-new'); await turn()
  assert.deepEqual(f.opened, ['GPT-new'])
})

test('clearing an old Bot part still pulls and lands in its replacement without another user choice', async t => {
  const f = fixture({ selected: 'QW' }); t.after(f.close)
  f.renderLanding()
  const roster = state(2); roster.bots[1].sessionId = 'QW-new'; roster.bots[1].parts = ['QW']
  f.rpc(() => Promise.resolve(roster))
  f.setMain(null); f.renderLanding(); f.runTimer(0); await turn()
  f.put('QW-new')
  assert.deepEqual(f.opened, ['QW-new'])
})

test('an old zero-delay return cannot replace a newer group or Agent selection', async t => {
  for (const target of ['room', 'agent-session']) {
    const f = fixture(); t.after(f.close)
    f.renderLanding(); f.setMain(null); f.renderLanding()
    f.actions.openSession(target); f.runTimer(0); await turn()
    assert.deepEqual(f.opened, [target])
    assert.equal(f.hooks.surface.getSnapshot().plain, target === 'agent-session')
  }
})

test('switching between Bot, group and Agent keeps the committed surface while a destination is unlisted', t => {
  const f = fixture({ listed: ['GPT', 'agent-session'] }); t.after(f.close)
  f.actions.openSession('agent-session')
  f.actions.openSession('room')
  assert.equal(f.hooks.surface.getSnapshot().plain, true)
  f.put('room')
  assert.equal(f.hooks.surface.getSnapshot().plain, false)
  f.actions.openSession('QW'); f.actions.openAgentSession('agent-session'); f.put('QW')
  assert.deepEqual(f.opened, ['agent-session', 'room', 'agent-session'])
})

test('a cold return to Bot mode cannot override a newer explicit unlisted choice', t => {
  const f = fixture({ ready: false, listed: ['GPT'] }); t.after(f.close)
  f.actions.setSurface('agent'); f.actions.setSurface('bot')
  f.actions.openSession('QW')
  f.hooks.roster.set(indexRoster(state(2))); f.put('QW')
  assert.deepEqual(f.opened, ['QW'])
})

test('leaving Bot mode and disposing both cancel delayed automatic navigation', async t => {
  for (const end of [f => f.actions.setSurface('agent'), f => f.close()]) {
    const f = fixture(); t.after(f.close)
    let release
    f.rpc(() => new Promise(resolve => { release = resolve }))
    const landing = f.actions.landOn('GPT', { botId: 'GPT', sessionId: 'GPT' })
    end(f); release(state(2)); await landing
    assert.deepEqual(f.opened, [])
  }
})

test('a late Agent creation result cannot navigate over a newer Bot selection', async t => {
  const f = fixture(); t.after(f.close)
  let release
  f.rpc(endpoint => endpoint === 'add-agent' ? new Promise(resolve => { release = resolve }) : Promise.resolve(state(2)))
  const adding = f.actions.addAgent()
  f.actions.openSession('QW')
  release({ id: 'agent', sessions: ['agent-session'] }); await adding
  assert.deepEqual(f.opened, ['QW'])
})

test('a late new Agent Session and an archive fallback respect newer pending Bot selections', async t => {
  for (const operation of ['new', 'archive']) {
    const f = fixture({ listed: ['GPT', 'agent-session'] }); t.after(f.close)
    f.actions.openAgentSession('agent-session')
    let release
    f.rpc(endpoint => endpoint === 'state' ? Promise.resolve(state(2)) : new Promise(resolve => { release = resolve }))
    const result = operation === 'new' ? f.actions.newAgentSession('agent') : f.actions.archiveAgentSession('agent', 'agent-session')
    f.actions.openSession('QW')
    release({ sessionId: 'late-agent-session' }); await result
    f.put('late-agent-session'); f.put('QW')
    assert.deepEqual(f.opened, ['agent-session', 'QW'])
  }
})

test('disposing cancels a pending list subscription so later arrival cannot navigate', t => {
  const f = fixture({ listed: ['GPT'] }); t.after(f.close)
  f.actions.openSession('QW'); f.close(); f.put('QW')
  assert.deepEqual(f.opened, [])
})

test('the sidebar initialization timer cannot cancel a newer user navigation waiting for the session list', async t => {
  const f = fixture({ listed: ['GPT'], selected: undefined }); t.after(f.close)
  // The source hook schedules the same 400ms fallback used on a cold window.
  f.list.set(snapshot => ({ ...snapshot, byId: { GPT: { id: 'GPT', blank: false } } }))
  f.renderLanding()
  f.actions.openSession('QW')
  f.runTimer(400)
  f.put('QW'); await turn()
  assert.deepEqual(f.opened, ['QW'])
})

test('actual React sidebar clicks keep the header, composer destination, details and settings on the committed Session', async t => {
  const require = createRequire(new URL('../../../ios-app/package.json', import.meta.url))
  const React = require('react'), ReactDOM = require('react-dom')
  const { JSDOM } = createRequire(new URL('../../bridge/fixture/deps/package.json', import.meta.url))('jsdom')
  const dom = new JSDOM('<div id="root"></div>'), document = dom.window.document
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
  const previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { window: dom.window, document, IS_REACT_ACT_ENVIRONMENT: true })
  const f = fixture({ bindings: { React, ReactDOM, window: dom.window, document } })
  const root = require('react-dom/client').createRoot(document.getElementById('root'))
  t.after(async () => { await React.act(async () => root.unmount()); f.close(); dom.window.close(); Object.assign(globalThis, previous) })
  const read = source => pick => pick(React.useSyncExternalStore(source.subscribe, source.getSnapshot))
  const useSessions = read(f.list), hooks = Object.fromEntries(Object.entries(f.hooks).map(([key, source]) => [`use${key[0].toUpperCase()}${key.slice(1)}`, read(source)]))
  const useSessionStatus = pick => pick(new Map()), useActivity = pick => pick({})
  const props = { ...hooks, useSessions, useSessionStatus, useActivity, useSession: pick => pick({}),
    useSessionRetainInfo: (id, pick) => useSessions(list => pick(list.byId[id])), actions: f.actions, wide: true }
  const drafts = new Map([['GPT', 'GPT draft'], ['QW', 'QW draft'], ['room', 'Room draft']])
  function Main() {
    const id = useSessions(list => Object.values(list.byId).find(row => row.retainedBy?.mainView > 0)?.id)
    return React.createElement(React.Fragment, null,
      React.createElement(f.components.TeamSidebar, props),
      React.createElement(f.components.HeaderPill, { ...props, key: id, sessionId: id }),
      // Synthetic host binding: DSH owns content and draft storage; the plugin's
      // actual navigation must select the binding rather than rewriting labels.
      React.createElement('textarea', { 'data-session': id, key: `draft:${id}`, defaultValue: drafts.get(id), onChange: event => drafts.set(id, event.target.value) }),
      React.createElement(f.components.Overlays, props))
  }
  await React.act(async () => root.render(React.createElement(Main)))
  const click = async selector => {
    const button = document.querySelector(selector); assert.ok(button, selector)
    await React.act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
  }
  await click('.bt-pill')
  assert.equal(f.hooks.ui.getSnapshot().details, 'GPT')
  let release
  f.rpc(endpoint => endpoint === 'state' ? new Promise(resolve => { release = resolve }) : Promise.resolve({}))
  const stale = f.actions.landOn('GPT', { botId: 'GPT', sessionId: 'GPT' })
  await click('[data-bot-id="QW"]')
  await React.act(async () => { release(state(2)); await stale })
  for (const id of ['QW', 'GPT', 'QW', 'QW']) {
    await click(`[data-bot-id="${id}"]`)
    assert.equal(document.querySelector('[aria-current="page"]').dataset.botId, id)
    assert.equal(document.querySelector('.bt-pill-name').textContent, id)
    assert.equal(document.querySelector('textarea').dataset.session, id)
    assert.equal(document.querySelector('textarea').value, drafts.get(id))
    assert.equal(document.body.style.getPropertyValue('--bt-placeholder'), JSON.stringify(`Message ${id}`))
    assert.equal(f.hooks.ui.getSnapshot().details, id)
    assert.ok(document.querySelector('.bt-panel')?.textContent.includes(id))
  }
  assert.equal(f.opened.at(-1), 'QW')
  // Settings reached from the current details panel retain that panel's id.
  const settings = document.querySelector('[data-info-row="settings"]')
  assert.ok(settings, 'the real details panel exposes its settings action')
  await React.act(async () => settings.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
  assert.equal(document.querySelector('input[aria-label="Name"]')?.value, 'QW')
  await click('[aria-label="Back to details"]')
  await click('[data-room-id="room"]')
  assert.equal(document.querySelector('[aria-current="page"]').dataset.roomId, 'room')
  assert.equal(document.querySelector('.bt-pill-name').textContent, 'Room')
  assert.equal(document.querySelector('textarea').dataset.session, 'room')
  assert.equal(document.querySelector('textarea').value, 'Room draft')
  assert.equal(f.hooks.ui.getSnapshot().details, 'room')
  await click('[data-bot-id="GPT"]')
  assert.equal(document.querySelector('textarea').value, 'GPT draft')
  assert.equal(f.hooks.ui.getSnapshot().details, 'GPT')
})
