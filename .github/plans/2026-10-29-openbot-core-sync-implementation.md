# OpenBot Core Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Run the complete pinned OpenBot mobile foundation on the existing DS Bridge for shared chat, Bots/groups, runtime state and related settings.

**Architecture:** Vendor the complete upstream mobile source and its needed shared packages inside ios-app/openbot, preserving its structure and attribution. Concentrate DS-specific identity, requests, data projection and events in ios-app/src/ds; reuse current pairing, SDK and durable outbox. Bind real imported screens to this adapter, with desktop DS data authoritative and unsupported capabilities explicit.

**Tech Stack:** Node 24/npm, Expo 58, React Native 0.88, TypeScript, public DSH 0.2.1-rc.2 and current production plugin.

**Spec:** `.github/plans/2026-10-29-openbot-core-sync-design.md` (approved by user: “可以 操作吧 以这个为蓝本去处理”).

## Global Constraints

- Exactly two product directories: plugin/ and ios-app/; use existing isolated checkout and codex/openbot-core-sync branch, no additional worktree.
- Fixed upstream nightly-labs/openbot 0be0110737e55622f7a92c06a96a8eaaf516f114; full mobile source plus required shared modules, not another trimmed UI import.
- Models and reasoning options come exclusively from DSH. No additional provider setup, credential collection or account service is added.
- Preserve ds-bot package/module/row IDs, app.dsbot.mobile, dsbot scheme and existing pairing/storage identities; never test against a real user profile or patch DSH.
- Preserve original LICENSE/NOTICE including OpenBot PolyForm Noncommercial; no credentials, real pairing state or generated native/build artifacts in Git.
- First delivery covers chat, Bots/groups, runtime status, model/reasoning and related settings. Unsupported features stay honest and capability-gated; no fake successful actions or empty component replacements.
- Desktop data is authoritative. Use stable request IDs, scoped original IDs, canonical write acknowledgement and readback. Foreground team snapshots every 8 seconds plus immediate write/reconnect refresh; controlled healthy-network visibility within 10 seconds.
- Reuse npm setup and current lite unsigned IPA workflow. Separate Linux checks, native compilation and post-signing/device evidence.

## Review Focus

- A stale cached grant or changed computer must never authorize writes or show another computer's data: pin to adapter and UI integration tests.
- A lost send acknowledgement must reuse one durable request ID and resolve the real receipt, including after restart: pin to adapter/outbox and isolated-host checks.
- Group member responses must keep author identity, and Bot/conversation/Session IDs must not be substituted: pin to mapping and real-host checks.
- A model selected on the phone must be one published by DSH and save back to the same Bot, with no provider/account setup path: pin to adapter and actual-screen tests.
- Replacing the UI must retain existing paired host credentials, pending sends and preferences: pin to migration and browser/device-independent storage checks.

### Task 1: Import and install the complete pinned OpenBot mobile foundation

**Files:** Create ios-app/openbot/mobile/ from the tracked upstream apps/mobile tree; ios-app/openbot/packages/ for required transitive shared packages; ios-app/openbot/LICENSE, NOTICE and SOURCE.md, plus a provenance manifest. Modify ios-app/package.json, package-lock.json and setup/patch helpers only as needed for dependencies. Keep existing active routes/alias intact until Task 3.

**Interfaces:** Produces a complete source tree at ios-app/openbot/mobile/src and local shared packages named @openbot/*, with resolved npm-compatible package declarations. Runtime dependencies for both current and imported mobile code resolve from ios-app/node_modules. SOURCE.md records exact upstream commit and adaptations/exclusions; package version catalogs are resolved explicitly.

- [x] Inventory tracked upstream mobile assets/source/config/modules and shared dependency closure; copy complete mobile tracked source without secrets/build caches/.git. Preserve notices and raw assets. Record any native configuration owned by existing root app instead of executing upstream scripts.
- [x] Resolve workspace/catalog metadata into local file dependencies and pinned registry versions; retain existing DS SDK and native Expo compatibility. Do not execute upstream root Electron/deployment scripts.
- [x] Run npm install/setup with writable npm cache and existing transport settings; inspect missing/unresolved modules. Verify provenance against upstream tracked file hashes and package closure, rather than adding tests mirroring copy logic.
- [x] Run current mobile typecheck and existing tests as a compatibility baseline; imported inactive source may use a separate upstream config until Task 3 activates it. Do not suppress errors in active code.
- [x] Commit the foundation with no live route switch. Expected: full source and assets present, npm dependencies installed, existing app checks pass, no new provider UI enabled.

### Task 2: Implement the DS core adapter with real semantics

**Files:** Create focused modules under ios-app/src/ds/ for identity, projection, commands and workspace coordination; test under ios-app/test/ds-*.test.ts. Reuse ios-app/sdk and src/session, connection, outbox, storage, logic. Modify reusable existing modules only where compatibility requires it.

**Interfaces:** Export createDsCore({client,serverId,getSnapshot,refresh,outbox,isOnline}) providing read/list projections, history, send, Bot/group CRUD and settings/model commands. Export deterministic identity and transcript/work-state projection helpers using upstream contracts. Exact internal subdivision belongs to implementer; publish typed signatures in task report for Task 3. Commands preserve original DS IDs and use MobileClient, never arbitrary provider endpoints. A session remains owned by existing SessionProvider and existing persisted state.

- [x] Write focused failing behavior tests for server-scoped stable IDs, Bot/group/session distinction, attributed history, stale cache/changed host, model options and changed-field-only updates, read-only/offline refusal, canonical refresh and send receipt recovery. Observe expected RED before implementation.
- [x] Implement mapping and supported command methods over current SDK/action capabilities, with pure projections and focused stateful coordination. Expose explicit unsupported errors/capabilities for unimplemented upstream features. Respect owner-granted DSH Agents separately.
- [x] Use DSH models/efforts exclusively. Validate selections against current host discovery and pass the original DSH reference to update-bot. Do not create provider configuration or forward unrecognized upstream provider/account requests.
- [x] Integrate durable outbox and host lifecycle without moving credential keys. Reuse 8-second snapshot refresh and stream recovery, invalidate stale state on host changes and suppress older in-flight refresh results.
- [x] Run new behavioral checks, existing mobile/SDK tests and typecheck; commit. Expected: typed DS adapter ready for genuine upstream screens, all missing capabilities honest, existing persisted state remains usable.

### Task 3: Activate real upstream core screens and navigation

**Files:** Modify ios-app/app or router configuration to mount upstream screens. Add ios-app/src/ds React providers/hooks and screen bindings; adapt upstream workspace/session/transport integration points with changes recorded in SOURCE.md. Update Metro/TypeScript/CSS aliases and dependencies. Replace obsolete cropped src/openbot active UI only once its callers/tests are relocated. Preserve DS pairing UI and explicit legacy Agent access if needed.

**Interfaces:** Task 2 adapter supplies real state and actions to imported mobile screens. Genuine upstream chat/list/create/edit components run behind the existing DS pairing session; all active routes use the DS adapter instead of OpenBot account, directory and WebRTC services. Full imported source remains available with explicit capability-gated unsupported pages. Native root app identity and lite configuration remain current.

- [x] Add focused failing integration tests for actual screen/provider commands: create/edit Bot and group, DSH-only model chooser, phone/computer settings readback, current-host isolation and explicit unsupported deep-link behavior. Observe RED on the old active shell.
- [x] Mount real upstream core screen layouts and components, implementing DS-specific context/transport bindings centrally; use actual data models and error states. Keep complete source, not null stubs. Gate unavailable navigation and operations; do not fake an OpenBot cloud account or protocol version.
- [x] Wire chat history/send/outbox and current-session events, group authors, runtime activity, Bot/group fields and DSH model/effort selection. Keep smartphone-only preferences local and shared supported preferences canonical.
- [x] Run full active mobile typecheck and tests, web and iOS Metro bundles; fix module/type/runtime errors. Do not hide active code from typecheck or strip behavioral assertions for convenience. Verify original saved pairing/outbox data loads through the new shell.
- [x] Commit. Expected: imported real screens operate the DS adapter, core flows are reachable, no extra provider setup or upstream account dependency.

### Task 4: Verify actual two-way product delivery and document the result

**Files:** Add meaningful isolated production-host/browser integration under ios-app/test or plugin test tools; update docs, source/licensing index and checked plan. Fix discovered implementation defects with regressions. Update reusable cloud startup instructions if paths/commands change.

**Interfaces:** Reuse the existing public DSH/mock harness and production plugin. Actual imported UI, not a replacement test page, connects to disposable Bridge state. Test credentials are ephemeral and must not appear in logs/commits. Packaging uses clean committed source.

- [x] Exercise actual imported UI against isolated public DSH + production engine: pairing, desktop existing records/history, mobile send and desktop history, desktop mutation visible on phone, mobile Bot/group/settings edits reflected on host, running/stopped states, model selection, at least one denied write.
- [x] Exercise lost acknowledgement/reconnect, host switch, removed entities, revoked device and preserved pairing/pending-send upgrade state. Use deliberate controlled failures with regression evidence where code changes are needed.
- [x] Run root check, production Bridge integration, TGZ boot/migration, affected packed delivery, production packaging and source/archive audit. Inspect generated archive/source metadata and unchanged compatibility IDs.
- [x] Run isolated iOS prebuild, baseline web export and actual browser error checks. Baseline runtime commit `538b6df` passed; no macOS/Xcode/IPA/device access is available. Per the newly authorized Task 5 scope, defer the final iOS export and repeat web export to stable Task 5 source; do not duplicate baseline iOS export.
- [x] Update product docs, source/provenance and repeatable verified environment commands; commit reviewable Task 4 changes.
- [ ] Parent: save reusable cloud draft, request independent whole-branch review, resolve material findings and push the reviewed branch. No tag or release publication is authorized.

Task 4 verification evidence and repeatable commands: `ios-app/docs/isolated-host-acceptance.md`. Final branch push, reusable cloud draft and independent whole-branch review remain owned by the parent task; no release/tag publication is authorized. Native Xcode/IPA/signing/device checks remain unrun on this Linux environment.

### Task 5: Complete Chinese UI and simplify the home header

**User steering:** 用户明确要求语言切换提供中文版，并指出首页重复品牌标题、文字 Settings 入口丑陋，要求用 icon。This extends the current implementation, not a replacement task.

**Files:** Modify `ios-app/app/_layout.tsx`, `ios-app/app/settings.tsx`, active DS-adapted screens under `ios-app/openbot/mobile/src/features/agents/`, `features/channels/`, `features/chat/`, and `ios-app/src/ds/`; reuse `ios-app/src/i18n.ts`, existing Chinese JSON catalogs and language bridge. Update imported-source provenance/originals for any adaptation. Extend meaningful actual-UI localization/header tests under `ios-app/test/` and `ios-app/test/browser/`. Update existing docs/checked plan.

**Interfaces:** Existing `useI18n()`, `tr()`, `setLocalePreference()` and `LocalePreference` values `host|system|en|zh`; original per-host `mobile-preferences` locale cache. DS provider already bridges resolved locale into imported `useAppLanguage`. Root routes `/` and `/connected` mount the same ConnectedScreen. Reuse existing icons/dependencies and real-host harness/normal Metro8093 previewOFF. Model references/effort values remain those offered by DSH.

- [x] Verify language selection exposes `English` and `简体中文`, applies immediately to active home/chat/Bot/group/settings/management errors and navigation titles, persists using the existing preference identity, and can switch back. Preserve follow-computer/system behavior, host isolation, raw user-owned data and DSH model identities. Add behavioral RED→GREEN for missing Chinese coverage/reactivity; reuse existing catalogs rather than adding a second locale system.
- [x] Show one DeepSeek Bot Pro brand heading on home. Remove duplicate navigation/body branding and replace the Settings text action with an accessible gear button (44pt hit area, localized accessibility label, real settings navigation). Check both home routes at390px, safe area and back navigation. This is a narrow correction to the shown header, no broad visual redesign.
- [x] Ensure reachable DS-owned interface labels, empty/error/uncertain-save states and model controls are translated; raw user names/messages and canonical DSH model IDs are not rewritten. Recheck host/system preference fallback and persistence, locale changes while mounted and after navigation, and English restoration.
- [x] Run actual previewOFF/publicDSH browser checks for Chinese home, single chat, Bot/group form, DSH model controls and settings; verify the gear opens settings and only one brand heading is visible. Save6updated390px Chinese screenshots without pairing secrets, clearly browser-only. Existing18functional host scenarios must remain valid; use focused additions/reuse harness instead of replacing real integration with static string assertions.
- [x] On stable final source, run mobile typecheck/tests and required root check, final web+iOS exports (iOS bundle gate moved from Task4), existing source/archive audit and final source-bound production pack from clean committed code. Reuse Task4 unchanged plugin/SDK/packed/native-prebuild evidence; rerun additional gates only for a concrete affected area. No new CI, tag, release, signing or credentials.
- [x] Self-review, update provenance/docs/plan, commit and report exact source/gate results. Parent supplies Task5 review and final whole-branch review/push/config draft. Keep native Xcode/IPA/device limitations explicit. Do not push, publish, merge or spawn subagents.


### Task 5 review follow-up: R1/R2

- [x] Guard queued locale feedback by the latest intent, keep separate locale status, preserve management errors and original per-host storage, and verify delayed-failure/newer-success plus current failure/retry on actual Settings handlers.
- [x] Preserve verified Chinese home/chat captures, recapture only the four missing pages, separate en/zh capture destinations, visually inspect all six and record their hashes in the external fix report.
- [x] Run affected type/locale/actual UI checks; refresh both JS exports on stable runtime source, then refresh production package metadata/source audit from clean committed fix source. Retain unchanged aggregate/native/engine evidence at its prior source point.

### Parent completion

- [ ] Independent Task 5 review, final whole-branch review, authorized branch push and reusable cloud configuration draft (parent-owned).
