import test from 'node:test';
import assert from 'node:assert/strict';
import * as sdk from '../index.js';

const frame = (patch = {}) => ({ type: 'status', conversationId: 'bot', sessionId: 'chat', busy: false, phase: 'idle', taskEvent: { id: 'event-12', kind: 'completed', turn: 4, createdAt: 1000 }, ...patch });

test('task event reading exposes an explicit safe shape and rejects malformed events', () => {
  assert.equal(typeof sdk.readTaskEvent, 'function');
  assert.deepEqual(sdk.readTaskEvent(frame({ taskEvent: { ...frame().taskEvent, private: 'omitted' } })), { conversationId: 'bot', sessionId: 'chat', id: 'event-12', kind: 'completed', turn: 4, createdAt: 1000 });
  for (const value of [null, frame({ type: 'error' }), frame({ sessionId: '' }), frame({ taskEvent: { id: 'x', kind: 'unrecognized' } }), frame({ taskEvent: null })]) assert.equal(sdk.readTaskEvent(value), null);
});

test('notification deduplication separates computers, conversations and Sessions without mutating status', () => {
  assert.equal(typeof sdk.createTaskEventTracker, 'function');
  const tracker = sdk.createTaskEventTracker();
  const event = frame();
  const original = structuredClone(event);
  assert.deepEqual(tracker.take('computer-a', event), { serverId: 'computer-a', conversationId: 'bot', sessionId: 'chat', id: 'event-12', kind: 'completed', turn: 4, createdAt: 1000 });
  assert.equal(tracker.take('computer-a', event), null);
  assert.ok(tracker.take('computer-b', event));
  assert.ok(tracker.take('computer-a', frame({ conversationId: 'other-bot' })));
  assert.ok(tracker.take('computer-a', frame({ sessionId: 'other-chat' })));
  assert.equal(tracker.take('', event), null);
  assert.deepEqual(event, original);
});

test('bounded task event tracking evicts old identities and can clear one computer', () => {
  assert.equal(typeof sdk.createTaskEventTracker, 'function');
  const tracker = sdk.createTaskEventTracker({ limit: 2 });
  const one = frame(), two = frame({ taskEvent: { id: 'event-13', kind: 'failed' } }), three = frame({ taskEvent: { id: 'event-14', kind: 'approval-required' } });
  tracker.take('a', one); tracker.take('a', two); tracker.take('a', three);
  assert.equal(tracker.take('a', two), null);
  assert.ok(tracker.take('a', one));
  tracker.take('b', two);
  tracker.clear('a');
  assert.equal(tracker.take('b', two), null);
  assert.ok(tracker.take('a', one));
  tracker.clear();
  assert.ok(tracker.take('b', two));
  assert.throws(() => sdk.createTaskEventTracker({ limit: 0 }), RangeError);
  assert.throws(() => sdk.createTaskEventTracker({ limit: 10001 }), RangeError);
});
