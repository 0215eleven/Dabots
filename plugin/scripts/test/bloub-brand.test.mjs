import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { bundleClient } from '../../engine/scripts/build-client.mjs'
import { patchBloubBrand } from '../patch-bloub-brand.mjs'
import { extractFactory } from '../suite-lib.mjs'

const ts = createRequire(new URL('../../../ios-app/package.json', import.meta.url))('typescript')
const built = await bundleClient()

function parse(source) {
  const ast = ts.createSourceFile('client.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  assert.deepEqual(ast.parseDiagnostics, [], 'the transformed client must remain valid JavaScript')
  return ast
}

function namedFunction(source, name) {
  const ast = parse(source)
  let found
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, `${name} must remain callable by the mark system`)
  return { ast, node: found }
}

function assertNoDeadTail(source, name) {
  const { node } = namedFunction(source, name)
  const firstReturn = node.body.statements.findIndex(ts.isReturnStatement)
  assert.ok(firstReturn >= 0, `${name} must return a mark`)
  assert.equal(node.body.statements.length - firstReturn - 1, 0,
    `${name} must not ship legacy statements after its unconditional return`)
}

// Expose the real generated functions only inside this VM; production exports
// stay unchanged. React's element boundary returns inspectable element records.
function avatarRuntime(source, platformReact, globals = {}) {
  const factorySource = `(${extractFactory(source, 'ds-bot')})`
  const ast = parse(factorySource)
  const factory = ast.statements[0].expression.expression
  const last = factory.body.statements.at(-1)
  assert.ok(ts.isReturnStatement(last))
  const exposed = factorySource.slice(0, last.getStart(ast))
    + 'return { characterMarkup, RoomAvatar, BotMark, BotAvatar, TeamSidebar, SHELL_CSS, SIDEBAR_CSS, indexRoster, BrandName, BotReturn, DICTIONARY, t };'
    + factorySource.slice(last.end)
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props }, children }),
    Fragment: Symbol('Fragment'),
  }
  return vm.runInNewContext(exposed, globals)(name => {
    if (name === 'react') return platformReact ?? react
    if (name === 'react-dom') return { createPortal: node => node }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: () => null }
    throw Error(`Unexpected platform module: ${name}`)
  })
}

test('the source builder eliminates the legacy character renderer after the Bloub return', () => {
  assertNoDeadTail(built, 'characterMarkup')
})

test('the actual generated title and return button display Dabots with stable module identity', () => {
  const runtime = avatarRuntime(built)
  assert.deepEqual(runtime.BrandName().children, ['Dabots'])
  const button = runtime.BotReturn({ wide: true, useSurface: () => 'agent', actions: { setSurface() {} } })
  assert.equal(button.props['aria-label'], 'Dabots')
  assert.equal(button.props.title, 'Dabots')
  assert.equal(button.children[1].children[0], 'Dabots')
  assert.equal(runtime.DICTIONARY.zh.Dabots, 'Dabots')
  assert.equal(runtime.t('Dabots'), 'Dabots')
  assert.match(built, /id: 'ds-bot'/)
})

test('the source builder delegates group avatars without a stale single-face tail', () => {
  assertNoDeadTail(built, 'RoomAvatar')
})

test('generated Bloub avatars preserve their geometry and colors', () => {
  const runtime = avatarRuntime(built)
  // Captured from the existing Bloub renderer before removing its dead tails.
  // These cover named inks, light/dark contrast and unknown stored identifiers.
  for (const [shape, color, expected] of [
    ['whale', 'deepseek', 'ece423957057cab2283602931743c4cbe5c9bd002036cb7acc0fc57a0f0adb8e'],
    ['star', '#ffffff', '226cc234acec80f1aed0edb726035cdacc3a550c35a0396b8ca0839f5f5dea73'],
    ['moon', '#000000', 'b5de2bc6952339cca708cbbaa9cf4c461b2d211c0c7defcadf6336b52acbbe1e'],
    ['unknown-shape', 'unknown-ink', 'ae46e913cc97ac10dd60a98c4c507ab883ef42bf293ef9b3929f043c74ea7ea1'],
  ]) {
    const markup = runtime.characterMarkup(shape, color)
    assert.equal(createHash('sha256').update(markup).digest('hex'), expected, `${shape}/${color}`)
    assert.equal(runtime.characterMarkup(shape, color), markup, 'stored looks remain stable between mounts')
  }
})

test('the actual branded client keeps up to four member portraits inside every group frame without overlap', () => {
  const runtime = avatarRuntime(built)
  for (const size of [16, 18, 20, 24, 28, 36, 64, 112]) {
    for (const count of [0, 1, 2, 3, 4, 5, 12, 100]) {
      const members = Array.from({ length: count }, (_, i) => `member-${i}`)
      const byId = Object.fromEntries(members.map(id => [id, { id, avatar: { image: 'data:image/png;base64,photo' } }]))
      const cluster = runtime.RoomAvatar({ room: { members }, roster: { byId }, size })
      assert.equal(cluster.props.className, 'bt-cluster')
      assert.equal(cluster.props.style.width, size)
      assert.equal(cluster.props.style.flexShrink, 0, 'a narrow row must keep the whole avatar frame')
      const seats = cluster.children.flat(Infinity).filter(node => node.props.className === 'bt-cluster-member')
      assert.deepEqual(seats.map(seat => seat.props['data-member-id']), members.slice(0, 4))
      for (const [index, seat] of seats.entries()) {
        const { left, top, width, height } = seat.props.style
        assert.ok(left >= 0 && top >= 0 && left + width <= size && top + height <= size)
        assert.ok(width > 0 && width < size && height === width)
        assert.equal(seat.props.style.overflow, 'hidden')
        const portrait = seat.children[0]
        assert.equal(portrait.type, runtime.BotMark)
        assert.equal(portrait.props.bot, byId[members[index]])
        assert.equal(portrait.props.size, width)
        for (const other of seats.slice(index + 1)) {
          const b = other.props.style
          assert.ok(left + width < b.left || b.left + b.width < left || top + height < b.top || b.top + b.height < top, 'portraits must have an actual gap')
        }
      }
      if (!count) assert.equal(cluster.children[0].type, 'svg', 'empty groups never impersonate a Bot')
    }
  }
})

test('missing roster entries retain stable member slots, and roster/member updates replace the displayed identities', () => {
  const runtime = avatarRuntime(built)
  const members = ['not-loaded', 'present', 'present']
  const first = { id: 'present', avatar: { image: 'old-photo' } }
  const render = (ids, byId) => runtime.RoomAvatar({ room: { members: ids }, roster: { byId }, size: 36 }).children.flat(Infinity)
  const before = render(members, { present: first })
  assert.deepEqual(before.map(seat => seat.props['data-member-id']), ['not-loaded', 'present'])
  assert.equal(before[0].children[0].props.bot.id, 'not-loaded')
  assert.equal(before[1].children[0].props.bot, first)
  const loaded = { id: 'not-loaded', avatar: { image: 'loaded-photo' } }
  const next = { ...first, avatar: { image: 'new-photo' } }
  const after = render(['present', 'not-loaded', 'new-member'], { present: next, 'not-loaded': loaded })
  assert.deepEqual(after.map(seat => seat.props['data-member-id']), ['present', 'not-loaded', 'new-member'])
  assert.equal(after[0].children[0].props.bot, next)
  assert.equal(after[1].children[0].props.bot, loaded)
})

test('the generated sidebar updates group membership, refreshed photos and failed-photo fallbacks while single chats stay intact', async t => {
  const require = createRequire(new URL('../../../ios-app/package.json', import.meta.url))
  const React = require('react')
  const { JSDOM } = createRequire(new URL('../../bridge/fixture/deps/package.json', import.meta.url))('jsdom')
  const dom = new JSDOM('<div id="root"></div>')
  const previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const runtime = avatarRuntime(built, React, { window: dom.window, document: dom.window.document, setTimeout, clearTimeout })
  const mount = require('react-dom/client').createRoot(dom.window.document.getElementById('root'))
  t.after(async () => { await React.act(async () => mount.unmount()); dom.window.close(); Object.assign(globalThis, previous) })
  const photo = value => `data:image/png;base64,${value}`
  const a = { id: 'a', name: 'Writer', avatar: { image: photo('old') } }
  const b = { id: 'b', name: 'Reader', avatar: { image: photo('reader') } }
  const c = { id: 'c', name: 'Planner' }
  const room = { id: 'room', name: 'Example group', members: ['a', 'b'], createdAt: 1 }
  const listeners = new Set()
  let roster
  const update = (bots, members) => {
    roster = runtime.indexRoster({ bots, rooms: [{ ...room, members }], agents: [], mainBotId: null, mainBotIds: [], exchangeTurns: {}, questions: {}, prefs: {} })
    for (const listener of listeners) listener()
  }
  update([a, b, c], room.members)
  const sessions = { ids: ['room'], byId: { room: { id: 'room', retainedBy: { mainView: 1 } } } }
  const props = wide => ({
    wide, useRoster: pick => React.useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, () => pick(roster)),
    useUi: pick => pick({ unread: {} }), useRegistry: pick => pick({}), useUpdate: () => ({}),
    useSessions: pick => pick(sessions), useSessionStatus: pick => pick(new Map()),
    useSessionRetainInfo: (_id, pick) => pick({ retainedBy: {} }), useActivity: pick => pick({}), actions: {},
  })
  const document = dom.window.document
  const group = () => document.querySelector('[data-room-id="room"]')
  const members = () => [...group().querySelectorAll('[data-member-id]')].map(node => node.dataset.memberId)
  await React.act(async () => mount.render(React.createElement(runtime.TeamSidebar, props(true))))
  assert.deepEqual(members(), ['a', 'b'])
  assert.equal(group().querySelectorAll('img').length, 2)
  assert.equal(document.querySelector('[data-bot-id="a"] > .bt-mark img').getAttribute('src'), photo('old'))
  // A failed member photo uses its own generated mark, and a changed URL is retried.
  await React.act(async () => group().querySelector('[data-member-id="a"] img').dispatchEvent(new dom.window.Event('error')))
  assert.ok(group().querySelector('[data-member-id="a"] .bt-bloub-avatar'))
  const fresh = { ...a, avatar: { image: photo('fresh') } }
  await React.act(async () => update([fresh, b, c], ['c', 'a', 'not-yet-loaded', 'b', 'fifth']))
  assert.deepEqual(members(), ['c', 'a', 'not-yet-loaded', 'b'])
  assert.equal(group().querySelector('[data-member-id="a"] img').getAttribute('src'), photo('fresh'))
  assert.ok(group().querySelector('[data-member-id="not-yet-loaded"] .bt-bloub-avatar'))
  assert.equal(document.querySelector('[data-bot-id="a"] > .bt-mark img').getAttribute('src'), photo('fresh'))
  await React.act(async () => { update([fresh, b, c], ['b']); mount.render(React.createElement(runtime.TeamSidebar, props(false))) })
  assert.deepEqual(members(), ['b'])
  assert.equal(group().querySelectorAll('.bt-cluster-member').length, 1, 'no synthetic user or stale member remains in the narrow rail')
  await React.act(async () => update([fresh, b, c], []))
  assert.deepEqual(members(), [])
  assert.equal(group().querySelector('.bt-cluster > svg') !== null, true)
})

test('repatching a previously branded client removes stale tails and stays idempotent', () => {
  let stale = built
  for (const name of ['characterMarkup', 'RoomAvatar']) {
    const { node } = namedFunction(stale, name)
    const close = node.body.end - 1
    stale = stale.slice(0, close) + '\n  throw Error("obsolete renderer");\n' + stale.slice(close)
  }
  const patched = patchBloubBrand(stale)
  assertNoDeadTail(patched, 'characterMarkup')
  assertNoDeadTail(patched, 'RoomAvatar')
  assert.equal(patchBloubBrand(patched), patched)
  assert.equal(avatarRuntime(patched).characterMarkup('whale', 'deepseek'),
    avatarRuntime(built).characterMarkup('whale', 'deepseek'))
})
