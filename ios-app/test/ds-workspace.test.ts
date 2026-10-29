import test from 'node:test';
import assert from 'node:assert/strict';
import type { MobileClient } from '@ds-bot/mobile-sdk';
import { createDsWorkspaceCoordinator } from '../src/ds/workspace.ts';
import type { DsSnapshot } from '../src/ds/contracts.ts';
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
test('fresh refresh waits out pre-write poll, then publishes and returns canonical snapshot', async () => {
    const held = deferred();
    let reads = 0;
    const published: DsSnapshot[] = [];
    const client = { state: async () => { const n = ++reads; if (n === 1)
            await held.promise; return { bots: [{ id: String(n), name: 'Bot' }], rooms: [], models: [] }; }, conversations: async () => ({ conversations: [] }), info: async () => ({ serverId: 'host', capabilities: { send: true } }) } as unknown as MobileClient;
    const workspace = createDsWorkspaceCoordinator({ client, serverId: 'host', isCurrent: () => true, publish: s => { published.push(s); } });
    const poll = workspace.refresh(), fresh = workspace.refresh({ fresh: true });
    await tick();
    assert.equal(reads, 1);
    held.resolve();
    await poll;
    const result = await fresh;
    assert.equal(result?.team.bots[0].id, '2');
    assert.equal(result?.source, 'live');
    assert.equal(published.at(-1), result);
});
test('old host responses are discarded, including fresh reads waiting behind an old poll', async () => {
    const held = deferred();
    let active = true, reads = 0, published = 0;
    const client = { state: async () => { reads++; await held.promise; return {}; }, conversations: async () => ({ conversations: [] }), info: async () => ({ serverId: 'host' }) } as unknown as MobileClient;
    const workspace = createDsWorkspaceCoordinator({ client, serverId: 'host', isCurrent: () => active, publish: () => { published++; } });
    const poll = workspace.refresh(), fresh = workspace.refresh({ fresh: true });
    active = false;
    held.resolve();
    assert.equal(await poll, undefined);
    assert.equal(await fresh, undefined);
    assert.equal(published, 0);
    assert.equal(reads, 1);
});
test('only latest overlapping fresh request publishes; an older caller gets no trusted result', async () => {
    const first = deferred(), second = deferred();
    let reads = 0;
    const published: string[] = [];
    const client = { state: async () => { const n = ++reads; if (n === 1)
            await first.promise; if (n === 2)
            await second.promise; return { bots: [{ id: String(n) }] }; }, conversations: async () => ({ conversations: [] }), info: async () => ({ serverId: 'host' }) } as unknown as MobileClient;
    const workspace = createDsWorkspaceCoordinator({ client, serverId: 'host', isCurrent: () => true, publish: s => { published.push(s.team.bots[0].id); } });
    const poll = workspace.refresh(), a = workspace.refresh({ fresh: true }), b = workspace.refresh({ fresh: true });
    first.resolve();
    await poll;
    await tick();
    second.resolve();
    await Promise.all([a, b]);
    assert.equal(published.at(-1), '3');
    assert.ok(!published.includes('2'));
});
test('wrong server discovery is never published as a live snapshot', async () => {
    const client = { state: async () => ({}), conversations: async () => ({ conversations: [] }), info: async () => ({ serverId: 'other' }) } as unknown as MobileClient;
    const workspace = createDsWorkspaceCoordinator({ client, serverId: 'host', isCurrent: () => true, publish: () => assert.fail('foreign publish') });
    await assert.rejects(workspace.refresh(), { code: 'STALE_HOST' });
});
test('an older refresh failure cannot mark a newer successful snapshot offline', async () => {
    let reject!: (error: Error) => void, reads = 0;
    const failed = new Promise<never>((_, no) => { reject = no; });
    const gate = deferred();
    const client = { state: async () => { const n = ++reads; if (n === 1)
            await gate.promise; if (n === 2)
            return failed; return {}; }, conversations: async () => ({ conversations: [] }), info: async () => ({ serverId: 'host' }) } as unknown as MobileClient;
    const workspace = createDsWorkspaceCoordinator({ client, serverId: 'host', isCurrent: () => true, publish: () => { } });
    const poll = workspace.refresh(), old = workspace.refresh({ fresh: true }), latest = workspace.refresh({ fresh: true });
    gate.resolve();
    await poll;
    await tick();
    await latest;
    reject(new Error('old failure'));
    assert.equal(await old, undefined);
});
