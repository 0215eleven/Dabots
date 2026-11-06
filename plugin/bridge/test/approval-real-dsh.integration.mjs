// Real cordis waterfall and DSH's ApprovalService.decide from the public DSH test dependencies.
// Not a desktop window or device assertion: the computer card is a waterfall listener here.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createApprovalBroker } from '../src/approval-broker.mjs'
const deps = resolve(process.env.BRIDGE_TEST_DEPS ?? join(import.meta.dirname, '../fixture/deps/node_modules'))
const require = createRequire(join(deps, '../package.json'))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { ApprovalService } = await load('@deepseek-ai/dsh-user-approval')
let passed = 0
const check = label => { passed++; console.log('PASS ' + label) }
const ctx = new Context()
const service = Object.create(ApprovalService.prototype)
Object.assign(service, { ctx, config: { policy: 'ask' } })
const session = { seq: 0, eventAt: () => undefined }
const ask = (sessionId, signal) => service.decide({ agent: { id: sessionId, session: { id: sessionId } }, toolName: 'bash', reason: 'npm test', signal }, session)
const tick = () => new Promise(resolve => setTimeout(resolve, 20))
// The computer card: appended like DSH's remote approval listener, closed by its request signal.
const cards = []
ctx.on('approval/request', request => new Promise(resolve => {
  const card = { answer: resolve, closed: false }
  request.signal?.addEventListener('abort', () => { card.closed = true; resolve('cancelled') }, { once: true })
  cards.push(card)
}))
const broker = createApprovalBroker({ on: (name, listener, options) => ctx.on(name, listener, options), available: () => true,
  owner: async sessionId => sessionId === 'bot-chat' ? { conversationId: 'chief' } : null })
try {
  let pending = ask('bot-chat', new AbortController().signal)
  await tick()
  const [entry] = broker.list('chief')
  assert.equal(entry?.tool, 'bash'); assert.equal(cards.length, 1)
  broker.answer(entry.id, 'allow')
  assert.equal(await pending, 'allowed-once'); assert.equal(cards[0].closed, true)
  check('a phone answer decides through the real waterfall and closes the computer card')
  pending = ask('bot-chat', new AbortController().signal)
  await tick(); cards[1].answer('rejected')
  assert.equal(await pending, 'rejected'); assert.equal(broker.list('chief').length, 0)
  check('the computer card still decides when it answers first')
  pending = ask('member-session', new AbortController().signal)
  await tick(); assert.equal(broker.list('chief').length, 0); cards[2].answer('allowed-once')
  assert.equal(await pending, 'allowed-once')
  check('Sessions a phone cannot open pass through untouched')
  const controller = new AbortController()
  pending = ask('bot-chat', controller.signal)
  await tick(); controller.abort()
  assert.equal(await pending, 'cancelled'); await tick(); assert.equal(broker.list('chief').length, 0)
  check('stopping the turn cancels a waiting approval and clears it from the phone')
  console.log(passed + ' real cordis/DSH approval checks passed; no desktop window or device assertion')
} finally { broker.dispose(); ctx.registry?.dispose?.() }
