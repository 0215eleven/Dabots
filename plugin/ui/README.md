# DeepSeek Bot Pro · Desktop pairing UI

This internal UI is merged with the engine's client module in the single
`ds-bot` plugin. It provides owner-authorized pairing, device management and
connection settings through the DSH owner carrier. It is not a separate user
installation.

Edit `src/`, then run `npm --prefix plugin/ui run build` from the repository root;
`client.js` is generated and committed. Tests: `npm --prefix plugin/ui run check`.
The standalone archive/delivery harness is retained for lifecycle regression
testing; user delivery uses `npm run pack:plugin`.

[Plugin installation](../README.md) · [Connection](../docs/connection.md) ·
[Development](../docs/development.md)
