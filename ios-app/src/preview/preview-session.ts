// Development-only offline data for the DS 2.0 screens (EXPO_PUBLIC_DS_BOT_DESIGN_PREVIEW=1).
// No host, credentials or real conversations; used for layout review and screenshots.
import type { Conversation, Message, MobileClient, MobileEvent } from "@ds-bot/mobile-sdk";
import { enableFixture } from "./enabled-fixture";
import type { Host } from "../storage";

export const designPreview = __DEV__ && process.env.EXPO_PUBLIC_DS_BOT_DESIGN_PREVIEW === "1";

const now = Date.now();
const bots = [
  { id: "preview-chief", name: "MyBot", role: "统筹全局", sessionId: "s-chief", pinned: true },
  { id: "preview-research", name: "研究助手", role: "整理资料与证据", sessionId: "s-research" },
  { id: "preview-design", name: "设计搭档", role: "配色与版式", sessionId: "s-design" },
  { id: "preview-writing", name: "写作伙伴", role: "润色文字", sessionId: "s-writing" },
];
const room = { id: "preview-room", name: "创作小组", members: ["preview-research", "preview-design", "preview-writing"] };
const conversations: Conversation[] = [
  ...bots.map((bot, index) => ({ id: bot.id, kind: "bot", name: bot.name, role: bot.role, sessionId: bot.sessionId, updatedAt: now - index * 37 * 60_000 })),
  { id: room.id, kind: "room", name: room.name, sessionId: "s-room", updatedAt: now - 3 * 3_600_000 },
  { id: "agent:preview", kind: "agent", name: "DSH Agent", sessionId: "s-agent", updatedAt: now - 5 * 60_000 },
];
const message = (seq: number, role: string, text: string, minutes: number, author?: (typeof bots)[number]): Message => ({
  id: `m-${seq}`, sessionId: "s", seq, role, text, createdAt: now - minutes * 60_000,
  ...(author ? { author: { id: author.id, name: author.name } } : {}),
});
const transcripts: Record<string, Message[]> = {
  "preview-chief": [
    message(1, "user", "帮我把今天的想法整理成一个小计划。", 20),
    message(2, "assistant", "可以，我们先从最重要的事情开始。\n\n**今天只做三件事：**\n\n1. 整理手头的资料，留下关键证据。\n2. 选一个最小可验证的想法。\n3. 留半小时复盘，写下下一步。\n\n```ts\nconst today = [\"整理\", \"验证\", \"复盘\"];\n```\n\n不用一次做完所有事。先把第一步走稳。", 19),
    message(3, "user", "好，先从整理资料开始。", 2),
    message(4, "assistant", "我会陪你一起。把最想弄清楚的问题发给我吧。", 1),
  ],
  "agent:preview": [message(1, "user", "检查一下项目里还有哪些测试没过。", 6), message(2, "assistant", "我跑了一遍：**全部通过**，没有失败的测试。", 5)],
  "preview-room": [
    message(1, "user", "我们把下一版的方向定下来吧。", 200),
    message(2, "assistant", "我先整理用户反馈，找出最需要解决的两个问题。", 199, bots[1]),
    message(3, "assistant", "界面保持安静一点。让角色和内容成为主角。", 198, bots[2]),
    message(4, "assistant", "那我来把说明写得更清楚，第一次用也能明白。", 197, bots[3]),
    message(5, "user", "就按这个方向走。", 190),
    message(6, "assistant", "收到，我们把想法变成一个可以试用的版本。", 189, bots[1]),
  ],
};
for (const [index, bot] of bots.slice(1).entries())
  transcripts[bot.id] = [message(1, "assistant", ["把关键证据留在正文，其余放进附录。", "新配色已经准备好了，来看看？", "这段开头还可以再轻一点。"][index], 40 + index * 30)];

export const previewHosts: Host[] = [
  { url: "https://my-mac.local:7443", serverId: "preview", name: "My Mac", slot: "a" },
  { url: "https://studio.local:7443", serverId: "studio", name: "Studio PC", slot: "b" },
];

export function previewClient(serverId = "preview"): MobileClient {
  const state = {
    bots, rooms: [room], models: [], agentAccess: true, mainBotIds: ["preview-chief"], prefs: {},
    work: { bots: { "preview-design": { said: "正在调整首页的配色", since: now - 90_000 } }, approvals: [] },
  };
  const client = {
    info: async () => ({ serverId: "preview", capabilities: { history: true, stream: true, send: true, groups: true, "agent-open": true } }),
    state: async () => state,
    conversations: async () => ({ conversations }),
    messages: async (id: string) => ({ messages: transcripts[id] ?? [], cursor: null, sessionId: "s" }),
    settings: async () => ({ writable: false, hasDocument: false, namespaces: [] }),
    target: async (id: string) => ({ sessionId: `s-${id}` }),
    submission: async () => { throw Object.assign(new Error("This send was already resolved. Reopen this conversation."), { status: 404 }); },
    submit: async (payload: { requestId: string }) => ({ requestId: payload.requestId, status: "accepted" }),
    rememberAcceptedSubmission: async () => {},
    action: async () => ({}),
    logout: async () => {},
    dispose() {},
    getCachedMessages: async () => [],
    connect({ conversationId, onEvent, onStatus }: { conversationId: string; onEvent(event: MobileEvent): void; onStatus?(status: string): void }) {
      const timer = setTimeout(() => {
        onStatus?.("connected");
        onEvent({ type: "ready", conversationId, protocol: 2, heartbeatMs: 15000 });
        onEvent({ type: "reset", conversationId, eventSeq: 1, messages: transcripts[conversationId] ?? [], busy: conversationId === "preview-design" });
      }, 50);
      onStatus?.("connecting");
      return { close() { clearTimeout(timer); }, reconnectNow() {}, cursor: 1 };
    },
  };
  return enableFixture(client as unknown as MobileClient, state, conversations, serverId);
}
