# Compatibility

Use the production `plugin/engine/` and Bridge/UI from the same repository commit.
Their component version strings need not match: mobile handshake capabilities
and the engine's versioned `bridge.describe` contract determine available behavior.

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
