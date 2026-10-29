# Isolated product acceptance

The imported OpenBot core screens use the existing DS session, SDK, outbox and public
DSH APIs. Desktop state is authoritative. Foreground snapshots refresh every eight
seconds; writes and reconnects trigger immediate readback. Models/reasoning come from
DSH. Unsupported services stay capability-gated.

Use Node 24 and the existing root `npm run setup` / `npm run test:prepare` setup.
For actual host acceptance, start ordinary development Metro, **not** `ios:preview`:

```sh
cd ios-app
DOTSLASH_CACHE=/workspace/.cache/deepseek-bot-pro/dotslash \
EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_DS_BOT_DESIGN_PREVIEW=0 \
EXPO_PUBLIC_DS_BOT_ENABLED_FIXTURE=0 npm_config_cache=/tmp/ds-bot-mobile-npm-cache \
npm run web -- --host localhost --port 8093 --max-workers 2
```

Wait for `http://127.0.0.1:8093/status` to return `packager-status:running`. From the
repository root, with Playwright available and Chromium installed:

```sh
DS_TEST_URL=http://127.0.0.1:8093 node ios-app/test/browser/ds-isolated-host.cjs
```

The script creates disposable public DSH 0.2.1-rc.2 homes, loads `plugin/engine`,
uses the local scripted model, pairs through the actual UI and approves through the
fixture owner. It verifies real host history, mobile messages, dropped acknowledgement,
reconnect, runtime Stop, Bot/group/model/settings mutations, denied writes, foreground
visibility, hidden/removed entities, host switching and revoked devices. It closes its
browsers, proxy sockets and child services in `finally`; Metro remains owned by the caller.
Private fixture files remain ignored. Do not reuse or publish pairing data.

`isolated-bridge-proxy.cjs` is test-only. It forwards only `/mobile/v1/` to the fixed
issued loopback fixture, permits the exact Metro browser origin and handles both HTTP
and WebSocket upgrades. Pairing occurs at that same proxy origin, preserving SDK origin
binding. It models native Origin behavior without changing production Bridge auth, TLS,
SDK validation or browser security. A development warning toast is made noninteractive
only in the test page; console and page errors are still collected.

Optional `DS_TEST_SCREENSHOTS=/tmp/<private-directory>` captures representative 390px
browser pages with synthetic fixture content, never the pairing page. Output is refused
inside the checkout. Screenshots and runtime files must not enter Git.

The actual browser run does not prove native iOS transport, IME, keyboard, gestures,
Keychain, installation or upgrade behavior. Web credentials intentionally remain only in
tab memory. Root storage/outbox tests and the isolated TGZ migration verify legacy slot,
stable pending request and Bridge identity contracts independently. Xcode compilation,
unsigned IPA, post-signing and physical-device upgrade/recovery remain separately unverified.

The existing final validation chain is `npm run check`, `npm run check:integration`,
`npm run check:suite`, the affected Bridge/UI `test:delivery`, clean-source
`npm run pack:plugin`, and `npm run audit`. Web/iOS Metro exports and iOS prebuild run
in temporary output; no generated artifacts or new release workflow are committed.

Task 4 runtime baseline `538b6df` logged 17 actual UI/host scenarios plus the browser
error assertion (desktop rename visible in 7785 ms). Review found its lost-ack case
dropped a missing-receipt GET, so that entry did not prove loss of a successful
submission response. The corrected scenario below targets only the exact successful
POST, records its request ID/status, observes the browser itself retrieve the accepted
receipt for that ID, and asserts one POST and one canonical history/UI item automatically before
reconnect, then verifies reconnect does not duplicate it. Independent SDK/outbox tests do not replace this actual UI check.

Unchanged baseline gates passed: production Bridge integration
21, TGZ boot 5/migration 6, Bridge delivery 11 and companion delivery 7. Companion
delivery uses the existing reviewed compatibility fixture; the integration, browser
and single-package suite use the production engine. The root check passed before
the final palette addition; affected mobile typecheck and 293 Node/11 Python tests
passed afterward. Baseline web export passed (4476 modules), as did isolated iOS
prebuild. New user-requested Chinese/home changes are tracked as Task 5: final web
and iOS exports belong to that stable source, so baseline iOS export was deferred.
These results do not claim native compilation or physical-device acceptance.

Run only the corrected actual-host acknowledgement scenario against existing normal
Metro (the script still pairs a fresh disposable production host):

```sh
DS_TEST_SCENARIO=lost-ack node ios-app/test/browser/ds-isolated-host.cjs
node --experimental-strip-types --test ios-app/test/ds-presentation.test.ts ios-app/test/isolated-bridge-proxy.test.ts
```

The proxy validates the resolved target origin and API pathname for HTTP and
WebSocket forwarding, including plain/encoded dot-segment rejection. Focused tests
also ensure receipt GETs, other POST endpoints and unsuccessful POST responses
cannot consume the successful-submission fault. The provider's named avatar palette
uses resolved theme darkness; System appearance changes invalidate its memo.

The late-receipt convergence defect discovered during this scenario is corrected:
the owning outbox retains exact canonical request/conversation/Session/device
evidence from canonical user rows (excluding local/streaming placeholders) and
settles it when the accepted receipt arrives, in either order. It
never treats transcript visibility alone as acceptance and leaves unconfirmed
persistence untouched. The actual UI settled automatically in 297 ms before any
forced reconnect (one POST, one canonical record, one visible row); a subsequent
reconnect retained that single row. Core/outbox regression coverage requires no
second history/stream update, and checks Session mismatch, disposal and owner
isolation. Evidence is ephemeral; storage and request identities are unchanged.

## Task 5 Chinese core UI and home header

The existing language preference offers English and 简体中文. Active DS controls
subscribe to the same locale store and imported language bridge; no second locale
protocol is introduced. The original per-host `mobile-preferences` record retains
its identity and unrelated fields. Writes are verified and a failed save is shown
as session-only. Host/system follow modes and explicit English/Chinese choices
retain their existing behavior. DSH model references and effort IDs remain exact;
known generic effort labels translate for display and unknown host labels fall back
unchanged. User names, roles, messages and model names remain data.

Both `/` and `/connected` show one brand heading and an accessible 44pt gear that
opens real settings. Other pages retain their actual back navigation. Settings,
management uncertainty/review, Bot/group forms, chat states and model controls use
existing catalogs. Changes are scoped to copy/reactivity and this home correction.

Task 5 verification uses the same preview-disabled app and disposable public DSH
with the production engine. The original 18 host scenarios pass separately from
the 8-outcome Chinese flow and the focused 3-outcome pending locale/history flow:

```sh
DS_TEST_SCENARIO=baseline node ios-app/test/browser/ds-isolated-host.cjs
DS_TEST_SCENARIO=chinese DS_TEST_SCREENSHOTS=/tmp/<private-directory> node ios-app/test/browser/ds-isolated-host.cjs
DS_TEST_SCENARIO=pending-locale DS_TEST_SCREENSHOTS=/tmp/<private-directory> node ios-app/test/browser/ds-isolated-host.cjs
```

The Chinese checks include locale changes on mounted settings errors, saved host
preferences, host/system fallback, separate computers, English restoration, both
home routes and actual gear/back controls. A held real submission verifies that
`发送中` follows language changes while preserving one request ID/POST; releasing
it yields canonical history and a real test-model reply. A storage-denial check
requires visible feedback. The unknown-change check forwards a real successful
settings POST and truncates only the browser's acknowledgement JSON, then checks
Chinese/English review and canonical desktop state. The submission-loss proxy
scenario remains separately targeted to the successful POST and its actual receipt.

Six 390px Chinese screenshots stay outside Git. The chat image waits for canonical
history and test-model reply; the test data and browser-native effect limitations
remain explicit. They do not establish physical iPhone/Android or native mask,
keyboard, Keychain or gesture behavior.

The required root check passed 1374 Node tests with two intentional Windows skips
and 11 Python tests before the final copy refinements. Stable final mobile source
passed typecheck, 304 Node tests and 11 Python tests. Final preview-disabled web
export bundles 4478 modules (19 JS bundles and one CSS bundle); final iOS export
bundles 4967 iOS modules plus 118 DOM modules, with one Hermes bundle and 37 assets.
These are Linux JavaScript/export checks. Task 4's unchanged native prebuild,
engine/Bridge/SDK and packed integration evidence remains at its own source point;
Xcode compilation, IPA, signing and physical-device behavior remain unrun.

Task 5 source packaging follows a clean implementation commit: production
`ds-bot@0.2.0-pro.1`,85 archive files,original identities/licenses retained.
Source/archive audit passes3826 records with zero findings. After the evidence
documentation commit, refresh the package metadata from that clean final HEAD;
all changed production hashes must still match the verified exports.
