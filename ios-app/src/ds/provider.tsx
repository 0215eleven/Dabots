import { botAvatarHue, botAvatarColor, fallbackAvatarColor } from './presentation';
import { usePreviews } from '../home/usePreviews';
import { useComputerNames } from '../names/ComputerNamesProvider';
import { conversationTimestamp } from '../logic/conversation-order';
import { formatUpdatedAt } from '@/shared/lib/format-updated-at';
import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { Uniwind } from 'uniwind';
import { WorkspaceContexts } from '@/features/workspace/context/workspace-store';
import type { MobileAgent, MobileServer, MobileWorkspaceContextValue } from '@/features/workspace/model/workspace-types';
import { MobileConversationStore } from '@/features/workspace/model/conversation-store';
import { LiveWorkspaceStore } from '@/features/workspace/model/live-workspace-store';
import { MobileChannelStore } from '@/features/channels/model/channel-store';
import { AgentPinTransitionProvider } from '@/features/agents/components/agent-pin-transition';
import { useAppLanguage } from '@/features/settings/model/app-language';
import { useMotionPreferences } from '@/features/settings/model/motion';
import { useAppearance } from '@/features/settings/model/appearance';
import { useSession } from '../session/SessionProvider';
import { useTheme, useColorMode } from '../theme';
import { useI18n } from '../i18n';
import { guardManagement } from './management';
import { bindSessionCore } from './session-binding';
import type { DsCore, DsView } from './contracts';
import { createScreenCommands, mutationProblem } from './screen-binding';
import { dsId } from './identity';
import { unavailableWorkspace, unsupported } from './unavailable-workspace';
import type { ChannelSummary } from '@openbot/contracts/ipc';
interface Binding {
    core: DsCore | null;
    management: ReturnType<typeof guardManagement> | null;
    view: DsView | null;
    online: boolean;
    agents: MobileAgent[];
    commands: ReturnType<typeof createScreenCommands> | null;
}
const Context = createContext<Binding>({ management: null, core: null, view: null, online: false, agents: [], commands: null });
export const useDs = () => useContext(Context);
export function DsProvider({ children }: {
    children: React.ReactNode;
}) {
    const session = useSession();
    const names = useComputerNames();
    const t = useTheme(), mode = useColorMode(), { locale, tr } = useI18n();
    const latest = useRef(session);
    latest.current = session;
    const client = session.client, serverId = session.host?.serverId, outbox = session.outbox;
    const binding = useMemo(() => { const raw = bindSessionCore(session, () => latest.current); return raw && client ? guardManagement(raw, JSON.stringify([serverId, session.host?.slot ?? ''])) : null; }, [client, serverId, session.host?.slot, outbox]);
    const core = binding?.core ?? null;
    useEffect(() => () => core?.dispose(), [core]);
    const hasSnapshot = Boolean(session.workspace.getSnapshot());
    const [, notify] = useState(0);
    useEffect(() => binding?.subscribe(() => notify(n => n + 1)), [binding]);
    useEffect(() => hasSnapshot ? core?.subscribe(() => notify(n => n + 1)) : undefined, [core, hasSnapshot]);
    const view = core && session.workspace.getSnapshot() ? core.read() : null;
    const stores = useMemo(() => ({ conversationStore: new MobileConversationStore(flush => { const id = requestAnimationFrame(flush); return () => cancelAnimationFrame(id); }), liveState: new LiveWorkspaceStore(), channelStore: new MobileChannelStore(async () => unsupported('Remote channel protocol')) }), [core]);
    useEffect(() => () => { stores.conversationStore.dispose(); stores.channelStore.dispose(); }, [stores]);
    // Read summaries through the same owner and grant boundary as the chat page.
    const historyAllowed = Boolean(view?.capabilities.history && !session.workspace.getSnapshot()?.accessDenied);
    const previewAccess = useMemo(() => ({ owner: core, allowed: historyAllowed, read: async (id: string) => {
        if (!core || !serverId || latest.current.workspace.getSnapshot()?.accessDenied) return [];
        const page = await core.history(dsId(serverId, 'conversation', id), { limit: 6 });
        if (latest.current.workspace.getSnapshot()?.accessDenied) return [];
        return page.messages.map(message => message.ds.source);
    } }), [core, serverId, historyAllowed]);
    const previews = usePreviews(session.workspace.conversations, previewAccess);
    const lastOf = (conversationId: string | null | undefined) => {
        if (!historyAllowed) return { text: '', at: null };
        const source = view?.conversations.find(c => c.id === conversationId)?.source;
        const message = source ? previews[source.id] : undefined;
        const text = message?.text?.trim() || '';
        const at = Math.max(conversationTimestamp(source?.updatedAt), conversationTimestamp(message?.createdAt));
        return { text, at: at ? new Date(at).toISOString() : null };
    };
    const agents = useMemo<MobileAgent[]>(() => view?.bots.map(bot => { const last = lastOf(bot.conversationId); return { id: bot.id, serverId: bot.serverId, name: bot.name, title: bot.role ?? '', description: bot.instructions ?? '', preview: last.text, updatedLabel: formatUpdatedAt(last.at), avatarSeed: bot.avatar?.shape ?? bot.sourceId, avatarHue: botAvatarHue(bot), avatarColor: botAvatarColor(bot, t.dark) ?? fallbackAvatarColor(bot.sourceId, t.dark), avatarUrl: bot.avatar?.image ?? null }; }) ?? [], [session.workspace.team, session.workspace.conversations, core, t.dark, previews, previewAccess]);
    const channels = useMemo<ChannelSummary[]>(() => view?.groups.map(group => ({ id: group.id, name: group.name, title: '', instructions: group.notice ?? '', members: group.members.map(agentId => ({ agentId })), leadAgentId: group.admin, archived: false, revision: 0, createdAt: '', unreadCount: 0, activeTasks: view.work[group.id]?.phase === 'working' ? 1 : 0, lastMessage: (() => { const last = lastOf(group.conversationId); return last.text && last.at ? { authorName: '', text: last.text, at: last.at } : null; })() })) ?? [], [session.workspace.team, session.workspace.conversations, core, previews, previewAccess]);
    useLayoutEffect(() => {
        if (!view)
            return;
        stores.channelStore.applyDsSnapshot(view.serverId, channels, view.capabilities.actions.includes('create-room'));
        stores.liveState.update('activityByServer', () => ({ [view.serverId]: Object.fromEntries(Object.entries(view.work).filter(([, w]) => w.phase !== 'idle').map(([id, w]) => [id, { agentId: id, turnId: null, phase: w.phase === 'idle' ? 'working' : w.phase, detail: w.detail }])) }));
    }, [stores, session.workspace.team, session.workspace.conversations, session.workspace.online, channels]);
    const host: MobileServer = { id: serverId ?? 'unavailable', name: names.name(session.host), logoKey: null, kind: 'local', state: session.workspace.online ? 'online' : 'offline', initialConnectionPending: session.loading,
        // Until the first answer (or failure) arrives the computer is connecting quietly, not offline, so avatars and
        // bubbles do not open grey and fade in.
        resuming: !session.workspace.online && !session.workspace.error, connectionMessage: session.error || null, address: null, accent: '', publicKey: '', membershipId: '', role: 'member' };
    const fail = (error: unknown) => Alert.alert('DeepSeek Bot Pro', tr(mutationProblem(error).message));
    const flag = async (id: string, patch: {
        pinned?: boolean;
        hidden?: boolean;
    }) => { const target = view?.bots.find(b => b.id === id) ?? view?.groups.find(g => g.id === id); if (!target?.conversationId || !core)
        return unsupported('Conversation flags'); return (await core.setFlags(target.conversationId, patch)).value; };
    const value: MobileWorkspaceContextValue = { ...unavailableWorkspace, ...stores,
        get teamDirectory() { return unsupported('Remote account directory'); },
        sidebarByServer: {}, servers: session.host ? [host] : [], memberCountByServer: {}, serverDirectoryState: session.loading ? 'loading' : 'ready', serverDirectoryError: session.error || null,
        agents, activeAgents: agents.filter(a => !view?.bots.find(b => b.id === a.id)?.hidden), hiddenAgents: agents.filter(a => view?.bots.find(b => b.id === a.id)?.hidden), activeServer: host,
        pinnedAgentIds: view?.bots.filter(b => b.pinned).map(b => b.id) ?? [], pinnedChannelIds: view?.groups.filter(g => g.pinned).map(g => g.id) ?? [], hiddenChannelIds: view?.groups.filter(g => g.hidden).map(g => g.id) ?? [], pinnedWorkflowIds: {},
        browserViewSupport: () => ({ view: false, clipboard: false, contextMenu: false, viewport: false, navigation: false }),
        refreshServer: async () => { await core?.refresh(); }, refreshServers: async () => { await core?.refresh(); },
        deleteAgent: async (id) => { if (!core)
            return unsupported('delete'); await core.deleteBot(id); }, duplicateAgent: async (id) => { if (!core)
            return unsupported('duplicate'); await core.duplicateBot(id); },
        toggleAgentPin: async (id) => { try {
            const result = await flag(id, { pinned: !view?.bots.find(b => b.id === id)?.pinned });
            return result.pinned ? 'pinned' : 'unpinned';
        }
        catch (error) {
            fail(error);
            return 'error';
        } },
        toggleChannelPin: async (id) => { try {
            const result = await flag(id, { pinned: !view?.groups.find(g => g.id === id)?.pinned });
            return result.pinned ? 'pinned' : 'unpinned';
        }
        catch (error) {
            fail(error);
            return 'error';
        } },
        hideAgent: id => { void flag(id, { hidden: true }).catch(fail); }, unhideAgent: id => { void flag(id, { hidden: false }).catch(fail); },
        canUnhideAgent: () => Boolean(view?.capabilities.actions.includes('set-flags')), hidesAgentsOnServer: () => true,
        hideChannel: id => { void flag(id, { hidden: true }).catch(fail); return false; }, unhideChannel: id => { void flag(id, { hidden: false }).catch(fail); return false; },
    };
    const commands = useMemo(() => core && serverId ? createScreenCommands(core, serverId) : null, [core, serverId]);
    useEffect(() => { useAppLanguage.setState({ value: locale === 'zh' ? 'zh' : 'en', ready: true }); }, [locale]);
    useEffect(() => { Uniwind.setTheme(mode); useAppearance.setState({ value: mode, ready: true }); useMotionPreferences.setState({ allAnimations: t.motion !== 'quiet', ready: true }); Uniwind.updateCSSVariables(t.dark ? 'dark' : 'light', { '--background': t.bg, '--foreground': t.ink, '--accent': t.accent, '--accent-foreground': t.accentText, '--openbot-accent': t.accent, '--openbot-text-on-accent': t.accentText, '--openbot-bg-canvas': t.bg, '--openbot-bg-native-canvas': t.bg, '--openbot-bg-native-sidebar': t.sidebar, '--openbot-bg-sheet': t.sheet, '--openbot-bg-control': t.bubble, '--openbot-bg-surface': t.surface, '--openbot-text-primary': t.ink }); }, [mode, t.dark, t.accent, t.accentText, t.bg, t.ink, t.motion, t.sidebar, t.sheet, t.bubble, t.surface]);
    return <Context.Provider value={{ management: binding, core, view, online: session.workspace.online, agents, commands }}><WorkspaceContexts value={value} actions={value}><AgentPinTransitionProvider>{children}</AgentPinTransitionProvider></WorkspaceContexts></Context.Provider>;
}
