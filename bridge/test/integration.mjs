import assert from 'node:assert/strict'
import { launchFixture } from './fixture-host.mjs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { once } from 'node:events'
import WebSocket from 'ws'
import { MobileClient, MemoryTokenStore, applyConversationEvent } from '../../packages/mobile-sdk/index.js'
const sockets = []
class TrackedWebSocket extends WebSocket {
  constructor(...args) { super(...args); sockets.push(this) }
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(run, timeout = 60000) { const end = Date.now() + timeout; let error; while (Date.now() < end) { try { return await run() } catch (cause) { error = cause; await delay(100) } } throw error }
let fixture
async function api(base, path, token, body) {
  const response = await fetch(`${base}/mobile/v1/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, value: await response.json() }
}
let passed = 0, client, sdkStream
const check = name => { passed++; console.log(`PASS ${name}`) }
try {
  fixture = await launchFixture()
  const urls = fixture.urls
  client = new MobileClient({ baseUrl: urls.bridgeUrl, allowInsecure: true, tokenStore: new MemoryTokenStore(), WebSocket: TrackedWebSocket, reconnectDelayMs: 20 })
  const operator = async (endpoint, payload) => { const response = await fetch(urls.operatorUrl, { method: 'POST', headers: { 'x-fixture': 'bridge-test-only' }, body: JSON.stringify({ endpoint, payload }) }); assert.equal(response.status, 200); return response.json() }
  assert.equal((await client.info()).capabilities.groups, true)
  check('group capability requires the reviewed group contract')
  const pairing = await operator('pairing.create'), claim = await client.pair(pairing.code, 'Synthetic group client')
  await operator('pairing.approve', { requestId: claim.requestId })
  const session = await client.completePairing(claim.claimToken)
  const seeded = await operator('test.create-group')
  const [state, list, target] = await Promise.all([client.state(), client.conversations(), client.target(seeded.id)])
  const room = list.conversations.find(row => row.id === seeded.id)
  assert.equal(room.kind, 'room'); assert.equal(room.sessionId, seeded.id); assert.deepEqual(room.parts, [])
  assert.equal(target.sessionId, seeded.id); assert.equal(target.kind, 'room'); assert.equal(state.rooms[0].id, seeded.id)
  // The group notice is shown redacted so it can be edited in place; previews and secrets never leave.
  assert.equal(typeof room.notice, 'string'); assert.equal(room.notice.includes('ds-bot-test-known-secret-123456789'), false)
  assert.equal('preview' in room, false); assert.equal('secrets' in state, false)
  check('state/list/target expose the public room Session with explicit metadata allowlist')
  const message = { conversationId: room.id, sessionId: room.id, requestId: 'group_stable_1', text: 'count off' }
  const sent = await client.submit(message)
  assert.equal(sent.accepted, true); assert.deepEqual(await client.submit(message), sent)
  assert.deepEqual(await client.submission(message.requestId), sent)
  assert.equal((await api(urls.bridgeUrl, 'submissions', session.accessToken, { ...message, text: 'changed' })).status, 409)
  check('group stable request receipt and conflicting retry rejection')
  const history = await waitFor(async () => {
    const page = await client.messages(room.id)
    assert.equal(page.messages.filter(row => row.role === 'assistant').length, 2)
    return page
  })
  assert.equal(history.messages.filter(row => row.text === message.text).length, 1)
  assert.equal(history.messages.find(row => row.text === message.text).requestId, message.requestId)
  const replies = history.messages.filter(row => row.role === 'assistant')
  assert.deepEqual(new Set(replies.map(row => row.author.id)), new Set(seeded.members))
  assert.deepEqual(replies.map(row => row.text), ['1', '2'])
  assert.ok(replies.every(row => row.groupReplyId && row.sessionId === room.id))
  check('real existing group_relay returns two attributed mock member replies in order')
  const paged = new Map(); let cursor
  for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
    const page = await client.messages(room.id, { limit: 1, ...(cursor ? { cursor } : {}) })
    for (const row of page.messages) paged.set(row.id, row)
    cursor = page.cursor
    if (!cursor) break
  }
  assert.equal(cursor, null)
  assert.deepEqual(new Set([...paged.values()].filter(row => row.role === 'assistant').map(row => row.author.id)), new Set(seeded.members))
  check('one-message public history pages recover scoped relay call evidence')
  const upstream = await operator('test.group-state')
  const hidden = upstream.rooms.find(row => row.id === room.id).parts
  assert.equal(hidden.length, 2)
  const refreshed = await client.conversations()
  for (const id of hidden) {
    assert.equal(refreshed.conversations.some(row => row.id === id || row.sessionId === id || row.parts.includes(id)), false)
    const cursor = Buffer.from(JSON.stringify({ v: 1, conversationId: room.id, sessionId: id })).toString('base64url')
    assert.equal((await api(urls.bridgeUrl, `conversations/${room.id}/messages?cursor=${cursor}`, session.accessToken)).status, 403)
    assert.equal((await api(urls.bridgeUrl, 'submissions', session.accessToken, { ...message, requestId: `denied_${id}`, sessionId: id })).status, 409)
  }
  check('actual hidden member Sessions are absent and refused for history and sending')
  const frames = [], errors = []; let merged = []
  sdkStream = client.connect({ conversationId: room.id, onEvent(frame) { frames.push(frame); merged = applyConversationEvent(merged, frame) }, onError(error) { errors.push(error.code) } })
  await waitFor(() => assert.ok(frames.some(frame => frame.type === 'reset')))
  await operator('test.seed-secret')
  await client.submit({ ...message, requestId: 'group_live_redact', text: 'count off ds-bot-test-known-secret-123456789' })
  await waitFor(() => {
    assert.ok(frames.some(frame => frame.type === 'message' && frame.message.role === 'user' && frame.message.text === 'count off [secret:BRIDGE_FIXTURE_TOKEN]'))
    assert.equal(merged.filter(row => row.role === 'assistant').length, 4)
  })
  assert.deepEqual(errors, [])
  assert.equal(JSON.stringify(frames).includes('ds-bot-test-known-secret-123456789'), false)
  assert.equal(JSON.stringify(await client.messages(room.id)).includes('ds-bot-test-known-secret-123456789'), false)
  check('live group tool result author projection and upstream known-value redaction')
  await waitFor(() => assert.ok(frames.some(frame => frame.taskEvent?.kind === 'completed')))
  assert.ok(frames.filter(frame => frame.taskEvent).every(frame => frame.conversationId === room.id && frame.sessionId === room.id))
  const recent = (await client.conversations()).conversations.find(row => row.id === room.id)
  assert.ok(Number.isSafeInteger(recent.updatedAt) && recent.updatedAt > 0)
  assert.equal((await client.info()).capabilities.taskEvents, true)
  check('public Session activity timestamp and scoped live turn completion reach the SDK')
  const resets = frames.filter(frame => frame.type === 'reset').length
  sockets.at(-1).terminate()
  await waitFor(() => assert.ok(frames.filter(frame => frame.type === 'reset').length > resets))
  assert.equal(merged.filter(row => row.role === 'assistant').length, 4)
  assert.equal(new Set(merged.map(row => row.id)).size, merged.length)
  check('SDK automatically reconnects after socket loss and merges reset without duplicate replies')
  sdkStream.close(); sdkStream = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const ws = new WebSocket(urls.bridgeUrl.replace('http:', 'ws:') + '/mobile/v1/events'); sockets.push(ws)
    const reset = []; ws.on('message', bytes => reset.push(JSON.parse(bytes)))
    await once(ws, 'open'); ws.send(JSON.stringify({ type: 'auth', token: session.accessToken, conversationId: room.id, after: 0 }))
    await waitFor(() => assert.equal(reset.find(frame => frame.type === 'reset')?.messages.filter(row => row.role === 'assistant').length, 4))
    ws.close(); await once(ws, 'close')
  }
  check('group reconnect reset reconstructs attributed replies without hidden context')
  // Group management is allowed, but only well-formed requests on the visible team reach DS Bot.
  assert.equal((await api(urls.bridgeUrl, 'actions', session.accessToken, { endpoint: 'create-room', payload: {} })).status, 400)
  assert.equal((await api(urls.bridgeUrl, 'actions', session.accessToken, { endpoint: 'create-room', payload: { members: [urls.botId, 'not-on-team'] } })).status, 404)
  assert.equal((await api(urls.bridgeUrl, 'actions', session.accessToken, { endpoint: 'folder-list', payload: {} })).status, 403)
  check('group administration accepts only valid visible members; arbitrary actions stay refused')
  const bot = list.conversations.find(row => row.id === urls.botId)
  const action = (endpoint, payload = {}) => client.action(endpoint, payload)
  const caps = (await client.info()).capabilities
  assert.equal(caps.botProfileEditing, true); assert.equal(caps.memorySummary, false); assert.equal(caps.memoryTeam, false)
  assert.equal(caps.queue, true); assert.equal(caps.cancel, true)
  const models = (await action('models')).models
  const model = models.find(item => /deepseek-flash/.test(item.ref)) ?? models[0]
  assert.ok(model?.ref)
  const efforts = await action('efforts', { ref: model.ref })
  assert.ok(efforts.efforts.length)
  await action('update-bot', { id: bot.id, model: model.ref, effort: efforts.efforts[0].id })
  await action('set-flags', { id: bot.id, pinned: true })
  assert.equal((await client.state()).bots.find(row => row.id === bot.id).pinned, true)
  assert.equal((await client.state()).bots.find(row => row.id === bot.id).effort, efforts.efforts[0].id)
  // Profile edits reach DS Bot; a redaction marker is never written back over the real value.
  assert.equal((await api(urls.bridgeUrl, 'actions', session.accessToken, { endpoint: 'update-bot', payload: { id: bot.id, role: 'Edited [secret:KEY]' } })).status, 409)
  await action('update-bot', { id: bot.id, role: 'Mobile edited' })
  assert.equal((await client.state()).bots.find(row => row.id === bot.id).role, 'Mobile edited')
  for (const endpoint of ['approval-resolve', 'secret-set', 'memory-ask', 'schedule-update', 'folder-list', 'add-agent']) assert.equal((await api(urls.bridgeUrl, 'actions', session.accessToken, { endpoint, payload: {} })).status, 403)
  check('SDK model/effort, flags and profile edits work while arbitrary actions remain denied')
  const botMessage = { conversationId: bot.id, sessionId: bot.sessionId, requestId: 'bot_stable_1', text: 'Synthetic candidate hello ds-bot-test-known-secret-123456789' }
  const botReceipt = await client.submit(botMessage)
  assert.deepEqual(await client.submit(botMessage), botReceipt)
  assert.deepEqual(await client.submission(botMessage.requestId), botReceipt)
  const botHistory = await waitFor(async () => { const page = await client.messages(bot.id); const user = page.messages.find(row => row.requestId === botMessage.requestId); assert.ok(user); assert.ok(page.messages.some(row => row.role === 'assistant' && row.seq > user.seq)); return page })
  assert.equal(botHistory.messages.filter(row => row.requestId === botMessage.requestId).length, 1)
  assert.equal(JSON.stringify(botHistory).includes('ds-bot-test-known-secret-123456789'), false)
  check('Bot text and stable SDK receipt are persisted in real public Session history')
  const memory = await action('memory-view', { botId: bot.id })
  assert.ok(memory.entries.every(entry => entry.scope === 'own'))
  assert.deepEqual(Object.keys(memory.sizes).sort(), ['own', 'team'])
  assert.deepEqual(Object.keys(memory.limits).sort(), ['entry', 'main', 'topic', 'topics'])
  assert.equal(memory.summary, null); assert.equal(memory.summarizing, false)
  check('App memory payload and complete sizes/limits return the scoped own view')
  const scheduleView = await action('schedules')
  assert.equal(scheduleView.available, true)
  for (const targetId of [bot.id, room.id]) {
    const created = await action('schedule-create', { target: targetId, title: `Candidate ${targetId}`, prompt: 'Synthetic fixture reminder', when: { kind: 'every', minutes: 10080 } })
    const task = created.tasks.find(row => row.title === `Candidate ${targetId}`)
    assert.ok(task); assert.equal(task.sessionId, targetId === bot.id ? bot.sessionId : room.id)
    assert.ok((await action('schedules')).tasks.some(row => row.id === task.id))
    assert.equal((await action('schedule-delete', { sessionId: task.sessionId, id: task.id })).tasks.some(row => row.id === task.id), false)
  }
  assert.equal((await api(urls.bridgeUrl, 'actions', session.accessToken, { endpoint: 'schedule-delete', payload: { sessionId: 'foreign', id: 'foreign' } })).status, 404)
  check('Bot and group schedule create/read/delete use actual DSH service and deny foreign IDs')
  await client.submit({ ...botMessage, requestId: 'bot_running', text: '长任务 20 1' })
  await waitFor(async () => { const page = await client.messages(bot.id); assert.ok(page.messages.some(row => row.requestId === 'bot_running')) })
  await waitFor(async () => {
    const running = await client.state()
    assert.ok(running.work.bots[bot.id])
    assert.ok(Number.isSafeInteger(running.work.bots[bot.id].since))
    for (const key of ['tool', 'said', 'note', 'target']) assert.equal(key in running.work.bots[bot.id], false)
  })
  const resumed = []
  sdkStream = client.connect({ conversationId: bot.id, onEvent(frame) { resumed.push(frame) } })
  await waitFor(() => assert.equal(resumed.find(frame => frame.type === 'reset')?.busy, true))
  assert.equal((await client.conversations()).conversations.find(row => row.id === bot.id).busy, true)
  check('an already running desktop Bot restores safe work state and reconnect busy status')
  await client.submit({ ...botMessage, requestId: 'bot_queued', text: 'Synthetic queued message' })
  const queue = await waitFor(async () => { const value = await action('queue', { conversationId: bot.id }); assert.ok(value.items.some(row => row.requestId === 'bot_queued')); return value })
  const queued = queue.items.find(row => row.requestId === 'bot_queued')
  assert.equal(queued.target, 'next-turn'); assert.equal(queued.text, 'Synthetic queued message')
  await action('queue-remove', { conversationId: bot.id, sessionId: bot.sessionId, itemId: queued.id })
  assert.equal((await action('queue', { conversationId: bot.id })).items.some(row => row.id === queued.id), false)
  const cancel = await client.cancel(bot.id)
  assert.equal(cancel.queueCleared, false); assert.equal(cancel.sessionId, bot.sessionId)
  await waitFor(() => assert.ok(resumed.some(frame => frame.taskEvent?.kind === 'cancelled')))
  sdkStream.close(); sdkStream = null
  check('real queued user message has device receipt/target; remove and cancel use public controller')
  const usage = await waitFor(async () => { const value = await action('usage', { timeZone: 'UTC' }); assert.ok(value.rows.length); return value })
  assert.ok(usage.owners.every(owner => typeof owner.key === 'string' && list.conversations.some(row => row.id === owner.id && row.kind === owner.kind)))
  assert.ok(usage.rows.every(row => row.length === 9 && usage.owners[row[1]] && usage.models[row[2]] && usage.kinds[row[3]] && row.slice(4).every(n => Number.isFinite(n) && n >= 0)))
  assert.ok(usage.rows.some(row => row.slice(4).some(n => n > 0)))
  check('nonempty real Usage uses App nine-column rows and stable visible owner keys')
  await operator('test.seed-labels')
  const labeled = await client.state()
  assert.equal(labeled.bots.find(row => row.id === bot.id).name, 'Bot [secret:BRIDGE_FIXTURE_TOKEN]')
  assert.equal(labeled.rooms.find(row => row.id === room.id).name, 'Room [secret:BRIDGE_FIXTURE_TOKEN]')
  assert.equal(JSON.stringify(labeled).includes('ds-bot-test-known-secret-123456789'), false)
  await client.submit({ ...message, requestId: 'group_labeled_author', text: 'count off' })
  const labelHistory = await waitFor(async () => {
    const page = await client.messages(room.id)
    const user = page.messages.find(row => row.requestId === 'group_labeled_author')
    assert.ok(user)
    const replies = page.messages.filter(row => row.role === 'assistant' && row.seq > user.seq)
    assert.equal(replies.length, 2)
    return page
  })
  await writeFile(join(fixture.home, 'author-labels.json'), JSON.stringify(labelHistory.messages.filter(row => row.role === 'assistant').map(row => row.author)), { mode: 0o600 })
  const updatedAuthor = labelHistory.messages.filter(row => row.role === 'assistant' && row.author.id === bot.id).at(-1).author
  // Upstream redacts the tool result first; the local assignment guard then masks its marker label.
  assert.equal(updatedAuthor.name, 'Bot [secret:[redacted]')
  assert.equal(JSON.stringify(labelHistory).includes('ds-bot-test-known-secret-123456789'), false)
  check('Bot/group state names and group author labels pass DS Bot known-value redaction')
  {
    // Full team management against the real DS Bot: create, edit, promote, group, then remove.
    const created = await action('create-bot', { name: 'MobileMade', role: '', instructions: 'Answer in one line.', color: 'green', avatar: { shape: 'kitty' } })
    let team = await client.state()
    const made = team.bots.find(row => row.id === created.id)
    assert.equal(made.name, 'MobileMade'); assert.equal(made.instructions, 'Answer in one line.')
    assert.deepEqual(await action('update-bot', { id: made.id, instructions: 'Answer in one line.' }), { id: made.id, changed: false })
    await action('update-bot', { id: made.id, name: 'MobileRenamed', instructions: 'Answer briefly.' })
    await action('set-main', { id: made.id, main: true })
    team = await client.state()
    assert.equal(team.bots.find(row => row.id === made.id).name, 'MobileRenamed')
    assert.ok(team.mainBotIds.includes(made.id))
    const group = await action('create-room', { name: 'MobileRoom', members: [bot.id, made.id] })
    await action('update-room', { id: group.id, notice: 'Mobile notice', mode: 'everyone' })
    const listed = (await client.state()).rooms.find(row => row.id === group.id)
    assert.equal(listed.notice, 'Mobile notice'); assert.equal(listed.mode, 'everyone')
    await action('set-prefs', { motion: 'lively' })
    assert.equal((await client.state()).prefs.motion, 'lively')
    await action('delete-room', { id: group.id })
    await action('set-main', { id: made.id, main: false })
    await action('delete-bot', { id: made.id })
    team = await client.state()
    assert.equal(team.rooms.some(row => row.id === group.id), false); assert.equal(team.bots.some(row => row.id === made.id), false)
  }
  check('Bot and group management round-trips through the real DS Bot channel')
  {
    // The team's DSH Agent: refused until the owner allows this phone, then opened,
    // chatted with in plain text, and closed again when the grant is removed.
    assert.equal((await client.state()).agentAccess, false)
    assert.equal((await client.conversations()).conversations.some(row => row.kind === 'agent'), false)
    assert.equal((await api(urls.bridgeUrl, 'actions', session.accessToken, { endpoint: 'agent-open', payload: {} })).status, 403)
    const granted = await operator('device.agents', { id: session.deviceId, enabled: true })
    assert.equal(granted.ok ?? true, true)
    assert.equal((await client.state()).agentAccess, true)
    const opened = await action('agent-open', {})
    assert.match(opened.conversationId, /^agent:[^:]+:[^:]+$/)
    assert.deepEqual(await action('agent-open', {}), opened)
    const agentState = await client.state()
    assert.equal(agentState.agents.length, 1)
    assert.deepEqual(agentState.agents[0].sessions, [opened.sessionId])
    assert.equal((await client.target(opened.conversationId)).kind, 'agent')
    const agentMessage = { conversationId: opened.conversationId, sessionId: opened.sessionId, requestId: 'agent_stable_1', text: 'hello agent' }
    assert.equal((await client.submit(agentMessage)).accepted, true)
    assert.deepEqual(await client.submit(agentMessage), await client.submission(agentMessage.requestId))
    const agentHistory = await waitFor(async () => {
      const page = await client.messages(opened.conversationId)
      assert.ok(page.messages.some(row => row.role === 'assistant'))
      return page
    })
    assert.equal(agentHistory.messages.filter(row => row.role === 'user' && row.text === 'hello agent').length, 1)
    assert.equal(agentHistory.messages.find(row => row.role === 'user').requestId, 'agent_stable_1')
    // A Bot Session cannot be addressed as the Agent.
    const forged = `agent:${opened.agentId}:${agentState.bots[0].sessionId}`
    assert.equal((await api(urls.bridgeUrl, `conversations/${encodeURIComponent(forged)}/target`, session.accessToken)).status, 404)
    await operator('device.agents', { id: session.deviceId, enabled: false })
    assert.equal((await client.state()).agents.length, 0)
    assert.equal((await api(urls.bridgeUrl, `conversations/${encodeURIComponent(opened.conversationId)}/target`, session.accessToken)).status, 404)
    assert.equal((await api(urls.bridgeUrl, 'submissions', session.accessToken, { ...agentMessage, requestId: 'agent_after_revoke' })).status, 404)
  }
  check('owner-granted DSH Agent opens, chats in plain text through the real DS Bot channel and closes on revoke')
  console.log(`${passed} CANDIDATE integration assertions passed; public DSH 0.2.1-rc.2 + reviewed DS Bot fixture source + scripted mock.`)
} catch (error) {
  console.error(`Group integration failed: ${error.code ?? error.name}: ${error.message}`)
  if (fixture) await writeFile(join(fixture.home, 'failure.log'), fixture.diagnostics())
  process.exitCode = 1
} finally {
  sdkStream?.close(); client?.dispose()
  for (const socket of sockets) if (socket.readyState !== WebSocket.CLOSED) socket.terminate()
  await fixture?.close()
}
