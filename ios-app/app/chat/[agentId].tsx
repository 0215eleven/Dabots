import { Redirect, useLocalSearchParams } from 'expo-router';
import { AgentChatScreen } from '@/features/chat/screens/agent-chat-screen';
import { useDs } from '../../src/ds/provider';
import { resolveScreenRoute } from '../../src/ds/screen-binding';
import { Unavailable } from '../../src/ds/routes';
export default function Chat() { const { agentId } = useLocalSearchParams<{
    agentId: string;
}>(); const { view } = useDs(); if (!view)
    return <Unavailable />; const route = resolveScreenRoute(view, 'chat', agentId); if (route.kind === 'group')
    return <Redirect href={{ pathname: '/channel/[channelId]', params: { channelId: route.id!, serverId: view.serverId } }}/>; if (route.kind === 'bot') {
    if (agentId !== route.id)
        return <Redirect href={{ pathname: '/chat/[agentId]', params: { agentId: route.id! } }}/>;
    return <AgentChatScreen />;
} if (route.kind === 'agent')
    return <Redirect href={{ pathname: '/legacy-agent/[id]', params: { id: route.id! } }}/>; return <Unavailable />; }
