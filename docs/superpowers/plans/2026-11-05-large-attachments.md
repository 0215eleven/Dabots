# 100 MB attachment implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transfer original files and photos up to 100,000,000 bytes without whole-file base64 buffers, preserving pairing, encryption and exact receiving-session ownership.

**Architecture:** A versioned upload-transfer API accepts bounded 256 KiB chunks, acknowledges durable offsets, and issues a receipt only after a streaming SHA-256 check. Existing encrypted RPC and local HTTPS carry individual small requests; the Bridge streams committed files into DSH's public FileUploads API at submission. Photo originals remain files, with separately identified, bounded model previews.

**Tech stack:** Node 24, Expo 58, existing SDK/Bridge/Relay, DSH public 0.2.1-rc.2 APIs.

**Spec:** User-approved task: ordinary files and original photos each up to 100 MB (decimal); implement and test phone/plugin/relay, merge main, without deployment, product releases or iOS builds.

## Global constraints

- 100,000,000 bytes per original; maximum 4 originals and 100,000,000 original bytes per message. Previews have an independent maximum 2 MiB each and are explicitly identified.
- Every transfer is scoped to an authenticated device, conversation and exact session. Revocation and session replacement must fail closed.
- No DSH patches, third-party storage, plaintext relay, speculative native-device claims, secret output, force pushes, production changes or product builds.
- Old clients keep the legacy 2 MiB path; large uploads require both updated plugin and relay capability negotiation.

## Review focus

- An acknowledgement lost after disk write must resume without duplicate bytes or wrong content.
- Cancellation, process restart, expiry and authorization revocation must release partial disk reservations.
- Changing sessions during selection/upload/submission must not deliver into a different session.
- An oversized/malformed photo must preserve original bytes without unbounded decoding or a falsely labelled preview.
- An old relay/plugin must never advertise or accidentally accept the 100 MB protocol.

### Task 1: durable, bounded Bridge transfer storage

**Files:** create `plugin/bridge/src/upload-transfers.mjs`, `plugin/bridge/test/upload-transfers.test.mjs`.
**Interfaces:** `createUploadTransfers({home,auth,now})` exposes begin/status/write/complete/resolve/remove/prune/close. Writes are at most 262144 bytes; durable receipts use SHA-256. Reservations: 200 MB/device, 1 GB/global, 1 receiving transfer/device and 4/global; 15-minute partial idle TTL and 24-hour completed TTL.
- [ ] RED: boundary, digest, duplicate offset/conflict, concurrent begin, quota, cancellation/revocation cleanup, restart and expiry tests.
- [ ] Implement disk-backed sequential writes and streaming digest/reads; run the test file GREEN.

### Task 2: Bridge and Engine admission

**Files:** `plugin/bridge/src/server.js`, `adapter.mjs`, `uploads.mjs`, `plugin/engine/src/host/mobile-bridge.js`, plus component tests and Bridge package files.
**Interfaces:** POST `/upload-transfers`, GET/DELETE `/upload-transfers/:id`, PUT `/upload-transfers/:id?offset=N`, POST `/upload-transfers/:id/complete`; no unbounded body. `adapter.submit` streams resolved files through public DSH `/api/session/uploadFileBinary` and submits exact-session host receipts.
- [ ] RED: endpoint ownership, stale session, revocation, bounded bodies, duplicate completion and no legacy bypass.
- [ ] Implement negotiated capability and v2 receipt admission while preserving v1; run Bridge/Engine relevant tests GREEN.

### Task 3: SDK transfer and Relay negotiation

**Files:** `ios-app/sdk/index.js`, `index.d.ts`, new `upload-file.js`, RPC allowlist, `relay-transport.js`, `plugin/tools/relay/server.mjs`, their tests and generated Bridge relay bundle.
**Interfaces:** `client.uploadFile({conversationId,sessionId,clientId,name,mediaType,size,read,signal,onProgress})` reads no more than one 256 KiB chunk, resumes by durable offset, hashes bytes incrementally, verifies receipt, and cancels/cleans on request. New relay announces versioned upload policy; old relay caps the feature at legacy size.
- [ ] RED: 100 MB streamed source, +1 byte, lost ACK, interrupted/reconnected upload, cancellation and old-relay downgrade.
- [ ] Implement bounded sequential protocol and negotiated traffic policy; keep encrypted-record and RPC-body bounds unchanged; run SDK/Relay tests GREEN and rebuild generated relay artifact.

### Task 4: phone original selections and separate previews

**Files:** existing uncommitted attachment selection, photo helpers, `src/ds/use-attachments.ts`, network capability adaptation, affected attachment UI and en/zh catalogs.
**Interfaces:** URI-backed originals retain exact size and bytes; photo previews have separate URI/MIME/size and visible role. Selection does not read 100 MB into JS strings. Progress/cancellation use SDK uploadFile; only negotiated peers enable new limits.
- [ ] RED: actual-format naming, 100 MB boundary/localized limits, no full base64 read, original/preview distinction, cancel/replace/retry and old-capability gating.
- [ ] Implement current-representation picker copies, bounded preview decoding and cleanup, streamed source reads, progress and localized errors; run related tests serially GREEN.

### Task 5: end-to-end verification and integration

**Files:** isolated delivery/integration tests and compatibility documentation.
- [ ] Run a synthetic 100 MB file through direct/local-HTTPS transport and encrypted relay into isolated public DSH storage; compare byte count and SHA-256. Include interruption, retry, cancellation and revoked access.
- [ ] Run required component tests, type checking, root checks, integration/suite and packed-delivery checks. Keep native build/device coverage separate.
- [ ] Review the whole change independently, correct material findings with regressions, then commit and fast-forward main; verify exact remote SHA and its CI. Do not publish assets or deploy services.
