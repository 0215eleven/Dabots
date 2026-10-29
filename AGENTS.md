# Repository instructions

This repository has two product directories: plugin/ (one desktop DSH plugin) and ios-app/ (unsigned lite iOS app). The cloud task is already isolated: use the existing checkout; do not create a Git worktree unless explicitly requested.

Use Node.js 24, npm, Git and Python 3. Run npm run setup, npm run test:prepare and npm run check. Run npm run check:integration and npm run check:suite for engine/Bridge/packaging changes, and the component packed-delivery checks for Bridge/UI changes. Keep unit, isolated host, archive, native build and device evidence distinct.

Use public DSH plugin APIs; never patch DSH or test against a user's live profile. The production engine is plugin/engine; public 0.1.7 fixtures remain test inputs. Never ship a .dev fixture as a production plugin. Preserve ds-bot package/module/row IDs, app.dsbot.mobile, dsbot scheme and storage/credential identities.

Edit plugin/engine/src/client and plugin/ui/src, then rebuild their generated client.js files. Do not hand-edit generated bundles. User-facing product name is DeepSeek Bot Pro; upstream capability names, provenance and original legal notices keep their meaning.

Keep original LICENSE/NOTICE and third-party provenance, including OpenBot's PolyForm Noncommercial license. Never commit signing, pairing, runtime state, private screenshots or credentials. Never overwrite existing tags or release assets. Public release authors use their configured human Git identity.
