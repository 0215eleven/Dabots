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

The eight imported `package.json` files adapt catalog/workspace declarations for
npm. Task 3 additionally adapts 21 mobile source files for DSH transport, actual
screens, capability guards and platform boundaries. Their current hashes and
upstream hashes are distinct in `provenance.json`. Every adapted source file has
an exact upstream copy in `adaptations/original/`, recorded by path and SHA-256.
The extracted drawer context is recorded in `additionalFiles`. No original
tracked path or asset is excluded, and the full original source remains available.
Untracked upstream files, `.git`, dependencies and build output were not imported.

The installation entry point is **`../package.json`**, using npm workspaces for the
seven shared packages and local file dependencies named `@openbot/*`. The mobile
source is now actively consumed by the root app; `mobile/` is still not an
independent Expo project or installation entry point. Its original deployment
scripts are provenance only and must not be run here.

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

## Active DSH integration

The active Expo project remains `ios-app/`. Root identity `app.dsbot.mobile`,
`dsbot` scheme, pairing credentials, host caches/outbox and lite native config
are unchanged. Imported app.json/app.config.js, EAS/fastlane/Firebase settings,
native modules and deployment scripts do not configure this app.

Root `@/*` and `@/assets/*` aliases select the full imported source/assets.
`@openbot/*` resolves the real shared npm workspaces. `@legacy/*` explicitly
isolates the older subset used only for owner-granted DSH Agent conversations.
The root TypeScript project checks all application roots and their entire active
import graph; it excludes preserved originals, not active imported source.

`/` and `/connected` mount adapted `ConnectedScreen`, preserving original list
rows, pinned grid, list reveal and large-title components. Bot and group routes
mount `AgentChatScreen` / `ChannelChatScreen` and `ChatView`, with the original
header, message list, composer, markdown and motion components. Bot/group forms
retain original appearance, sheet, member-choice and settings components while
using DSH fields. Root settings uses the imported settings components.

All transport bindings live in `../src/ds/`. The original root SessionProvider
still owns pairing, client, outbox, reconnect and host selection. The DS provider
binds by current refs, disposes on owner changes, and supplies the original
workspace contexts and presentation stores. It never constructs the archived
account/directory/WebRTC provider or fabricates a cloud handshake. The original
provider is preserved byte-for-byte in the adaptations directory.

Model references and effort IDs come exclusively from DSH. Supported actions
use canonical DS commands and readback. Unsupported capabilities are false and
unsupported operations throw; direct unsupported routes render unavailable.
Pending delivery remains separate from the canonical transcript. Shared
appearance comes from canonical DS preferences; phone preferences stay local.
Analytics/report queues are inactive. Native-only WebView probing is guarded on
web; swipe rows can mount without the account-backed drawer.

Linux typecheck, Node/Python tests, web/iOS Metro exports and browser smoke are
recorded in the Task 3 implementation report. Browser smoke uses only the
existing synthetic preview. Real-host pairing/mutations/recovery, native
compilation/signing and device behavior remain separate Task 4 verification.

## Task 3 review fix 1

Foreground chat leases now reacquire after the session lifecycle closes streams.
Host transcript/session metadata distinguishes connecting placeholders; merged
history keeps loaded pages and live overlap precedence. Group forms track touched
fields against current canonical values. Client-owned management uncertainty
survives control remounts and requires a fresh desktop read plus explicit review
before another intent. The shared sheet Save component has a real web button
where native Stack.Toolbar does not render. The actual pagination error is shown.

Enabled integration fixtures require __DEV__ and both explicit preview/fixture
environment flags. They use the actual SessionProvider, DS core, imported forms
and menu action closure with synthetic DSH-shaped responses. The test-only menu
observer is inactive otherwise. No fixture enables a provider/cloud account.

Task 4 product acceptance adds browser blur commit to the retained chat composer,
canonical quiet motion for pin/list transitions, visibility of hidden pinned Bots,
and exact DS hexadecimal avatar colors (including grayscale). Presentation keeps
OpenBot's shape/motion components and separate hue fallback; stored DS colors and IDs
are unchanged. Narrow settings wrap their accent controls. Browser scroll edges use a
surface fade because the native MaskedView web fallback draws the mask itself, and
browser large titles use explicit header clearance. Native iOS paths remain intact.
Every adapted upstream file retains an original under `adaptations/original/` and its
current SHA-256 in `provenance.json`. See `../docs/isolated-host-acceptance.md` for the
actual-host harness and the browser/native evidence boundaries.

## Task 5 Chinese UI and home header

The active DS screens subscribe to the existing app locale; the existing language
bridge continues to drive the imported typed catalog. Simplified Chinese and English
remain the same host-scoped `mobile-preferences` values. Language saves preserve
other fields and verify readback, showing a session-only warning if storage fails.
Core states, uncertain-change review and navigation labels translate at render time;
user names/messages, model names/references and effort IDs remain original DSH data.

Both home routes hide only their native stack header and keep one existing in-content
brand heading with an accessible 44pt gear. This is the narrow authorized home
exception to native chrome: retaining a second native title/action caused duplicated
branding. Insets come from the existing safe-area hook. Other screens retain their
native headers and real back navigation. No native dependency or provider is added.
Every affected upstream file was already adapted and keeps its exact upstream
original; all current hashes are updated in `provenance.json`.

Task 5 actual-host Chinese screenshots and checks use disposable public DSH with
the production engine and normal preview-disabled Metro. They are browser-only;
Linux exports do not establish native Xcode compilation, IPA or device behavior.
