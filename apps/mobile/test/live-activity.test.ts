import test from 'node:test';
import assert from 'node:assert/strict';
import { planActivity, summarizeWork } from '../src/liveactivity/plan.ts';

const team = (work: any, bots = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]): any => ({ bots, rooms: [], models: [], work });

test('nothing running means no activity', () => {
  assert.equal(summarizeWork(team({ bots: {}, approvals: [] }), 'Mac'), null);
  assert.equal(summarizeWork(team(undefined), 'Mac'), null);
});

test('a running Bot is summarized with its progress and start time', () => {
  const state = summarizeWork(team({ bots: { a: { said: ' Reading   files ', since: 500 } }, approvals: [] }), 'Mac')!;
  assert.deepEqual(state, { phase: 'running', title: 'Alpha', detail: 'Reading files', count: 1, since: 500, host: 'Mac' });
});

test('several Bots collapse into a count and the oldest start; approvals take priority', () => {
  const work = { bots: { a: { since: 900 }, b: { since: 400, tool: 'shell' } }, approvals: [] as any[] };
  const running = summarizeWork(team(work), 'Mac')!;
  assert.equal(running.title, '2 Bots'); assert.equal(running.since, 400);
  const waiting = summarizeWork(team({ ...work, approvals: [{ id: 'x', botId: 'a' }] }), 'Mac')!;
  assert.equal(waiting.phase, 'waiting'); assert.equal(waiting.title, 'Alpha');
  assert.equal(summarizeWork(team(work), 'Mac', true)!.phase, 'offline');
});

test('the plan starts once, drops identical updates, and ends with a done frame', () => {
  const running = summarizeWork(team({ bots: { a: { said: 'x', since: 1 } }, approvals: [] }), 'Mac')!;
  const started = planActivity(null, running);
  assert.equal(started.type, 'start');
  assert.equal(planActivity(running, { ...running }).type, 'none');
  assert.equal(planActivity(running, { ...running, detail: 'y' }).type, 'update');
  const ended = planActivity(running, null);
  assert.equal(ended.type, 'end'); assert.equal((ended as any).state.phase, 'done');
  assert.equal(planActivity({ ...running, phase: 'done' }, null).type, 'none');
  assert.equal(planActivity({ ...running, phase: 'done' }, running).type, 'start');
  assert.equal(planActivity(null, null).type, 'none');
});
