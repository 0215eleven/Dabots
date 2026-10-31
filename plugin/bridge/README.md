# Dabots · Bridge module

Internal desktop module of the single [Dabots plugin](../README.md).
Users install the composed `ds-bot` TGZ; this module is not a separate product.

The Bridge uses public DSH Connection/Session APIs for device pairing, scoped
HTTP/WebSocket access, stable submission receipts, permissions and optional remote
transports. Capability discovery is authoritative. The production engine lives
in `../engine/`; pristine and patched public 0.1.7 sources remain compatibility
test fixtures only.

From the repository root:

```sh
npm run setup
npm run test:prepare
npm --prefix plugin/bridge test
npm run check:integration
```

The existing `ds-bot-mobile-bridge` row ID and explicit legacy homes remain stable.
First use initializes a dedicated `data/ds-bot-mobile-bridge` directory through
the public DSH home path API and starts a loopback listener. Installation alone
remains inert. The owner chooses official login or one of the two tunnel options;
only a ready connection can create a two-minute, single-use QR authorization. See [connection](../docs/connection.md),
[compatibility](../docs/compatibility.md) and [owner API](../docs/bridge-api.md).

For a Bridge-managed Cloudflare tunnel, the owner-entered tunnel token is stored
as **unencrypted plaintext** in `remote-connection.json` under that dedicated
home. Writes use POSIX mode `0600` (owner read/write); on Windows, protection
depends on the directory ACL, which must restrict access by other users. The
Bridge API never returns the saved token; `tokenSet` only reports whether one
is saved. Keep this file private and out of shared configurations and commits.

Internal standalone packaging/delivery checks remain available for regression
testing; normal delivery is `npm run pack:plugin`. Original LICENSE, NOTICE and
THIRD_PARTY_RELAY_NOTICES.txt remain part of the composed package.
