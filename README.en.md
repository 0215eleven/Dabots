# DeepSeek Bot Pro

This repository has two product directories:

| Directory | Product | Artifact |
| --- | --- | --- |
| [plugin/](plugin/README.md) | One desktop DSH plugin with the team engine, Mobile Bridge and pairing UI | `ds-bot-0.2.0-pro.1.tgz` |
| [ios-app/](ios-app/README.md) | iOS app source and an unsigned lite build | `DeepSeekBotPro-<version>-lite-unsigned.ipa` |

The optional relay deployment tools live inside `plugin/tools/relay/`. Package binaries belong in Actions artifacts or Releases, not Git.

Use Node.js 24, npm, Git and Python 3:

```sh
npm run setup
npm run test:prepare
npm run check
npm run check:integration
npm run check:suite
npm run audit
```

Tests use isolated profiles and a mock model. The production engine is included in `plugin/engine/`; a private directory on another computer is unnecessary. On a clean committed checkout, `npm run pack:plugin` writes the TGZ, checksum and source record to ignored `artifacts/`.

The [products-release workflow](.github/workflows/mobile-release.yml) creates desktop and iOS artifacts. Manual runs default to artifacts only. Native iOS compilation requires macOS/Xcode; the workflow runs Expo prebuild, CocoaPods and an unsigned Xcode archive, then packages `Payload/*.app`. Users must sign the IPA with their own identity before installation. See [build and signing](ios-app/docs/build-and-sign.md). Releases are new drafts and existing tags/assets are never replaced.

The product display name changes, while `ds-bot`, plugin row IDs, `app.dsbot.mobile`, the `dsbot` URL scheme and stored identities remain compatible.

DS Bot, Bridge and project code use Apache-2.0. Adapted OpenBot phone UI/art use **PolyForm Noncommercial 1.0.0**, not Apache-2.0; commercial use requires compliance with that license. Original notices remain intact. See [SOURCES.md](SOURCES.md), [NOTICE](NOTICE) and the [OpenBot provenance](ios-app/src/openbot/README.md).
