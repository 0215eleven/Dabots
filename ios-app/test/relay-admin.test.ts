import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdminKey, createRelayAdmin, RelayAdminError } from '../src/logic/relay-admin.ts';
// The phone's signing against the real relay admin API, so the two formats cannot drift apart.
import { createRelay } from '../../plugin/tools/relay/server.mjs';
import { createApprovals } from '../../plugin/tools/relay/approvals.mjs';

const origin = 'wss://fixture.example';

test('the phone admin key claims the relay and approves a waiting computer', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'phone-admin-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const approvals = await createApprovals({ file: join(dir, 'approvals.json'), bootstrapFile: join(dir, 'code') });
  const relay = await (createRelay as any)({ origin, port: 0, openRegistration: true, approvals });
  t.after(() => relay.close());
  // The phone talks to the relay's public https origin; route it to the local test server.
  const local = ((url: string, init?: RequestInit) => fetch(String(url).replace('https://fixture.example', relay.url), init)) as typeof fetch;
  const admin = createRelayAdmin({ relay: origin, key: createAdminKey(new Uint8Array(randomBytes(32))), fetch: local });
  assert.deepEqual(await admin.status(), { admin: false, claimable: true });
  await assert.rejects(admin.claim('not-the-code'), (error: unknown) => error instanceof RelayAdminError && error.code === 'INVALID_CODE');
  await admin.claim(await readFile(join(dir, 'code'), 'utf8'));
  assert.equal((await admin.status()).admin, true);
  await approvals.notePending('A'.repeat(22), 'Office PC');
  const { pending } = await admin.devices();
  assert.deepEqual(pending.map(item => [item.computerId, item.name]), [['A'.repeat(22), 'Office PC']]);
  await admin.approve('A'.repeat(22));
  assert.deepEqual((await admin.devices()).approved.map(item => item.computerId), ['A'.repeat(22)]);
  await admin.revoke('A'.repeat(22));
  assert.deepEqual((await admin.devices()).approved, []);
  const stranger = createRelayAdmin({ relay: origin, key: createAdminKey(new Uint8Array(randomBytes(32))), fetch: local });
  await assert.rejects(stranger.devices(), (error: unknown) => error instanceof RelayAdminError && error.code === 'ADMIN_REQUIRED');
});
