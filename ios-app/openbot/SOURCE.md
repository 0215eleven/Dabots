# Pinned OpenBot mobile foundation

Source: https://github.com/nightly-labs/openbot

Commit: `0be0110737e55622f7a92c06a96a8eaaf516f114` (OpenBot mobile 1.4.3).

`mobile/` contains **all 805 tracked files** from upstream `apps/mobile/`, including
source, assets, native module sources, config plugins, configuration and documentation.
`packages/` contains all tracked files from the seven shared packages in the mobile
runtime dependency closure: `brand`, `contracts`, `i18n`, `logging`, `team-client`,
`telemetry`, and `user-errors` (1,810 files). The upstream shared `tsconfig.base.json`
is retained here, alongside the original, unmodified `LICENSE` and `NOTICE`.

The upstream code and assets retain the **PolyForm Noncommercial License 1.0.0**;
they are not relicensed by the root repository's Apache license. The original
required notices and third-party attributions remain in `LICENSE` and `NOTICE`.

## Provenance and adaptations

`provenance.json` records each source path, imported path, upstream Git blob ID and
file mode, upstream SHA-256, imported SHA-256, and any adaptation. Its catalog field
preserves the upstream version catalog used to resolve package declarations.

Only the eight imported `package.json` files differ from upstream: `catalog:`
references become explicit catalog versions and `workspace:*` references become
relative `file:` dependencies. No source, asset, native module, config plugin or
upstream notice is trimmed or replaced. There are no upstream tracked-file
exclusions. Untracked files, `.git`, installed dependencies, caches, generated
native projects and build output were not imported.

The installation entry point is **`../package.json`**, using npm workspaces for the
seven shared packages and local file dependencies named `@openbot/*`. The imported
mobile directory is an inactive source archive, not an additional npm workspace or
independent application installation. Its original app/deployment scripts are
retained as provenance; do not run them from this archive.

The existing root Expo SDK 58, React 19.3, React Native 0.88.1, TypeScript 5.9 and
installed native/UI dependency ranges are retained. Additional mobile runtime
dependencies and React DOM types are installed from the upstream declarations.
`@noble/hashes` is aligned to the shared packages' explicit 2.4.0 catalog version.
The Solid peers are pinned to upstream 2.0.0-rc.18 for the brand package; the
existing native Metro shims remain in control of native runtime imports.
OpenPanel 1.4.2 declares stale `expo-application` 5–7 and `expo-constants` 14–18
peer ranges. Narrow npm overrides select the root SDK 58 packages: its published
API calls (`nativeApplicationVersion`, `nativeBuildVersion`,
`getInstallReferrerAsync`, `getWebViewUserAgentAsync`) still exist there. This
resolves npm metadata compatibility, not analytics/device behavior verification.
The lockfile pins the complete installed graph. Shared package development tools
retain their explicit upstream catalog versions; they do not replace the active
app's TypeScript compiler.

Install with the repository's `npm run setup` (all install scripts ignored, followed
by the existing explicit `ios-app` patch helper). No upstream root Electron,
deployment, provider-runtime or native build script is part of setup. Package
scripts in this source archive may refer to upstream-only `scripts/` helpers;
these are not installation prerequisites or commands for this app.

## Activation boundaries for the next tasks

The active Expo project remains `ios-app/`. Its app identity (`app.dsbot.mobile`),
`dsbot` scheme, pairing/storage identities, routes, Metro aliases and native config
remain owned by that root app. Neither the archived `mobile/app.json` and
`app.config.js`, EAS/fastlane/fingerprint settings, nor its native module directory
is selected by the root app. Upstream public Firebase identifiers in the tracked
`google-services.json` are preserved for source completeness; they are not service
account credentials and are not selected by the root native config.

`../tsconfig.json` temporarily excludes this inactive `openbot/` directory, because
its existing broad `**/*.ts`/`**/*.tsx` include would otherwise typecheck two apps
with different aliases together. Active source and aliases are unchanged. This
exclusion is **temporary**: Task 3 must activate the chosen source, update aliases,
generate required types and typecheck the resulting active app. The preserved
`mobile/tsconfig.json` describes the original separate upstream project; imported
source has not yet been claimed to typecheck or run as the root app.

Task 2 can consume the full exports in `@openbot/contracts` (especially
`team-protocol`, IPC/types, capabilities and agent/message definitions) and
`@openbot/team-client` (Team client, state, framing and platform-neutral helpers).
Task 3 can consume `mobile/src/`, raw assets, the shared packages, theme and config
plugin/module sources while integrating with the existing DSH SDK and app
identities. Root legacy aliases such as `@openbot/contracts/*` still point at the
existing legacy subset until Task 3 changes them; do not assume a TypeScript alias
already selects these new packages.

Upstream account/provider/service UI is preserved as source only. Activation must
use DSH models and reasoning exclusively and capability-gate unsupported features;
presence in this archive does not authorize enabling upstream services.

Native compilation, signing, device behavior, iOS extensions, Android plugins and
deployment configuration are separate verification work. Source completeness and
Linux checks do not establish those outcomes.
