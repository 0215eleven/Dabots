import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionHub, createRecoveryDetector } from '../src/connection/hub.ts';

function fixture() {
  const calls: string[] = [];
  let appListener: (s: string) => void = () => {}, netListener: (s: any) => void = () => {}, pushListener: (d: any) => void = () => {};
  const appState = { currentState: 'active', addEventListener: (_: 'change', l: (s: string) => void) => { appListener = l; return { remove() { calls.push('app-removed'); } }; } };
  const hub = createConnectionHub({
    appState, network: { addListener: l => { netListener = l; return { remove() { calls.push('net-removed'); } }; } },
    reconnectStreams: () => { calls.push('streams'); }, resumeOutbox: () => { calls.push('outbox'); }, refreshWorkspace: () => { calls.push('workspace'); },
    pushes: { addListener: l => { pushListener = l; return { remove() { calls.push('push-removed'); } }; } },
  });
  return { hub, calls, app: (s: string) => appListener(s), net: (s: any) => netListener(s), push: (d: any) => pushListener(d) };
}

test('recovery detector fires on offline to online and on an interface switch, not on steady state', () => {
  let count = 0;
  const detect = createRecoveryDetector(() => count++);
  detect({ type: 'WIFI', isConnected: true, isInternetReachable: true });
  detect({ type: 'WIFI', isConnected: true, isInternetReachable: true });
  assert.equal(count, 0);
  detect({ type: 'NONE', isConnected: false, isInternetReachable: false });
  assert.equal(count, 0);
  detect({ type: 'CELLULAR', isConnected: true, isInternetReachable: true });
  assert.equal(count, 1);
  detect({ type: 'WIFI', isConnected: true, isInternetReachable: true });
  assert.equal(count, 2);
  detect({ type: 'WIFI', isConnected: true, isInternetReachable: false });
  detect({ type: 'WIFI', isConnected: true, isInternetReachable: true });
  assert.equal(count, 3);
});

test('network recovery reconnects streams, resumes the outbox and refreshes immediately', () => {
  const f = fixture();
  f.hub.start();
  f.net({ type: 'WIFI', isConnected: true, isInternetReachable: true });
  f.net({ type: 'NONE', isConnected: false });
  f.net({ type: 'WIFI', isConnected: true, isInternetReachable: true });
  assert.deepEqual(f.calls, ['streams', 'outbox', 'workspace']);
});

test('returning to the foreground and a push both catch up; a push while backgrounded waits for the foreground', async () => {
  const f = fixture();
  f.hub.start();
  f.app('background');
  f.push({ conversationId: 'chief' });
  assert.deepEqual(f.calls, []);
  f.app('active');
  assert.deepEqual(f.calls, ['streams', 'outbox', 'workspace']);
  await new Promise(resolve => setTimeout(resolve, 300));
  f.push({ conversationId: 'chief' });
  assert.equal(f.calls.filter(call => call === 'streams').length, 2);
});

test('stop removes every listener', () => {
  const f = fixture();
  f.hub.start(); f.hub.stop();
  assert.deepEqual(f.calls.sort(), ['app-removed', 'net-removed', 'push-removed']);
});
