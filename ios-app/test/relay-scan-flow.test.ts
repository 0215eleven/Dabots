import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createRelay } from '../../plugin/tools/relay/server.mjs';
import { createAccess } from '../../plugin/tools/relay/access.mjs';
import { createMobileServer } from '../../plugin/bridge/src/server.js';
import { createRelaySettings } from '../../plugin/bridge/src/relay-settings.mjs';
import { createDeviceController } from '../../plugin/ui/src/controller.mjs';
import { createRelayTransport } from '../sdk/relay-transport.js';
import { MobileClient, MemoryTokenStore } from '../sdk/index.js';
import { parsePairing } from '../src/logic/pairing.ts';
import { createPhoneKey, createRelayAccess, signPhoneConnection } from '../src/logic/relay-access.ts';

const { WebSocket } = createRequire(new URL('../../plugin/bridge/package.json', import.meta.url))('ws');
const origin = 'wss://fixture.example';
const until = async (check: () => boolean) => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) { if (check()) return; await new Promise(done => setTimeout(done, 10)); }
  throw new Error('Local relay did not become ready.');
};

for (const nativeOrigin of [false, true]) {
  test(`invited phone scans desktop QR and pairs once through encrypted relay (${nativeOrigin ? 'native HTTPS Origin' : 'no Origin'})`, { timeout: 10000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'dabots-scan-test-'));
    let relay: any, access: any, server: any, settings: any, controller: any, client: MobileClient | undefined;
    let transport: ReturnType<typeof createRelayTransport> | undefined;
    t.after(async () => {
      controller?.dispose(); client?.dispose(); transport?.dispose();
      await settings?.dispose(); await server?.close(); await relay?.close(); await access?.close();
      const target = resolve(root);
      assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
      assert.ok(target.toLowerCase().includes('dabots-scan-test-'));
      await rm(target, { recursive: true, force: true });
    });
    access = await createAccess({ file: join(root, 'access.json'), initialize: true });
    relay = await (createRelay as any)({ origin, port: 0, access });
    class LocalSocket extends WebSocket {
      constructor(url: string) {
        super(String(url).replace(origin, relay.url.replace('http:', 'ws:')),
          nativeOrigin && String(url).includes('/v1/phone?') ? { origin: 'https://fixture.example' } : undefined);
      }
    }
    const key = createPhoneKey(new Uint8Array(32).fill(7));
    const localFetch = ((url: string | URL | Request, init?: RequestInit) =>
      fetch(String(url).replace('https://fixture.example', relay.url), init)) as typeof fetch;
    const admission = createRelayAccess({ relay: origin, key, fetch: localFetch, randomBytes: length => new Uint8Array(randomBytes(length)) });
    const [invite] = await access.issue({});
    await admission.redeem(invite.code);
    server = await (createMobileServer as any)({ home: join(root, 'bridge'), config: { devAllowInsecure: true },
      adapter: { capabilities: () => ({}), state: async () => ({ scanTest: 'authenticated' }), dispose: async () => {} } });
    settings = await (createRelaySettings as any)({ home: join(root, 'bridge'), server, Socket: LocalSocket, officialRelay: origin });
    await settings.official(); await until(() => settings.snapshot().state === 'pending');
    const calls: string[] = [];
    // The production carrier's status and QR composition (plugin/bridge/index.mjs).
    controller = createDeviceController({ uuid: randomUUID, call: async (method: string, payload: any) => {
      calls.push(method);
      if (method === 'status') return { ...await server.operator('status'), relay: settings.snapshot(), pairing: settings.pairingStatus() };
      if (method === 'pairing.create') return settings.pairing(payload);
      return server.operator(method, payload);
    } });
    await controller.refresh(); await controller.autoPair();
    let copied = '';
    await controller.copy({ writeText: async (value: string) => { copied = value; } });
    const pairing = parsePairing(copied);
    assert.equal(pairing.kind, 'relay');
    if (pairing.kind !== 'relay') throw new Error('Expected a relay QR.');
    assert.equal(pairing.pending, true);
    assert.equal(pairing.access, 1); assert.match(pairing.linkNonce!, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(JSON.parse(copied).leaseId, undefined);
    await admission.associate({ ...pairing, linkNonce: pairing.linkNonce! });
    transport = createRelayTransport({ ...pairing, requireAccess: true, authenticate: async challenge => signPhoneConnection(challenge, key), randomBytes: (length: number) => new Uint8Array(randomBytes(length)), WebSocket: LocalSocket as unknown as typeof globalThis.WebSocket });
    client = new MobileClient({ ...transport, tokenStore: new MemoryTokenStore(), requestTimeoutMs: 2000 });
    assert.equal((await client.info()).serverId, pairing.serverId);
    await until(() => settings.snapshot().ready);
    await controller.refresh();
    assert.equal(calls.includes('pairing.cancel'), false, 'the association poll must retain the scanned lease');
    const claim = await client.pair(pairing.code, 'Disposable scan fixture');
    await controller.refresh();
    assert.equal(controller.snapshot().pairingResult, 'claimed');
    assert.ok((await client.completePairing(claim.claimToken)).accessToken);
    await controller.refresh();
    assert.equal(controller.snapshot().pairingResult, 'paired');
    assert.equal((await client.state() as any).scanTest, 'authenticated');
    assert.equal((await server.operator('status')).devices.length, 1);
    assert.equal(calls.includes('pairing.approve'), false, 'the automatic owner QR needs no second desktop approval');
    controller.clearPairing();
    assert.equal(calls.includes('pairing.cancel'), false, 'clearing completed UI must not revoke the device');
  });
}
