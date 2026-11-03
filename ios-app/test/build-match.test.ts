import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BuildMismatchError, buildTag, matchPairing } from '../src/logic/build-match.ts';
import { parsePairing } from '../src/logic/pairing.ts';
import { createAdminKey, createRelayAdmin } from '../src/logic/relay-admin.ts';
import { approveWaitingComputer, ComputerNotApprovedError } from '../src/logic/relay-approve.ts';
// The plugin's and relay's own tags, so the formats cannot drift apart.
import { buildTag as pluginTag } from '../../plugin/bridge/src/build-tag.mjs';
import { createRelay } from '../../plugin/tools/relay/server.mjs';
import { createApprovals } from '../../plugin/tools/relay/approvals.mjs';

const KEY = 'q'.repeat(43);

test('the app and plugin compute the same build tags', () => {
  for (const purpose of ['plugin', 'app', 'relay'] as const) assert.equal(buildTag(KEY, purpose, 'value-1'), pluginTag(KEY, purpose, 'value-1'));
});

test('an official app pairs only with codes the official plugin tagged', () => {
  const serverId = 'server-1', code = 'code-1';
  const official = parsePairing(JSON.stringify({ url: 'https://pc.example', code, serverId, build: pluginTag(KEY, 'plugin', serverId) }));
  assert.equal(matchPairing(official, KEY), pluginTag(KEY, 'app', code), 'the claim carries the app proof');
  const untagged = parsePairing(JSON.stringify({ url: 'https://pc.example', code, serverId }));
  assert.throws(() => matchPairing(untagged, KEY), BuildMismatchError, 'another plugin is refused');
  const otherKey = parsePairing(JSON.stringify({ url: 'https://pc.example', code, serverId, build: pluginTag('z'.repeat(43), 'plugin', serverId) }));
  assert.throws(() => matchPairing(otherKey, KEY), BuildMismatchError, 'a plugin built with another key is refused');
  assert.equal(matchPairing(untagged, null), undefined, 'a build without the key checks nothing');
});

test('scanning a waiting computer approves it only from the admin phone', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'phone-approve-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const approvals = await createApprovals({ file: join(dir, 'approvals.json'), bootstrapFile: join(dir, 'code') });
  const relay = await (createRelay as any)({ origin: 'wss://fixture.example', port: 0, openRegistration: true, approvals });
  t.after(() => relay.close());
  const local = ((url: string, init?: RequestInit) => fetch(String(url).replace('https://fixture.example', relay.url), init)) as typeof fetch;
  const adminKey = createAdminKey(new Uint8Array(randomBytes(32))), strangerKey = createAdminKey(new Uint8Array(randomBytes(32)));
  await createRelayAdmin({ relay: 'wss://fixture.example', key: adminKey, fetch: local }).claim(await readFile(join(dir, 'code'), 'utf8'));
  const id = 'B'.repeat(22);
  await approvals.notePending(id, 'Desk');
  await assert.rejects(approveWaitingComputer('wss://fixture.example', id, { key: async () => strangerKey, fetch: local }), ComputerNotApprovedError);
  assert.equal(approvals.isApproved(id), false);
  await approveWaitingComputer('wss://fixture.example', id, { key: async () => adminKey, fetch: local });
  assert.equal(approvals.isApproved(id), true);
});
