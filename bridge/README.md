# Dbot pro Bridge

Custom source version **0.0.9-codex.8**, integrating desktop continuity and owner-controlled remote connection settings. Install only with companion **0.2.1-codex.5** built from the same reviewed commit of [this private fork](https://github.com/0215eleven/ds-bot-mobile-app). This is an unpublished source candidate, not the upstream Bridge release. [中文](README.zh.md)

## Setup and compatibility

Use the matched files ds-bot-mobile-bridge-0.0.9-codex.8.tgz and ds-bot-mobile-app-0.2.1-codex.5.tgz, checking the commit and SHA-256 in their packaging records before any separately authorized installation. Do not overwrite this custom pair with an upstream asset of the same package name. Preserve the existing compatible DS Bot engine and Bridge home. See [installation](https://github.com/0215eleven/ds-bot-mobile-app/blob/codex/integrated-desktop-remote/docs/installation.md) and [version sources and update behavior](https://github.com/0215eleven/ds-bot-mobile-app/blob/codex/integrated-desktop-remote/docs/version-sources.md).

Configure enabled, a dedicated absolute home, and a loopback host/port using cordis.patch.example.yml. The matching companion offers existing HTTPS, your own fixed-domain tunnel, or an explicitly confirmed temporary Cloudflare tunnel. Saving a choice does not start a tunnel. Existing publicUrl settings remain valid. Fixed mode validates and saves an existing HTTPS URL; it does not create Cloudflare resources. See [remote connection](https://github.com/0215eleven/ds-bot-mobile-app/blob/codex/integrated-desktop-remote/docs/remote-connection.md).

The public DSH Connection dispatcher and Session controller must be available. DS Bot must supply bridge.describe version 1 with redactedText:true and stableRequestId:true, scoped bridge.redact, and stable-ID bridge.submit; capability checks remain authoritative. Additional actions require the host's declared capabilities. Recent activity uses public Session list metadata; missing list support does not invent timestamps. Public npm DS Bot 0.2.0 is not a verified replacement for the compatible engine: its recorded source commit lacks these three endpoints. This task neither upgrades that engine nor verifies the user's installation.

## Behavior

Owner-approved device pairing, scoped Bot/group text access and team management are retained. Desktop continuity supplies recent activity, current work and foreground turn events; see [contract and limits](https://github.com/0215eleven/ds-bot-mobile-app/blob/codex/integrated-desktop-remote/docs/bridge-desktop-continuity.md). These are not background push, remote approval writes, file access or a durable event inbox. No mobile app source or package is changed.

Only Bridge's loopback service is forwarded. No DSH management port, Cloudflare credentials, automatic tunnel startup/restart, installer or system service is involved. A changed/stopped URL invalidates pairing codes and pending requests; re-pair with the existing phone flow. Existing device credentials remain bound to their original server URL.

## Updates and shutdown

Stop the old Bridge before migration and retain its dedicated home; never run two instances against one port/state directory. Disabling the companion only removes the management UI. Stop a temporary tunnel explicitly before disabling Bridge. If process exit cannot be confirmed, cleanup fails visibly and a recovery marker blocks the next listener until the owner verifies the old process has exited; see the remote connection guide. User-managed fixed tunnels remain external.

Both plugin packages have distinct manifests, commit records and hashes. Update behavior depends on the package manager, installed source and selected target, so an update is not categorically a downgrade. This branch preserves existing update mechanisms and upstream LICENSE / NOTICE. No release, live deployment, real-tunnel or phone acceptance is implied by fixture tests.
