import test from 'node:test';
import assert from 'node:assert/strict';
import { chatRows } from '../src/chat/rows.ts';

const message = (id: string, extra: any = {}): any => ({ id, sessionId: 's', seq: 1, role: 'user', text: id, createdAt: 1, ...extra });
const item = (requestId: string, state: any, createdAt = 10): any => ({ requestId, conversationId: 'c', text: requestId, attachments: [], createdAt, state, attempts: 0 });

test('outgoing items follow the transcript and map outbox states to bubble states', () => {
  const rows = chatRows([message('a')], [item('r2', 'queued', 20), item('r1', 'sent', 10), item('r3', 'unconfirmed'), item('r4', 'rejected')]);
  assert.deepEqual(rows.map(row => [row.key, row.send?.state]), [['a', undefined], ['outbox:r1', 'sent'], ['outbox:r3', 'failed'], ['outbox:r4', 'rejected'], ['outbox:r2', 'sending']]);
});

test('an echoed request leaves the outbox view; the SDK placeholder is replaced by the real row', () => {
  const rows = chatRows([message('real', { requestId: 'r1' }), message('accepted:r1', { requestId: 'r1', localSubmission: true })], [item('r1', 'sent')]);
  assert.deepEqual(rows.map(row => row.key), ['real']);
});

test('a placeholder stands in for its outbox item until the real row arrives', () => {
  const rows = chatRows([message('accepted:r1', { requestId: 'r1', localSubmission: true })], [item('r1', 'sent')]);
  assert.deepEqual(rows.map(row => row.key), ['accepted:r1']);
});
