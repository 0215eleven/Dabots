# Optional relay deployment tool

This is an internal deployment tool of the [desktop plugin](../../README.md),
not a third client product. The desktop and phone establish end-to-end encrypted
sessions; this service keeps an in-memory online registry and forwards frames.
It does not use Happy accounts, databases or public servers.

Use Node.js 24 and an owner-configured HTTPS/WSS reverse proxy. Runtime settings
include RELAY_ORIGIN, RELAY_SECRET_FILE, RELAY_HOST and RELAY_PORT. The registration
secret belongs in an owner-readable file outside the checkout, never Git or chat.

See [deployment](DEPLOYMENT.md) and [protocol](PROTOCOL.md). Repository unit tests
exercise the local service; they do not establish deployment or device acceptance.

The project license is [Apache-2.0](../../../LICENSE). Cryptographic adaptation
notices are retained under ios-app/sdk/vendor and plugin/third_party/happy.
