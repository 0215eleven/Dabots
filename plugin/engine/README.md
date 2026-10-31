# Dabots · bundled team engine

Production ds-bot 0.2.0 source, with the Mobile Bridge contract adapted locally.
The original Apache-2.0 [LICENSE](LICENSE) and [NOTICE](NOTICE) remain intact;
source and modifications are recorded in [PATCHED.md](PATCHED.md).

This directory supplies the team runtime and browser client to the single
[desktop plugin](../README.md). Its files are composed with ../bridge and ../ui
by the repository's pack:plugin command. Tests and .dev fixtures are not user
deliverables.

From the repository root, run npm run setup and npm run test:prepare, then:

```sh
npm --prefix plugin/engine test
npm --prefix plugin/engine run lint
npm --prefix plugin/engine run build
```

Client source is in src/client; client.js is generated. The API channel and
mobile contract are in src/host/channel.js and src/host/mobile-bridge.js.
Peers come from the actual DSH install in production; isolated tests resolve
them through the pinned harness prepared under plugin/bridge/fixture/deps.

No DSH internals or live user profiles are modified. Package/module/row IDs and
existing storage identities remain compatible.
