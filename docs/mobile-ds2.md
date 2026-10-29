# Mobile DS 2.0

Mobile DS 2.0 moves the phone app to Expo SDK 58 (React Native 0.88, React 19.3), file-based routing with native navigation, a sequenced WebSocket sync protocol, a durable outbox and an iOS Live Activity. It is developed on branch `ds2`. Evidence level: unit and fixture tests plus a Metro bundle and `expo prebuild` for both platforms. **No device acceptance** (iPhone, Android, Dynamic Island, real relay) has been performed.

## Connection layer

One native `WebSocket` (React Native's, or the pinned-TLS native socket for local HTTPS, or the encrypted relay socket) per open conversation. No WebView and no WebRTC.

| Concern | Behaviour | Where |
| --- | --- | --- |
| Sequence + ack | Every stream event carries `eventSeq`. A phone that authenticates with `protocol: 2` gets `ready { protocol: 2, heartbeatMs }`, acknowledges the highest applied `eventSeq` (every 8 events or 250 ms) and receives a `heartbeat { head }` every 15 s. The Bridge accepts nothing but bounded, monotonic `ack` frames for sequences it sent, and closes `4408` when more than 1024 events are unacknowledged. A protocol 1 phone or Bridge keeps the old strict behaviour. | `packages/mobile-sdk/index.js`, `bridge/src/server.js` |
| Cursor catch-up | The SDK keeps the last `eventSeq`; reconnects send `after: <cursor>`. The app also persists the cursor per conversation and resumes from it on a cold start when a transcript is cached. | `connect()`, `apps/mobile/src/chat/useChat.ts` |
| Backoff | 750 ms doubling to a 15 s cap, with up to 20 % jitter below the cap. A silent protocol 2 stream (no frame for 2.5 heartbeats) is dropped and resumed. | SDK |
| Network recovery | `expo-network` reports offline→online or an interface change; the hub calls `reconnectNow()` on every open stream (skipping backoff) and resumes the outbox. | `apps/mobile/src/connection/hub.ts` |
| Background | Sockets close in the background. A foreground push, a tap on a notification or returning to the app triggers the same "reconnect now"; each stream then resumes from its cursor. Background delivery itself is the existing notification service. | hub, `SessionProvider` |

Outgoing messages use the existing idempotent `requestId` + receipt (`GET /submissions/:id`, then `POST`), not the socket, so a lost response can never duplicate a send.

## Outbox

`apps/mobile/src/outbox/outbox.ts`: durable FIFO per conversation. States `queued → sending → sent` (kept until the host echoes the row), `queued` again with jittered backoff (≤ 15 s, 6 automatic attempts) on transport errors, `unconfirmed` for a manual retry, `rejected` when the host refuses. A restart reconciles by receipt before any second submit; a send created under a previous pairing is rejected instead of retried. Bubbles show sending / sent / not sent with Retry and Delete.

## UI

`apps/mobile/app/` (Expo Router): `NativeTabs` (Chats, Settings), a native `Stack` per tab with a drawn large title, `Stack.SearchBar` and `Stack.Toolbar` menus (iOS 26 Liquid Glass when built with Xcode 26), chat on `@legendapp/list` with `react-native-keyboard-controller`, Reanimated motion, haptics, and `@expo/ui` pickers and switches in Settings. The pairing screen is reused. The previous single-page shell remains reachable as **Classic view** for team, group, schedule and host settings, which have not been rebuilt yet.

The chat, home list, composer, markdown, motion, fonts, sounds and splash art come from OpenBot's phone app (`apps/mobile/src/openbot/`, licensed PolyForm Noncommercial 1.0.0, so a build that includes them is not freely usable commercially; see its README for the source commit and what changed). They run on HeroUI Native and Uniwind. Only the UI was taken: the connection layer, session, outbox and sync protocol are this repository's own.

## Live Activity (Dynamic Island)

`expo-widgets` Live Activity `BotActivity` shows what the Bots are doing: running (with the Bot, progress text, count), waiting for approval, done, or offline. State comes from the workspace work status (`summarizeWork`); `planActivity` drops identical updates and ends the activity with a *done* frame. Limits, stated plainly: ActivityKit starts an activity only while the app is in the foreground, and the app has no socket in the background, so updates stop when the app is suspended and the system renders the stale variant after about 3 minutes. Remote updates need an APNs service that does not exist yet (`enablePushNotifications` is off). Settings → Dynamic Island turns it off. Build variant `DS_BOT_NO_WIDGETS=1` omits the extension.

## Checks

`npm run check` runs typecheck, mobile tests (including outbox, hub, stream pool, live-activity planner), SDK tests, relay, bridge and companion checks. `npm --prefix bridge run test:integration` and the packed delivery checks are separate (`check:bridge`).
