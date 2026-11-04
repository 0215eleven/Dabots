# Relay phone invitations implementation plan

> **For agentic workers:** Use test-driven implementation with focused delegation for the access store, then integration and a fresh whole-change review.

**Goal:** One server-issued invite enrolls one phone, which can scan multiple computers without relay-admin approval.
**Architecture:** Persist public phone identities and computer associations, authenticate signed HTTP/WS transcripts, retain existing encrypted RPC and Bridge pairing approvals. No package-wide admission secret.
**Tech stack:** Node 24, ws, Ed25519, tweetnacl, Expo device-only SecureStore; no new dependencies.
**Spec:** docs/superpowers/specs/2026-11-04-relay-invitations-design.md

## Global constraints

- Local code and tests only. No production, publishing, credentials or visibility actions.
- Preserve direct/self-hosted connections, host credential slots, encryption, chat and Bot/action approvals.
- No invitation in logs, QR codes, packages, URLs or ordinary status/list output.
- Fail closed on missing/corrupt access stores and legacy public/approval/build-key environment.

## Review focus

- Failed persistence must not authorize a phone or association.
- Stale QR codes and changed identities must not steal ownership or invalidate a valid pairing lease on promotion.
- Revocation must stop both directions on already-open streams and block reconnect.
- Concurrency on first phone-key creation must not enroll one key and retain a different key.
- Official clients must not silently downgrade to old open relays.

### Task 1: Durable access store and offline operator commands

Files: create plugin/tools/relay/access.mjs, access-cli.mjs, test/access.test.mjs, test/access-cli.test.mjs.
Interfaces: createAccess({file,initialize=false,now=Date.now}) returns issue({count=1,expiresInMs=86400000}), redeem(code,key), associate({phoneKey,computerId,computerKey,serverId}), isPhone(key), owner(computerId), allows(key,id,computerKey,serverId), revokePhone(phoneId), list(), onRevoke(listener), close(). phoneId = first 16 SHA-256 bytes of the raw canonical 32-byte Ed public key, base64url. issue returns [{id,code,expiresAt}], redeem returns {enrolled:true,phoneId}. owner returns {phoneKey,computerKey,serverId} or null. Store uses version 1, kind dabots-phone-access to reject old stores. isPhone/allows are synchronous after committed state. All records bounded (4096 invites/phones, 4096 computers), strict canonical encodings, durable copy-on-write save, exclusive lifetime lock, explicit initialize only. Revoked phone key cannot redeem a new invite. Association requires active phone, disallows taking a live other owner's computer and mismatching existing keys/serverId. Reassign from revoked owner only after server validated fresh QR. close waits queued writes and removes own lock.

- [x] Write tests: one use/expiry, two concurrent redemptions exactly one, same-key retry status, revoked key no reuse, two computers, foreign owner/key mismatch, persistence failure grants nothing, reload, corrupt/missing stores and two processes locking.
- [x] Run tests RED, implement, run GREEN. CLI init/issue/list/revoke use stopped-store lock, stdout code only on issue; errors redact inputs. No real codes generated outside test temp dirs.

### Task 2: Relay protocol enforcement

Files: server.mjs, bin.mjs, new access-api.mjs, server tests; remove approvals.mjs and its superseded tests. Uses Task 1 interface.
- [x] Write real HTTP/WS tests RED for signed redeem/status/associate, replay/body/origin/query rejection, uninvited phone, old client, wrong/expired association, one phone two computers, competing phone, revocation/reconnect/restart and no ciphertext after revoke.
- [x] Implement access API and challenge-response before stream creation. v3 computer transcript binds serverId, link nonce expires five minutes. Authorize both frame directions against committed store; revoke closes owned computers and phones. Preserve existing limits/Origin/encryption. Remove legacy relay-admin API. bin rejects unsafe old environment; accepts explicit initialized RELAY_ACCESS_FILE. Update migration/rollback docs and package/deploy file manifests.
- [x] Run relay tests GREEN including bounded diagnostics and failed startup cases.

### Task 3: Desktop and SDK protocol

Files: relay-client.mjs, relay-settings.mjs, server.js/build-tag/official/package scripts, ui/src/mobile-access.ts, sdk/relay-transport.js/.d.ts and tests.
- [x] Add tests RED for v3 registration, linkNonce QR propagation, pending-to-ready lease survival, fresh nonce identity invalidation, challenge signer before encrypted offer, missing/invalid signature and strict official downgrade rejection.
- [x] Implement v3 negotiation (legacy v2 remains for explicitly non-invite self-hosted relays), preserve safe pending promotion, forward QR nonce/protocol. SDK receives authenticate({nonce,computerId,computerKey,serverId,relay}) callback and requireAccess boolean; official callers require new challenge. Remove package build-key injection/checks and tests superseded by server invitation authorization.
- [x] Run SDK/Bridge/UI tests and encrypted scan probe GREEN; rebuild generated UI bundle.

### Task 4: Phone enrollment and UI

Files: new logic/relay-access.ts, storage/relay-key.ts/.web.ts, app/relay-access.tsx; network/client.ts, screens/PairingScreen.tsx, app/pairing/settings/_layout, locales. Remove relay-admin/relay-approve/admin-key/admin-relay and superseded tests.
- [x] Add tests RED for signed Node/NaCl interoperability, exact-origin access, two concurrent storage calls, fresh no-host enrollment/back/draft, revoked/error/retry, restored-host auth signer and Chinese/English light/dark routes.
- [x] Implement device-only per-origin key, signed HTTP+WS helpers and official invite screen. Scanning associates exact QR registration before encrypted pairing; normal Bridge phone approval unchanged. Clear invite text on submit, retain no invitation state/logs. Existing hosts persist and require authentication at reconnect.
- [x] Run App types/tests GREEN and check migration behavior against legacy/self-hosted host cases.

### Task 5: Full validation and review

- [ ] Run setup/prepare/check, integration/suite, packed-delivery and audit using Windows-safe command-scoped tooling.
- [ ] Fresh reviewer checks complete diff/security boundaries/spec; address important findings with RED/GREEN tests.
- [ ] Report actual file/commit state, complete tests, any blocked native/device checks, and deployment/migration/closed rollback steps. Do not publish or deploy.
