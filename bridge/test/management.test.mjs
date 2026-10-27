import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTeamActions } from '../src/actions.mjs'

// Team management through the mobile allowlist, against a scripted DS Bot channel.
function fixture({ groups = true, readOnly = false } = {}) {
  const calls = []
  const view = {
    revision: 1, readOnly, models: [{ ref: 'mock/model', name: 'Mock' }], defaultModel: 'mock/model',
    conversations: [
      { id: 'chief', kind: 'bot', sessionId: 's-chief', name: 'Chief', role: 'Lead', instructions: 'Be brief [secret:API_KEY]' },
      { id: 'ada', kind: 'bot', sessionId: 's-ada', name: 'Ada', role: '', instructions: '' },
      { id: 'room', kind: 'room', sessionId: 'room', name: 'Crew', members: ['chief', 'ada'], notice: 'Ship on Friday', parts: [] },
    ],
  }
  const replies = {
    'create-bot': { id: 'new-bot', instructions: 'must-not-leave' },
    'duplicate-bot': { id: 'copy', instructions: 'must-not-leave' },
    'create-room': { id: 'new-room', members: ['chief', 'ada'] },
    'set-prefs': { theme: 'mono', accent: '#112233', private: 'must-not-leave' },
    'room-progress': [{ callId: 'c1', speaking: 'ada', replies: [
      { botId: 'ada', text: 'token synthetic-known', time: 1, private: 'must-not-leave' },
      { botId: 'stranger', text: 'foreign reply', time: 2 },
      { kind: 'user', text: 'go', time: 3 },
    ] }],
  }
  const callTeam = async (endpoint, payload) => { calls.push([endpoint, structuredClone(payload)]); return replies[endpoint] ?? {} }
  const adapter = createTeamActions({
    callTeam, snapshot: async () => structuredClone(view), groups: () => groups,
    redactTexts: async ({ texts }) => texts.map(text => text.replaceAll('synthetic-known', '[redacted]')),
  })
  return { adapter, calls, writes: () => calls.filter(([name]) => name !== 'efforts') }
}

test('management actions are advertised only with a redactor, and group actions only with groups', () => {
  const actions = fixture().adapter.capabilities().actions
  for (const name of ['create-bot', 'update-bot', 'delete-bot', 'duplicate-bot', 'set-main', 'create-room', 'update-room', 'delete-room', 'stop-member-work', 'room-progress', 'set-prefs'])
    assert.ok(actions.includes(name), name)
  const solo = fixture({ groups: false }).adapter.capabilities().actions
  for (const name of ['create-room', 'update-room', 'delete-room', 'stop-member-work', 'room-progress']) assert.equal(solo.includes(name), false, name)
  assert.ok(solo.includes('create-bot'))
  const blind = createTeamActions({ callTeam: async () => ({}), snapshot: async () => ({ conversations: [] }) }).capabilities().actions
  assert.equal(blind.includes('create-bot'), false)
})

test('create and duplicate return only identifiers, never the stored Bot', async () => {
  const f = fixture()
  assert.deepEqual(await f.adapter.action('create-bot', { name: 'Nova', role: '', instructions: '', color: 'blue', avatar: { shape: 'whale' }, model: 'mock/model' }), { id: 'new-bot', created: true })
  assert.deepEqual(f.calls.at(-1), ['create-bot', { name: 'Nova', role: '', instructions: '', color: 'blue', avatar: { shape: 'whale' }, model: 'mock/model' }])
  assert.deepEqual(await f.adapter.action('duplicate-bot', { id: 'ada' }), { id: 'copy', source: 'ada' })
  for (const body of [{ name: '' }, { name: '   ' }, { name: 'x'.repeat(41) }, { name: 'Ok', model: 'foreign' }, { name: 'Ok', avatar: { image: 'https://example.com/a.png' } }, { name: 'Ok', avatar: { shape: 'Bad Shape' } }, { name: 'Ok', workDir: '/tmp' }])
    await assert.rejects(f.adapter.action('create-bot', body), { code: 'INVALID_ACTION' })
})

test('profile edits drop unchanged fields and never write redacted text back', async () => {
  const f = fixture()
  // Opening and leaving a field unchanged is not a write, even when it was shown redacted.
  assert.deepEqual(await f.adapter.action('update-bot', { id: 'chief', instructions: 'Be brief [secret:API_KEY]', name: 'Chief' }), { id: 'chief', changed: false })
  assert.equal(f.writes().length, 0)
  await assert.rejects(f.adapter.action('update-bot', { id: 'chief', instructions: 'Be briefer [secret:API_KEY]' }), { code: 'REDACTED_TEXT' })
  await assert.rejects(f.adapter.action('update-bot', { id: 'chief', name: 'Chief [redacted]' }), { code: 'REDACTED_TEXT' })
  assert.equal(f.writes().length, 0)
  assert.deepEqual(await f.adapter.action('update-bot', { id: 'ada', instructions: 'Line one\nLine two', role: 'Researcher' }), { id: 'ada', changed: true })
  assert.deepEqual(f.calls.at(-1), ['update-bot', { id: 'ada', instructions: 'Line one\nLine two', role: 'Researcher' }])
  await assert.rejects(f.adapter.action('update-bot', { id: 'ada' }), { code: 'INVALID_ACTION' })
  await assert.rejects(f.adapter.action('update-bot', { id: 'ada', name: '' }), { code: 'INVALID_ACTION' })
})

test('every target must be a visible Bot or group', async () => {
  const f = fixture()
  for (const [name, body] of [['delete-bot', { id: 'room' }], ['delete-bot', { id: 's-chief' }], ['duplicate-bot', { id: 'ghost' }], ['set-main', { id: 'ghost' }], ['set-main', { id: 'chief', replace: 'ghost' }],
    ['create-room', { members: ['chief', 'ghost'] }], ['create-room', { members: ['chief', 'ada'], admin: 'ghost' }], ['update-room', { id: 'chief', name: 'X' }], ['update-room', { id: 'room', add: ['ghost'] }],
    ['delete-room', { id: 'ada' }], ['stop-member-work', { roomId: 'room', botId: 'ghost' }], ['room-progress', { roomId: 'chief' }]])
    await assert.rejects(f.adapter.action(name, body), { code: 'TARGET_DENIED' }, `${name} ${JSON.stringify(body)}`)
  await assert.rejects(f.adapter.action('create-room', { members: ['chief'] }), { code: 'INVALID_ACTION' })
  assert.equal(f.writes().length, 0)
  assert.deepEqual(await f.adapter.action('set-main', { id: 'ada', main: true, primary: true }), { id: 'ada', main: true })
  assert.deepEqual(await f.adapter.action('create-room', { name: 'Pair', members: ['chief', 'ada'], admin: 'chief', greet: true }), { id: 'new-room', created: true })
  assert.deepEqual(await f.adapter.action('delete-bot', { id: 'ada' }), { id: 'ada', deleted: true })
})

test('group notices follow the same unchanged and redaction rules', async () => {
  const f = fixture()
  assert.deepEqual(await f.adapter.action('update-room', { id: 'room', notice: 'Ship on Friday' }), { id: 'room', changed: false })
  await assert.rejects(f.adapter.action('update-room', { id: 'room', notice: 'Use [secret:TOKEN]' }), { code: 'REDACTED_TEXT' })
  await assert.rejects(f.adapter.action('update-room', { id: 'room', mode: 'anyone' }), { code: 'INVALID_ACTION' })
  assert.equal(f.writes().length, 0)
  assert.deepEqual(await f.adapter.action('update-room', { id: 'room', notice: 'Ship on Monday', mode: 'everyone' }), { id: 'room', changed: true })
  assert.deepEqual(f.calls.at(-1), ['update-room', { id: 'room', notice: 'Ship on Monday', mode: 'everyone' }])
})

test('team look is validated and only its three fields come back', async () => {
  const f = fixture()
  assert.deepEqual(await f.adapter.action('set-prefs', { theme: 'mono', accent: '#112233' }), { theme: 'mono', accent: '#112233' })
  for (const body of [{}, { theme: 'Mono!' }, { accent: 'red' }, { motion: 'wild' }, { theme: 'mono', private: true }])
    await assert.rejects(f.adapter.action('set-prefs', body), { code: 'INVALID_ACTION' })
})

test('live group progress leaves only redacted replies from the visible team', async () => {
  const f = fixture()
  const rounds = await f.adapter.action('room-progress', { roomId: 'room' })
  assert.deepEqual(rounds, [{ callId: 'c1', speaking: 'ada', replies: [{ botId: 'ada', text: 'token [redacted]', time: 1 }, { kind: 'user', text: 'go', time: 3 }] }])
})

test('a read-only team refuses every management write', async () => {
  const f = fixture({ readOnly: true })
  for (const [name, body] of [['create-bot', { name: 'Nova' }], ['delete-bot', { id: 'ada' }], ['set-main', { id: 'ada' }], ['create-room', { members: ['chief', 'ada'] }], ['update-room', { id: 'room', name: 'X' }], ['set-prefs', { theme: 'mono' }]])
    await assert.rejects(f.adapter.action(name, body), { code: 'READ_ONLY' }, name)
  assert.equal(f.writes().length, 0)
})
