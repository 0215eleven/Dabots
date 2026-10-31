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
function avatarRuntime(source) {
  const factorySource = `(${extractFactory(source, 'ds-bot')})`
  const ast = parse(factorySource)
  const factory = ast.statements[0].expression.expression
  const last = factory.body.statements.at(-1)
  assert.ok(ts.isReturnStatement(last))
  const exposed = factorySource.slice(0, last.getStart(ast))
    + 'return { characterMarkup, RoomAvatar, BotMark, BrandName, BotReturn, DICTIONARY, t };'
    + factorySource.slice(last.end)
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props }, children }),
    Fragment: Symbol('Fragment'),
  }
  return vm.runInNewContext(exposed, {})(name => {
    if (name === 'react') return react
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

test('the source builder eliminates the legacy room cluster after the Bloub return', () => {
  assertNoDeadTail(built, 'RoomAvatar')
})

test('generated Bloub avatars preserve their geometry, colors and single-seat room behavior', () => {
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
  const first = { id: 'first', shape: 'star', color: 'rose' }
  const second = { id: 'second', shape: 'moon', color: 'blue' }
  const roster = { byId: { first, second } }
  for (const size of [16, 36, 64]) {
    const occupied = runtime.RoomAvatar({ room: { members: ['missing', 'first', 'second'] }, roster, size })
    assert.equal(occupied.type, runtime.BotMark)
    assert.deepEqual(occupied.props, { bot: first, size })
    const empty = runtime.RoomAvatar({ room: { members: ['missing'] }, roster, size })
    assert.equal(empty.type, runtime.BotMark)
    assert.deepEqual(empty.props, { size })
  }
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
