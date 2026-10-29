# Prepackaging Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for this maintenance pass. Track steps with checkboxes and use one independent review after combined validation.

**Goal:** Verify and fix the seven reported installation, diagnostic privacy, upstream configuration, native dependency, bundle, legacy-code and CI issues before the user's packaging test.

**Architecture:** Keep the current OpenBot-based DS UI and public Bridge adapter. Correct dependency/configuration boundaries and diagnostic cleaning; retain supported functionality and safely exclude unused native/code paths. This is maintenance of the approved design, not another product redesign.

**Tech Stack:** Node24/npm, Expo58/RN0.88, existing pinned DSH public fixtures and production plugin, Linux build host.

**Spec:** The seven review items supplied by the user in this task on 2026-10-29, plus the existing `.github/plans/2026-10-29-openbot-core-sync-design.md`. The user's latest execution instruction authorizes these fixes and pushing this feature branch; phone packaging follows separately.

## Global Constraints

- Use existing isolated checkout and `codex/openbot-core-sync`; inspect local/remote before edits. No main merge, new worktree, release, tags, build dispatch, device installation or credential changes.
- Preserve Bridge protocol2 ACK, heartbeat, immediate reconnect, queue and connection coordination; DSH-only models/efforts; English and Simplified Chinese; package/module IDs, `app.dsbot.mobile`, `dsbot`, persisted pairing/cache/outbox identities.
- No OpenBot account/directory/WebRTC/analytics/crash reporting activation. Keep PolyForm Noncommercial and all original legal notices; mixed source is not wholly Apache.
- Do not expose upstream Firebase values or copy them into preserved-original files; preserve attribution and record intentional sanitization without rewriting history.
- Change registry hosts without unrelated dependency upgrades; compare surviving lockfile version/integrity entries before/after dependency-boundary work.
- Unit, isolated browser/host, JS export, Linux prebuild/config inspection, Xcode archive and physical-device evidence are distinct. No new IPA is authorized in this pass.

## Review Focus

- Absolute workspace and dependency paths outside the user's home, POSIX, Windows, UNC, file URL and escaped forms must not leak through persisted diagnostic entries, stderr, reports or reloaded logs; credentials and useful stack symbols still behave correctly.
- Disabling native modules must not leave a reachable component executing their import-time native registration; required pairing/camera/secure storage and existing Agent sessions must stay functional.
- Expo autolinking and RN autolinking must both honor the same iOS exclusions after a clean install and prebuild.
- Unsupported locales must fall back to English while Chinese remains reactive; vendored source retention does not require shipping every catalog in the JS graph.
- CI should still run necessary PR/main checks without running duplicate checks on every feature push or building Android.

### Task 1: Diagnose and correct install/privacy/CI/config defects

**Files:** `ios-app/package-lock.json`, `plugin/bridge/package-lock.json`, `plugin/ui/package-lock.json`; `plugin/engine/src/host/diagnostics.js` and `plugin/engine/test/diagnostics.test.js`; `.github/workflows/check.yml`; upstream Firebase/provenance/source records.

**Interfaces:** Keep `cleanText(text, {redact, home})`, diagnostic report/log APIs and all dependency versions/integrities. Input privacy applies independently of checkout location. CI remains quality checks only.

- [x] Count and normalize the 88 mirror resolved URLs to the official registry, retaining dependency identities and integrity. Expected: no mirror URLs and no unexplained version/integrity changes.
- [x] Reproduce the diagnostic gap with the repository's actual resolver-enabled command; write failing behavior tests for non-home paths and output sinks, implement minimal cleaning, then run focused diagnostics and engine tests. Expected: new tests fail before and pass after without weakening privacy assertions.
- [x] Verify Firebase references, sanitize the unused imported configuration without printing values, and update provenance/legal adaptation notes. Expected: no usable upstream configuration in delivered files, no active reference requiring it.
- [x] Restrict check triggers to necessary main/PR/manual events and cancel superseded runs; keep quality jobs, remove feature-push duplication, retain existing iOS-only product scope. Expected: workflow structure and events meet these constraints without triggering a build.

### Task 2: Bound native linking, locales and legacy surface

**Files:** `ios-app/package.json`, `app.json`, `app.config.js`, new focused native autolinking configuration/helper if needed; `ios-app/openbot/packages/i18n/src/*catalog*`, adapted imported files plus provenance; relevant meaningful behavior/config tests; product documentation.

**Interfaces:** Actual active core/Agent routes, Metro aliases, Expo58 autolinking config and existing locale bridge. An independent read-only native reference audit supplies evidence; implementation remains in this session.

- [x] Inventory required native modules versus unused import graphs using real active paths; test required/excluded module registration behavior. Disable unused iOS autolinking at the supported configuration boundary, remove inactive top-level imports only where needed, and add precise permissions only for actual supported features. Expected: generated native config/pods/InfoPlist agree with documented inventory, no unused sensitive permissions or modules. Skia/WebView remain required by imports; UI-dependent removal awaits the user's UI integration.
- [x] Limit shipped mobile catalogs to English/Chinese and appropriate fallback, without deleting the full pinned upstream source or claiming a startup-speed gain. Add regression coverage of locale switching/fallback. Expected: same supported behavior, observable reduced graph/bytes under the same Hermes profile.
- [x] Trace retained `src/openbot` uses; unify only where independently safe, otherwise document exact live Agent/shim scope. Expected: original Agent chat and pairing paths preserved, unused legacy paths not falsely presented as active.

### Task 3: Combined verification, independent review and delivery

- [ ] Run clean official-source `npm run setup`, `npm run test:prepare`, explicit typecheck and complete `npm run check`, recording actual per-component counts and explaining engine-only842 versus aggregate1392. Run related production integration/TGZ/migration/packed checks for engine/packaging changes.
- [x] Run preview-disabled isolated public-host baseline/final-all and Chinese browser regressions, preserving Bridge/outbox/owner/locale assertions; then one final iOS JS export and isolated prebuild/autolinking inspection on stable source. Expected: functional assertions and configuration checks pass; Xcode/IPA/device remain UNRUN. These are the non-UI maintenance results; repeat affected integration after the user's UI reference arrives.
- [ ] Self-review, commit and request one independent review of this maintenance range. Address evidenced Critical/Important findings in one bounded fix pass with affected verification; avoid restarting the earlier whole integration review.
- [ ] Package/audit from clean committed source, push the feature branch and verify remote SHA; update saved environment setup/ref only if needed. Report each of seven items as fixed/not-applicable/retained with evidence, source SHA, exact checks and genuine native gate.
