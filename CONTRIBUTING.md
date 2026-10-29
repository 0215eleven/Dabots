# Contributing

Use Node.js 24, npm, Git and Python 3. Keep changes on a focused branch and preserve compatibility identities and original third-party notices.

From the repository root:

```sh
npm run setup
npm run test:prepare
npm run check
npm run check:integration
npm run check:suite
npm run audit
```

For Bridge/UI changes also run their isolated packed-delivery checks, described in [plugin development](plugin/docs/development.md). Rebuild generated client bundles after source changes.

The desktop deliverable is one TGZ; the phone deliverable is an unsigned lite IPA built on macOS. Keep source verification, archive verification, native compilation, signing and physical-device acceptance separate in reports. Do not use real profiles, credentials or pairing material in tests.

Preserve original LICENSE/NOTICE. OpenBot-derived phone UI/art have their own PolyForm Noncommercial terms, recorded in [SOURCES.md](SOURCES.md). Include the actual checks, source commit and remaining platform limitations in a PR. Do not merge or publish a release without the owner's instruction.
