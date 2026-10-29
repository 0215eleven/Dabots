# DeepSeek Bot Pro verification — 2026-10-29

The consolidation uses verified ds2 commit `4d61cf517b74d005fa9edaed1d37a34451916cc8`. The owner delegated the source choice after the referenced Codex thread could not be read. Additional changes unique to that unavailable task are not claimed.

## Verified source and isolated delivery

| Check | Observed result |
| --- | --- |
| Root `npm run check` | 1,278 Node tests: 1,276 passed, zero failed, two existing Windows-only file-lock tests skipped; 11 Python IPA-validator tests passed |
| Engine lint and generated client | Exit zero; 11 inherited style warnings remain |
| Production engine/Bridge integration | 21 assertions passed on public DSH 0.2.1-rc.2 with a scripted mock model |
| Production TGZ boot | Five checks passed, including the combined client and actual Bridge contract |
| Production migration and rollback | Six checks passed; the existing synthetic phone authorization and receipt survived migration and rollback |
| Bridge packed lifecycle | 11 assertions passed on a fresh isolated public DSH profile |
| UI packed lifecycle | Seven assertions passed through the official manager, preserving Bridge authorization |
| Isolated Expo prebuild | Generated `DeepSeekBotPro.xcodeproj`, with no APNs or App Group entitlements |
| Native iOS JavaScript bundle | HTTP 200, 19,997,962 bytes from the Expo Router entry on Metro |
| Synthetic browser preview | HTTP 200; opened Chief and displayed the expected reply; zero unhandled page errors |
| Source audit and current documentation links | Passed during consolidation; re-run the audit after packaging the current committed source |
| Independent branch review | No Critical or Important findings; minor internal package-source links corrected |

Production integration and composed-TGZ boot/migration use `plugin/engine`. Component packed lifecycle checks deliberately use reviewed compatibility fixtures. These are separate evidence. All test hosts use disposable profiles; no private user profile or DSH source modification is involved. Their child services and the task's Metro servers were stopped.

The initial packed-delivery retry exposed that isolated subprocesses stripped managed proxy/CA variables. A regression was observed failing, then passed after preserving transport variables while continuing to exclude application tokens and isolate HOME/DSH_HOME. Root checks, production integration, boot/migration and both component lifecycles passed again after that fix. The final repository-link correction changes manifest metadata only; both manifests were parsed and their compatibility identities checked.

## Artifact and environment evidence

`npm run pack:plugin` requires clean committed source and writes the production TGZ, `plugin-release.json` and `SHA256SUMS-plugin` under ignored `artifacts/`. Those generated records identify the exact packaged commit and archive digest; this document does not hard-code a self-referential final commit or reuse an older archive's checksum. Internal component archives are regression inputs, not additional products.

The relocated installer was executed successfully, preserving and checking the pinned compatibility fixture. Updated installation/startup instructions and custom network access for `api.github.com` were confirmed saved in the cloud configuration draft. Saving the draft does not apply or publish it; environment settings still require review/save and publication. Fresh-task restoration has not been independently tested.

The feature branch was pushed through existing Git HTTPS authentication. Creating a draft PR failed because the current network policy rejects `api.github.com/graphql` with Forbidden. This is separate from working Git access; no replacement token was requested. No PR creation, remote Actions result, merge, tag or release publication is claimed.

## Limits and retained decisions

- Native Xcode archive, an actual unsigned IPA, post-signing installation and device acceptance remain unrun on this Linux machine. The macOS workflow and controlled ZIP-validator tests do not prove these outcomes.
- OpenBot UI/art retains its PolyForm Noncommercial license. The root Apache license does not replace upstream terms; commercial distribution requires the applicable upstream permission.
- Keep `ds-bot`, plugin row/module IDs, `app.dsbot.mobile`, `dsbot` scheme and storage/credential identities. Product versions distinguish these bytes from existing releases.
- Shared platform code remains inside the two products where needed; Android/EAS and standalone Electron release entry points were removed.
- Existing nonfatal web development warnings remain. Synthetic browser and mock-model evidence does not certify a real user's installation or live model/provider behavior.
