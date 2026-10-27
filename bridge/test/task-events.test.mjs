import test from 'node:test'
import assert from 'node:assert/strict'
import { projectTaskEvent, projectApprovalEvent } from '../src/task-events.mjs'

const scope = { conversationId: 'bot', sessionId: 'chat', hiddenTurns: [3] }
const end = (kind, patch = {}) => ({ type: 'turn/end', seq: 12, time: 1000, data: { turn: 4, reason: { kind, error: { message: 'private failure', token: 'private token' } } }, ...patch })

test('turn outcomes remain distinguishable without releasing errors or other raw event fields', () => {
  for (const [reason, kind] of [['completed', 'completed'], ['error', 'failed'], ['aborted', 'cancelled'], ['blocked', 'blocked'], ['max-tokens', 'max-tokens'], ['interrupted', 'interrupted'], ['forked', 'forked'], ['future-reason', 'ended'], [undefined, 'ended']]) {
    assert.deepEqual(projectTaskEvent(end(reason), scope), {
      type: 'status', conversationId: 'bot', sessionId: 'chat', busy: false, phase: 'idle', eventSeq: 12,
      taskEvent: { id: '["turn","chat",12]', kind, turn: 4, createdAt: 1000 },
    })
  }
})

test('running events have stable identities isolated by Session and do not expose hidden turns', () => {
  const event = { type: 'turn/start', seq: 11, time: 900, data: { turn: 4, secret: 'private' } }
  assert.deepEqual(projectTaskEvent(event, scope), {
    type: 'status', conversationId: 'bot', sessionId: 'chat', busy: true, phase: 'running', eventSeq: 11,
    taskEvent: { id: '["turn","chat",11]', kind: 'running', turn: 4, createdAt: 900 },
  })
  assert.notEqual(projectTaskEvent(event, scope).taskEvent.id, projectTaskEvent(event, { ...scope, sessionId: 'other-chat' }).taskEvent.id)
  assert.equal(projectTaskEvent(end('completed', { data: { turn: 3, reason: { kind: 'completed' } } }), scope), null)
  for (const event of [null, end('completed', { seq: -1 }), end('completed', { seq: 1.2 }), { type: 'tool/result', seq: 12, data: { isError: true } }]) assert.equal(projectTaskEvent(event, scope), null)
})

test('malformed timestamps and turn numbers are never reflected', () => {
  assert.deepEqual(projectTaskEvent(end('completed', { time: 'private', data: { turn: 'private', reason: { kind: 'completed' } } }), scope).taskEvent, { id: '["turn","chat",12]', kind: 'completed' })
  assert.equal(projectTaskEvent(end('completed'), { ...scope, sessionId: '' }), null)
})

test('approval events carry only a scoped identity and observation time', () => {
  const input = { conversationId: 'bot', sessionId: 'chat', approvalId: 'random-request', createdAt: 1200, reason: 'private', detail: { code: 'private' } }
  assert.deepEqual(projectApprovalEvent(input), {
    type: 'status', conversationId: 'bot', sessionId: 'chat', busy: true, phase: 'running', approvalRequired: true,
    taskEvent: { id: '["approval","chat","random-request"]', kind: 'approval-required', createdAt: 1200 },
  })
  assert.equal(projectApprovalEvent({ ...input, approvalId: '' }), null)
  assert.equal(projectApprovalEvent({ ...input, sessionId: '' }), null)
})
