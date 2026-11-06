# Compatibility

Use the production `plugin/engine/` and Bridge/UI from the same repository commit.
Their component version strings need not match: mobile handshake capabilities
and the engine's versioned `bridge.describe` contract determine available behavior.

Tool approval text is redacted by the host before the Bridge limits its length.
Group member approvals require `approvalText: 1` and the scoped
`bridge.approval-text` projection, since older owner-only state already truncates
reasons. Missing or failed redaction never falls back to that state text.
This requires updating the composed desktop plugin, without a phone bundle change.

A Bot approval needs one valid device with the approvals grant. An Agent approval
needs approvals and Agent access on the same device. Valid refresh authorization
is sufficient even when the device is offline; short-lived access-token expiry
does not revoke it. Grant changes and actual refresh-session expiry withdraw the
phone path. A pending computer card keeps its normal decision; without a computer
answerer and without any eligible phone, the host receives `unavailable`.

## Unreleased: 100 MB original attachments

Install the phone, composed desktop plugin (Bridge and Engine), and relay from
the same new source revision to enable `uploadTransfers: 1`. This source change
does not update existing release archives or a running relay. Old desktop
plugins and old or undersized relays retain the legacy 2 MiB upload limit;
the phone must not infer support from a package version string.

The limit is **100,000,000 bytes (100 MB)** per original and in aggregate per
message, with at most four originals. HTTPS and encrypted relay use sequential
256 KiB requests with durable offsets, SHA-256 verification, progress, cancellation
and retry from the acknowledged offset. RPC body, encrypted record and frame
limits are unchanged. Each request still has bounded timeouts; an interrupted
foreground upload can resume while its private draft and server staging survive.
Phone process termination or OS cache eviction requires selecting the file again.

Photos use the picker's Current representation. Its returned original bytes are
copied and verified without base64 aggregation; the system can return an edited
asset's current representation rather than its camera archive. A model preview
is a separate PNG/JPEG/WebP image, at most 2 MiB and 2048 pixels per side. Original
files remain exact file attachments. Originals over 20 MiB, over 64 million pixels
or 8192 pixels per side, or with unverified dimensions are not decoded for a
preview. Reading those originals requires the receiving model's file tools;
successful storage does not establish model parsing or vision support.

Phone draft cache: 400 MB / 16 originals. Bridge staging reserves at most 200 MB
per paired device and 1 GB globally, with one receiving file per device and four
globally. Unfinished uploads expire after 15 idle minutes; completed unused
receipts expire after 24 hours. Device revocation purges that device's staging;
Agent grant removal purges Agent staging. Receipts bind the device, conversation
and exact receiving Session. Cancellation/discard releases owned temporary files;
accepted content is retained under the host's normal attachment retention policy.

Automated evidence uses synthetic files and isolated public DSH, including real
HTTPS, encrypted relay reconnects, original-file digests and Bot/group/Agent
admission. Native picker, memory use and iPhone background behavior still require
device acceptance. No server deployment or installation package is part of this change.

The preserved package identity is `ds-bot`; the Bridge row is
`ds-bot-mobile-bridge` and its composed export is `ds-bot/bridge`.
Owner overrides should address the row ID without the old standalone package
name. Dedicated storage, device grants, receipts and protocol identities are
retained.

Pristine public engines without reliable submission/redaction must continue to
refuse those mobile capabilities. The integrity-pinned 0.1.7 fixtures test this;
they are never silently substituted into the production TGZ.

See [compatibility and evidence](../docs/compatibility.md) and
[migration](../docs/migration.md).
