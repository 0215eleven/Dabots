# Happy subset provenance

Reference: https://github.com/slopus/happy/tree/d6b85a0dda14c9582e1f083539fd11d99924022f

Adapted implementation: `packages/mobile-sdk/vendor/happy-envelope.js` derives the ephemeral NaCl box envelope layout and nonce-prefixed secretbox content encryption from Happy's `packages/happy-cli/src/api/encryption.ts` (`encryptBox`, `encryptLegacy`, `decryptLegacy`). The CLI source is MIT, Copyright (c) 2026 Happy Coder Contributors. Full permission and disclaimer are retained in `packages/mobile-sdk/vendor/LICENSE.happy` and must ship with these files.

Changes: explicit injected secure randomness (Node crypto / Expo crypto at the caller boundary), byte payloads rather than automatic JSON, size/format validation and best-effort ephemeral-key zeroization. BOT-specific context binding, directional HKDF-SHA256 keys, key confirmation, record counters and permanent failure state live outside the adapted module in `relay-crypto.js`.

Happy's account/master-key sync, Socket.IO protocol, database, agent execution and public-server defaults are not copied. Existing BOT Bridge auth, receipts, Agent grants and mobile UI remain the integration target. This adaptation is not the unchanged Happy wire protocol, and has no claimed security audit or forward secrecy. One accepted offer per stream is mandatory; stream IDs and reconnect epochs must be newly allocated. No reconnect may reset a live cipher session.

Dependencies (exact SDK lockfile versions): tweetnacl 1.0.3 (MIT), @noble/hashes 2.0.1 (MIT), @stablelib/base64 2.0.1 (MIT). Relay dependency ws 8.18.3 (MIT). Package license notices remain in installed/distributed dependencies; no original repository LICENSE/NOTICE is replaced. Happy brand/public service access is not included.
