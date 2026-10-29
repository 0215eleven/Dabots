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
