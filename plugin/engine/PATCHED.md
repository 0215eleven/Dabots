# DeepSeek Bot Pro engine modifications

This is the Apache-2.0 `ds-bot` 0.2.0 source bundled in the original cleaned
snapshot `5e5d62ba4d03d93f74f72e1ea611fbd02081868c` of
https://github.com/0215eleven/ds-bot-mobile. Its original LICENSE is retained.

`src/host/channel.js` registers the Mobile Bridge contract implemented in
`src/host/mobile-bridge.js`. This adapts the repository's reviewed
`group-bridge/patches/ds-bot-0.1.7-groups.patch` (now in
`plugin/test-support/patches/`) to the 0.2.0 plugin: scoped redaction,
stable-ID text submissions, group membership checks and owned Agent sessions.
Malformed conversation identifiers are rejected before Session admission.
The implementation uses public DSH Connection and Session APIs; DSH is unchanged.

This is production plugin source, separate from the pristine and patched
public 0.1.7 fixtures used to test compatibility. The repository Git commit,
engine digest and component versions are recorded in every composed TGZ.

## Brand mark

`client.js` replaces the engine's character art with OpenBot's Bloub robot
(MIT `@norbert_bodziony/bloub` 0.4.1, static paths in `scripts/bloub-paths.json`):
the brand chip, footer, launcher, welcome and About marks, every Bot avatar
through `characterMarkup`, and one face per group row. `scripts/patch-bloub-brand.mjs`
is idempotent and runs inside `scripts/pack-suite.mjs`, so a rebuilt package stays
branded without a manual step.
