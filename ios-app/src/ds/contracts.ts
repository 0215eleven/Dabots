import type { Attachment, ConnectionStatus, Conversation, Message, MobileClient } from '@ds-bot/mobile-sdk';
import type { ConversationMessage } from '../../openbot/packages/contracts/src/ipc-conversation-messages';
import type { Bot, Model, Room, TeamState } from '../types.ts';
import type { Outbox, OutboxState } from '../outbox/outbox.ts';
/** A snapshot and its connection provenance are one value; caches never grant access. */
export interface DsSnapshot {
    serverId: string;
    client: MobileClient;
    team: TeamState;
    conversations: Conversation[];
    source: 'live' | 'cache';
    accessDenied?: boolean;
}
export interface DsCoreOptions {
    client: MobileClient;
    serverId: string;
    getSnapshot(): DsSnapshot | null;
    refresh(options: {
        fresh: true;
    }): Promise<DsSnapshot | undefined>;
    outbox: Outbox | null;
    isOnline(): boolean;
    /** Must reflect the SessionProvider's current connection, including same-server re-pairing. */
    isCurrent(): boolean;
}
export interface DsBotView extends Omit<Bot, 'id' | 'sessionId' | 'model' | 'effort'> {
    id: string;
    sourceId: string;
    serverId: string;
    conversationId: string | null;
    sessionId: string | null;
    modelRef: string | null;
    effortId: string | null;
}
export interface DsGroupView extends Omit<Room, 'id' | 'members' | 'admin'> {
    id: string;
    sourceId: string;
    serverId: string;
    conversationId: string | null;
    sessionId: string | null;
    members: string[];
    admin: string | null;
}
export interface DsConversationView {
    id: string;
    sourceId: string;
    serverId: string;
    sessionId: string;
    kind: 'bot' | 'group' | 'agent';
    name: string;
    ownerId: string | null;
    source: Conversation;
}
export interface DsWorkView {
    phase: 'idle' | 'working' | 'responding' | 'waiting';
    detail: string | null;
    members?: Array<{
        botId: string;
        phase: DsWorkView['phase'];
        detail: string | null;
    }>;
}
/** Shared OpenBot message contract, with lossless DS details for DS-aware cards. */
export interface DsMessage extends ConversationMessage {
    ds: {
        source: Message;
        conversationId: string;
        sessionId: string;
        reasoning?: string;
        tool?: Message['tool'];
        delivery?: Message['delivery'];
        author?: Message['author'];
        attachments?: Attachment[];
    };
}
export interface DsConversationSnapshot {
    established?: boolean;
    sessionId?: string;
    messages: DsMessage[];
    running: boolean;
    cursor?: string | null;
    eventSeq?: number;
}
export interface DsConversationListener {
    onSnapshot(snapshot: DsConversationSnapshot): void;
    onStatus?(status: ConnectionStatus): void;
    onError?(error: unknown): void;
}
export interface DsHistory {
    messages: DsMessage[];
    cursor: string | null;
    sessionId: string;
}
export interface DsModelOptions {
    model: Model;
    efforts: Array<{
        id: string;
        name: string;
        description?: string;
    }>;
    defaultEffort?: string;
}
export interface DsHostQueue {
    conversationId: string;
    sessionId: string;
    items: Array<{id: string; requestId?: string; target: 'next-turn' | 'next-step'; text: string}>;
}
export interface DsCapabilities {
    editDraft: boolean;
    actions: string[];
    send: boolean;
    history: boolean;
    stream: boolean;
    cancel: boolean;
    modelSelection: boolean;
    agents: boolean;
    providerConfiguration: false;
    accounts: false;
    unsupported: readonly string[];
}
export interface DsView {
    serverId: string;
    source: 'live' | 'cache';
    bots: DsBotView[];
    groups: DsGroupView[];
    conversations: DsConversationView[];
    agents: DsConversationView[];
    models: Model[];
    preferences: Record<string, unknown>;
    work: Record<string, DsWorkView>;
    capabilities: DsCapabilities;
    readOnly: string | null;
}
export type DsBotPatch = Partial<Pick<Bot, 'name' | 'role' | 'instructions'>> & {
    color?: string | null;
    avatar?: {
        shape?: string;
        image?: string;
    } | null;
    model?: string | null;
    effort?: string | null;
};
export type DsCreateBot = DsBotPatch & {
    name: string;
};
export interface DsGroupPatch {
    name?: string;
    notice?: string;
    mode?: 'admin' | 'everyone';
    members?: string[];
    admin?: string | null;
}
export interface DsCreateGroup {
    name?: string;
    members: string[];
    admin?: string;
    greet?: boolean;
}
export interface DsPreferences {
    theme?: string;
    accent?: string | null;
    motion?: 'quiet' | 'normal' | 'lively' | null;
}
export interface DsWriteResult<T> {
    status: 'confirmed' | 'unchanged';
    value: T;
    acknowledgement: unknown;
}
export interface DsSendState {
    persistence?: "unconfirmed";
    requestId: string;
    conversationId: string;
    state: Exclude<OutboxState, 'sent'> | 'accepted';
    text: string;
    attachments: Attachment[];
    error?: string;
}
export type DsErrorCode = 'INVALID_ID' | 'NOT_FOUND' | 'STALE_HOST' | 'STALE_SNAPSHOT' | 'OFFLINE' | 'READ_ONLY' | 'UNSUPPORTED' | 'INVALID_MODEL' | 'INVALID_EFFORT' | 'INVALID_INPUT' | 'READBACK_FAILED' | 'MUTATION_UNCONFIRMED';
export class DsCoreError extends Error {
    readonly code: DsErrorCode;
    readonly acknowledgement?: unknown;
    readonly mutation?: 'acknowledged' | 'unknown';
    constructor(code: DsErrorCode, message: string, details?: {
        acknowledgement?: unknown;
        mutation?: 'acknowledged' | 'unknown';
        cause?: unknown;
    }) {
        super(message, { cause: details?.cause });
        this.name = 'DsCoreError';
        this.code = code;
        this.acknowledgement = details?.acknowledgement;
        this.mutation = details?.mutation;
    }
}

/** Platform-neutral surface consumed by the upstream React workspace binding. */
export interface DsCore {
  read(): DsView;
  capabilities(): DsCapabilities;
  refresh(): Promise<DsSnapshot>;
  modelOptions(ref: string): Promise<DsModelOptions>;
  updateBot(id: string, input: DsBotPatch): Promise<DsWriteResult<DsBotView>>;
  createBot(input: DsCreateBot): Promise<DsWriteResult<DsBotView>>;
  deleteBot(id: string): Promise<DsWriteResult<{ id: string; deleted: true }>>;
  duplicateBot(id: string): Promise<DsWriteResult<DsBotView>>;
  setMainBot(id: string, input: { main?: boolean; primary?: boolean; replace?: string }): Promise<DsWriteResult<{ mainBotId: string | null; mainBotIds: string[] }>>;
  createGroup(input: DsCreateGroup): Promise<DsWriteResult<DsGroupView>>;
  updateGroup(id: string, input: DsGroupPatch): Promise<DsWriteResult<DsGroupView>>;
  deleteGroup(id: string): Promise<DsWriteResult<{ id: string; deleted: true }>>;
  setFlags(id: string, input: { pinned?: boolean; hidden?: boolean }): Promise<DsWriteResult<Conversation>>;
  setPreferences(input: DsPreferences): Promise<DsWriteResult<Record<string, unknown>>>;
  history(id: string, options?: { cursor?: string | null; limit?: number }): Promise<DsHistory>;
  cachedHistory(id: string): Promise<DsMessage[]>;
  send(id: string, input: { text: string; attachments?: Attachment[] }): Promise<DsSendState | null>;
  queue(id: string, signal?: AbortSignal): Promise<DsHostQueue>;
  pending(id: string): DsSendState[];
  retrySend(requestId: string): Promise<void>;
  discardSend(requestId: string): Promise<void>;
  cancel(id: string): Promise<Record<string, unknown>>;
  groupProgress(id: string): Promise<import('../logic/group-work.ts').GroupRound[]>;
  stopGroupMember(groupId: string, botId: string): Promise<DsWriteResult<DsWorkView>>;
  watchConversation(id: string, listener: DsConversationListener): () => void;
  subscribe(listener: () => void): () => void;
  unsupported(feature: string): never;
  dispose(): void;
}
