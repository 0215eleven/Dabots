# DeepSeek Bot Pro Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the existing repository into a reproducible desktop DSH plugin and an iOS app producing unsigned lite IPA archives.

**Architecture:** Keep the established engine, Bridge, pairing UI, transport and SDK boundaries within two product directories, `plugin/` and `ios-app/`. Compose one production `ds-bot` TGZ from local engine source and package iOS on macOS Actions without code signing. Use verified ds2 commit `4d61cf517b74d005fa9edaed1d37a34451916cc8` as the starting point.

**Tech Stack:** Node.js 24, npm lockfiles, DSH 0.2.1-rc.2 public APIs, Expo 58 / React Native 0.88, Xcode on macos-26.

**Spec:** `.github/plans/2026-10-29-deepseek-bot-pro-design.md`

## Global Constraints

- Exactly two product directories: `plugin/` and `ios-app/`; `.github/` and root legal/package metadata are repository support.
- One desktop plugin TGZ, one lite unsigned iOS IPA; archive binaries belong in artifacts/Release, never Git.
- Keep package ID `ds-bot`, iOS identity `app.dsbot.mobile`, `dsbot` scheme, protocol, plugin row/module IDs and persisted data identities compatible.
- Display product name: DeepSeek Bot Pro. No EAS, Android release, or standalone Electron product entry point.
- Never patch DSH or touch a real user profile. Preserve original LICENSE/NOTICE/provenance.
- Do not overwrite existing tags or Release assets. Default manual build produces Actions artifacts only.
- Referenced task could not be read; do not claim unknown PR changes were incorporated.
- Cloud tasks already run isolated: use this checkout and branch, no additional Git worktree.

## Review Focus

- Missing/malformed Bridge targets must fail before queueing a message; production engine tests cover stale sessions, malformed IDs and membership changes.
- Existing `ds-bot` plugin identity and paired devices must survive single-package composition and migration; use existing suite boot/migration integration checks.
- A fresh checkout must build without a Windows engine path or fixture-as-production fallback; pack the local engine and inspect its archive/provenance.
- macOS packaging must fail on absent app/incorrect ZIP or accidental signing; execute the archive validator against controlled ZIP inputs and validate real IPA when available.
- Moving shared SDK and test fixtures must preserve dynamic imports, platform source selection, license coverage and offline preview; run the existing suites plus an iOS Metro bundle.

### Task 1: Establish the verified base and move the dependency graph

**Files:** Move `bridge/` to `plugin/bridge/`, `companion/` to `plugin/ui/`, `relay/` to `plugin/tools/relay/`, `ds-bot/ds-bot/` to `plugin/engine/`, `group-bridge/` to `plugin/test-support/`, `scripts/` to `plugin/scripts/`, `apps/mobile/` to `ios-app/`, `packages/mobile-sdk/` to `ios-app/sdk/`. Preserve relevant mock model in `plugin/test-support/mock-llm.mjs`. Move root product docs into product docs.

**Interfaces:** Root npm scripts orchestrate the two product directories. SDK file dependency becomes `file:./sdk`. Engine and Bridge continue ESM entry points.

- [x] Install and run baseline checks on ds2, recording any pre-existing failures before changing code.
- [x] Move source with history preserved; relocate ignored dependencies/fixtures with their owners, preserving expected generated outputs.
- [x] Rewrite only path references using old-to-new file mapping (including source-relative imports, manifests, lockfiles, scripts, fixtures, Metro and test source reads). Preserve all test assertions.
- [x] Update root setup/check entry points and verify local npm link resolution, App typecheck and existing component tests.
- [x] Commit the structural change after paths and focused checks pass. Expected: no unresolved old source paths in active scripts/imports.

### Task 2: Build one production desktop plugin from local source

**Files:** `plugin/engine/src/host/channel.js`, `plugin/engine/PATCHED.md`, `plugin/bridge/test/inputs.mjs`, `plugin/bridge/test/production-engine.test.mjs`, `plugin/bridge/test/fixture-host.mjs`, `plugin/scripts/pack-suite.mjs`, `plugin/scripts/test/dsh-harness.mjs` and associated package/prepare scripts.

**Interfaces:** Existing `install(rt)` registers `bridge.describe`, `bridge.redact`, `bridge.submit`, `bridge.agent-open`, `bridge.agent-new` through public Connection/Session APIs. Packaging defaults to `plugin/engine`, keeps `ds-bot` identity and rejects absent contracts. Test fixture helpers can select vanilla/reviewed/production implementations explicitly.

- [ ] Add real engine boundary regression checks for advertised contract, redaction scoping, reliable stable-ID submit, stale sessions, membership changes and Agent ownership. Run against unmodified 0.2.0: expected failure because endpoints are missing.
- [ ] Adapt the existing reviewed 0.1.7 Bridge contract to bundled 0.2.0, without modifying DSH or weakening existing state/error behavior; document provenance.
- [ ] Run production-engine checks and existing Bridge tests; use the production engine in isolated full-host integration while retaining pristine upstream rejection coverage.
- [ ] Default production single-package composition to the repository engine and record source/commit/digest; no external source required. Exercise the generated archive and existing migration/boot/packed-delivery checks.
- [ ] Commit. Expected: one TGZ with real engine, Bridge and UI; no `.dev` fixture fallback or credentials.

### Task 3: Keep iOS-only configuration and safe unsigned packaging

**Files:** `ios-app/app.json`, `ios-app/app.config.js`, `ios-app/package.json`, `ios-app/modules/`, `ios-app/scripts/`, `ios-app/test/branding.test.ts`, `.github/workflows/mobile-release.yml`, archive validation under `plugin/scripts/` and its tests.

**Interfaces:** `DS_BOT_NO_WIDGETS=1` selects the existing lite build; native project name matches DeepSeek Bot Pro. Build artifact is `DeepSeekBotPro-<version>-lite-unsigned.ipa`, with SHA256SUMS and source commit metadata.

- [ ] Retain App identity while updating display branding and path-sensitive tests; remove Android/EAS-only commands/config/scripts after checking no iOS consumer depends on them.
- [ ] Add behavioral checks for archive validation: missing/corrupt ZIP, absent Payload app/plist/executable, and valid synthetic archive. Observe failures before implementing validator.
- [ ] Update macOS workflow paths, Node 24, native workspace/scheme discovery, unsigned archive flags and artifact verification; manual runs default to artifacts and immutable release uploads.
- [ ] Run App tests/typecheck, iOS prebuild without installation in an isolated output directory when supported, and an iOS Metro bundle. Validate workflow syntax. Record macOS-only compilation as unrun unless Actions can actually be started and observed.
- [ ] Commit. Expected: no third product entry point and a complete reviewed unsigned IPA workflow.

### Task 4: Remove unused product trees and make documentation truthful

**Files:** Root README/README.en/NOTICE/SOURCES/AGENTS/package metadata, `plugin/docs/`, `ios-app/docs/`, root obsolete directories, `.github/workflows/check.yml`.

**Interfaces:** Root instructions describe only setup/check, plugin TGZ and iOS unsigned build. Historical provenance is retained with source references, without implying previous checks cover this branch.

- [ ] Remove standalone Electron/upstream development/docker/demo trees and obsolete build entry points only after dependency references are relocated or proven unused.
- [ ] Keep relevant license/attribution material with code; migrate install, relay, compatibility and development docs to their product owner and fix links.
- [ ] Replace root docs with concise DeepSeek Bot Pro guidance; document two artifacts, actual native/signing limits and preserved compatibility IDs.
- [ ] Verify root tracked directories, active paths, legal notices, documentation links, source audit and all baseline suites.
- [ ] Commit. Expected: tracked product directories are plugin and ios-app, plus .github support.

### Task 5: Verify the whole product and save reusable environment instructions

**Files:** Tests/CI/build outputs as needed; environment configuration draft fields `install_script` and `start_skill`; ledger outside the source checkout.

**Interfaces:** A fresh agent can install/test/run using only repository state and saved setup instructions. PR/Actions API availability is verified separately from native Git access.

- [ ] Run the complete root check, production Bridge integration, suite boot/migration, packed-delivery and source/package audit; inspect current result counts and cleanup.
- [ ] Verify the iOS JavaScript development workflow and actual unsigned artifact if a macOS build becomes available; preserve failed/unrun outcomes explicitly.
- [ ] Request a fresh whole-branch review, fix material findings with regression evidence and run affected/full checks.
- [ ] Update and test saved installation/startup instructions for the relocated source. Confirm draft persistence without claiming publication.
- [ ] Leave reviewable commits; push/create a draft PR if supported by existing authorization and available access. Do not merge or publish releases. Report exact outstanding access/native-build limitations.
