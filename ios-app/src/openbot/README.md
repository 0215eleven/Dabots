# Code and art derived from OpenBot

This directory (plus `ios-app/assets/openbot/`, `ios-app/global.css` and `ios-app/patches/`) contains the phone UI of
[OpenBot](https://github.com/nightly-labs/openbot) (`apps/mobile`), copied and adapted for DS Bot Mobile.

- **Source:** `nightly-labs/openbot` at commit `c389f4404256e754214b6982503381778d80ed35`.
- **License of these files: PolyForm Noncommercial 1.0.0** (`./LICENSE`), Copyright 2026 Synthetify Labs spółka z ograniczoną odpowiedzialnością (`./NOTICE.upstream`;
  the upstream states a commercial licence is available from licenses@openbot.run). They are **not** covered by this repository's
  Apache-2.0 licence. Do not use a build that includes them commercially without a licence from the upstream.
- **Why it is here:** the project owner asked to reuse OpenBot's phone-side UI and art (fonts, sounds, splash eyes).
- **Not from OpenBot:** the connection layer. Sync (`ios-app/sdk/`, `plugin/bridge/`), the session (`src/session`), the outbox
  (`src/outbox`) and the connection hub (`src/connection`) are this repository's own. OpenBot's workspace context, team client, WebRTC
  transport and server code were not copied.

## What was copied, and what changed

| Area | Origin (`apps/mobile/src/…` upstream) | Here |
| --- | --- | --- |
| Chat list, composer, markdown, code block, message actions, outbox status, motion | `features/chat/{components,model}` | `features/chat/` (pruned: no voice, attachments, math, previews, plans, questions) |
| Large title, glass capsule, sheets, menus, haptics, type scale, text/i18n helpers | `shared/` | `shared/` |
| Settings stores (haptics, motion, language, message colour) | `features/settings/model` | `features/settings/model` |
| Message/attachment/IPC types and pure helpers | `packages/contracts` | `pkg/contracts` (type and pure-function files only) |
| English and Chinese UI strings | `packages/i18n` | `pkg/i18n` (other languages dropped; they fall back to English) |
| Design tokens | `packages/brand/src/tokens*.css` | `brand/` |
| Bot avatars (bloub shapes, colours, moods, orbit rings), group avatar | `features/agents`, `features/channels/components/channel-avatar.tsx`, `packages/brand/src/bloub-avatar*.ts` | `features/agents`, `features/channels`, `pkg/brand`; uses `@norbert_bodziony/bloub` (MIT) with Solid shims in `shims/` |
| Side drawer (swipe right from home): shell, icon buttons, profile avatar | `features/servers/components/app-drawer-shell.tsx`, `server-drawer-icon-button*`, `shared/components/profile-avatar.tsx` | same paths; `server-drawer-content.tsx` is rewritten for DS Bot (computers, team and host pages, this phone) in the same layout |
| Fonts (Inter), sounds, splash eyes | `apps/mobile/assets` | `ios-app/assets/openbot/` |
| Dependency patches (masked-view types, keyboard-controller, uitextview) | `patches/` | `ios-app/patches/`, applied by `npm run patch` |

Files marked "DS Bot Mobile adapter" are ours: Bot avatars are OpenBot's generated avatars seeded by the Bot id (a photo set in DS Bot still wins), activity and online state come from DS Bot's work status, `adapters/chat-model.ts` maps SDK messages and the
outbox onto OpenBot's view models, and `chat-screen.tsx`, `home-screen.tsx` and `locale-bridge.tsx` assemble them. Stubs return `null`
where DS Bot Mobile has no equivalent yet (attachments, voice, TeX, image generation, plans, questions, approval cards).
