# Unified editable computer names

Approved scope: each saved computer has its own phone-local nickname. Use it for
the home title, connection card and computer switcher; retain the paired computer
name as the default. Keep the status line free of the duplicated title. Provide
rename/reset in settings, with Chinese/English labels and verified local saves.

Keep name state in a separate provider below SessionProvider. Never replace the
connection's Host/client/outbox objects merely to edit a display name. Store each
nickname under its stable serverId, independently of language, credentials and
desktop settings. Serialize writes and confirm readback before publishing.

1. Reproduce the fixed home title mismatch; test validation, host isolation,
   delayed reads/writes, reset, storage rejection and reload persistence.
2. Add the name store/provider, bind visible names, and reuse the native sheet,
   form field and save action for renaming current or inactive computers.
3. Verify actual two-computer rename/switch/reload/offline behavior and unchanged
   connection/outbox identity, run mobile checks sequentially and one scoped
   review, update adaptation provenance, then commit/push this feature branch.
   No IPA/release/main merge or remote computer rename.
