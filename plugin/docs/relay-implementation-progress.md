# Relay implementation ledger

Baseline a342642a52551aab437d73610d3ab96f192fc273; branch codex/aliyun-relay.
Latest owner direction: transplant only necessary Happy connection/relay/encryption
into this BOT repository, keep own App and DSH/Bot functionality. Never switch to
a Happy product replacement. No production installation, profiles, keys or server writes.

Completed first increments (2026-10-24):
- Fixed Happy SHA d6b85a0dda14c9582e1f083539fd11d99924022f CLI NaCl envelope/
  secretbox subset in SDK vendor/, with full MIT notice and root NOTICE attribution.
- SDK relay-crypto.js: injected secure randomness, ephemeral box seed envelope,
  directional HKDF-SHA256 keys, context/sequence binding, ready/finish confirmation,
  permanent invalidation on authenticated record/ordering failure, key zeroization.
  Does not claim forward secrecy or a protocol audit.
- relay/server.mjs: account-free in-memory online registry; Ed25519 nonce+key-bound
  registration and secret hash comparison; offline response; scoped binary streams;
  initial payload/stream/IP/backpressure bounds. Programmatic factory, not deployed.
- SDK version 0.1.1-codex.3, relay 0.1.0-codex.1; exact MIT crypto dependencies and locks.
- RED observed for missing module, then GREEN: full SDK 39/39, relay 3/3.

Still required before completion or PR:
- SDK fetch/WS physical connection lifecycle, chunks, abort, no mutation replay.
- Bridge relay registration, fixed own-service dispatch, lifecycle, owner config/status,
  QR only when ready, original auth/receipt/Agent authorization continuity fixture.
- App QR/key pin storage/host slots/offline handling; preserve existing UI and TLS paths.
- Companion relay panel/QR round-trip; build and commit generated client.js.
- Expanded hostile registration, heartbeat challenge and deadline, bounds/log privacy;
  crypto interoperability/confirmation/size lifecycle tests and independent review.
- Version-source/docs/lock consistency across each changed component.
- Full check/check:bridge/audit, delivery, two archives+SHA256, draft PR only.

Earlier ACP fixture is evidence only, not the product target. Old design/test drafts
were retained; original relay-crypto draft tests now pass against the actual SDK module.
