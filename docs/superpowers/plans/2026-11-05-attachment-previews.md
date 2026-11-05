# Authorized attachment previews implementation plan

> **For agentic workers:** Use superpowers:executing-plans, with native implementation in the existing checkout and test-first steps.

**Goal:** Replace debug JSON with photo/file cards and safely open bounded message previews.
**Architecture:** Persist original/preview ordinal links before admission; decorate only matching canonical request/session attachments. Authorize each image read against the current visible conversation and exact message, then use DSH's public image reader. Adapt structured mobile attachments and the existing viewer with connection-scoped memory-only previews.
**Tech stack:** Node24, public DSH0.2.1/0.2.2 APIs, existing SDK encrypted RPC, Expo58/HeroUI.
**Spec:** The approved design is the preceding read-only diagnosis and delegated user authorization to implement it.

## Global constraints
- No production deployment, package publication, native build, user-profile installation or real message sends.
- Never decode/download original100MB files for previews. Maximum response1048576bytes,1536pixels per side; use normalized image references only.
- Preserve exact computer/conversation/Session/message authorization, cancellation and current Agent grants. Never infer relationships from filenames.
- Older peers/history degrade to compact file cards. Mark derivatives as previews; keep original name/size separate.
- Follow mobile DESIGN.md; one targeted local mobile check at a time, full checks in candidate/main CI.

## Review focus
- Original and derived image may share a hash: pair by validated ordinals and request identity.
- Permission may disappear during decode: recheck before releasing bytes.
- Re-pair/switch/logout must invalidate preview requests and mounted cached images.
- Malformed IDs, oversized stored images/output and fake filename prefixes must not gain access.
- Historic independent images/documents must remain visible when no trusted pair exists.

## Task1 — Bridge display binding and protected image reading
Files: Bridge adapter/server, new preview/display helpers, index injection and package file list; SDK capability types.
- [ ] Write/run failing display-binding and scoped-reader tests (restart, foreign Session/seq/id, cancellation, revoked grant, byte/pixel caps).
- [ ] Implement trusted `recordAttachments` metadata before submit, matching canonical original hashes and attachment ordinals; no attachment bytes in state.
- [ ] Implement existing GET attachments route using current auth, exact visible message membership and public DSH image reader. Return bounded binary only; recheck access after async work.
- [ ] Run focused Bridge tests/lint and isolated DSH read/send integration for both pinned versions.

## Task2 — Structured mobile cards and scoped memory previews
Files: DS chat binding, preview-ID/loader helpers/provider, shared attachment contract and existing image card/cache/viewer.
- [ ] Write/run failing mapper/loader/cache tests (no JSON, one trusted photo card, unchanged user files, scoped IDs, old host fallback, abort/connection changes).
- [ ] Map photo previews to existing structured image cards; expose original labels and explicit preview semantics. File-only cards remain disabled for unsupported downloads.
- [ ] Wire bounded loader, memory-only per-connection/message caching and cancellation; reset mounted viewer on access loss.
- [ ] Run one focused mobile test at a time and phone-size preview where available; disclose screenshot/native limitations.

## Task3 — Verification and main
- [ ] Commit concrete tested changes; run normal candidate Linux checks, integrations, suite packaging and audit.
- [ ] Recheck remote main, integrate without force, verify exact main CI. Report required phone/plugin rebuilds; do not publish or deploy.
