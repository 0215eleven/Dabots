# DS Bot Mobile App · Native client

The Expo / React Native client for [DS Bot Mobile App](../../README.en.md), targeting iOS and Android. The current source uses Expo SDK 54, React Native 0.81.5 and React 19.1.

[中文项目说明](../../README.md) · [Documentation](../../docs/README.md) · [Installation](../../docs/installation.md) · [Development](../../docs/development.md) · [Compatibility](../../docs/validation.md)

## Mobile source for building

This private fork identifies the mobile source package as `0.1.8-codex.3` and native display version as `0.1.8`. Since PR #10 the phone adds the owner-granted DSH Agent entry; without a granted device or the matching Bridge it behaves as before. The bundled SDK `0.1.1-codex.4` adds optional task-event APIs that the current phone does not use. The phone uses the existing handshake and only enables history, streaming and sending when the server explicitly advertises each capability; cached or unknown capabilities do not authorize operations. No IPA/APK or device acceptance is implied. Build from the reviewed commit, select build numbers from the actual target distribution history, and preserve app identity and signing. See the existing [development guide](../../docs/development.md) for build setup and [desktop delivery](../../docs/integrated-delivery.md) for the separately paired plugins.

## Requirements

- Node.js 24 and npm.
- iOS: macOS, Xcode and an iOS Simulator or a device with your own signing identity.
- Android: Android SDK, its required build toolchain, and an emulator or device.
- A configured DS Bot Mobile Bridge and a trusted HTTPS endpoint for actual host access.

The project includes custom native modules. Use a development build for native testing; Expo Go does not provide the complete runtime.

## Install dependencies

From the repository root:

```sh
npm run setup
```

Or, when working only in this directory:

```sh
npm ci --ignore-scripts
```

## Run a development build

From this directory, choose one platform:

```sh
npm run ios
# or
npm run android
```

These scripts invoke `expo run:ios` / `expo run:android`, generate native projects when needed and install a development build. Changes to native modules require rebuilding that client; restarting Metro alone does not add native code. See the official Expo guides on [development builds](https://docs.expo.dev/develop/development-builds/introduction/) and [local compilation](https://docs.expo.dev/guides/local-app-development/). After installing the development client, `npm start` starts Metro for it. Use your own signing configuration for device builds. The public source defaults to `app.dsbot.mobile`; an update to an existing installation must retain its bundle identifier, signing identity and Keychain access. See [installation](../../docs/installation.md).

## Install a release build on iPhone

A development build runs unoptimized JavaScript with development checks and is noticeably slower, especially when scrolling chats. For everyday use, install a Release build on a connected iPhone:

```sh
npm run ios:release
```

This runs `expo run:ios --configuration Release --device`, which bundles optimized Hermes bytecode into the app and needs no Metro server. Signing works as for the development build.

## Design preview

For an isolated Web preview with synthetic conversations, run from this directory:

```sh
EXPO_PUBLIC_DS_BOT_DESIGN_PREVIEW=1 npm run web
```

The preview requires development mode and does not connect to a real host. It is useful for layout review; native keyboard, gestures and device lifecycle require native testing. See [design notes](../../docs/design.md).

## Checks

```sh
npm run typecheck
npm test
```

The standalone Bridge exposes a restricted capability set. UI components are enabled according to capability discovery; available components alone do not imply server support. See the [capability matrix](../../docs/validation.md).

## License

[Apache-2.0](../../LICENSE). Upstream attribution is retained in [NOTICE](../../NOTICE).
