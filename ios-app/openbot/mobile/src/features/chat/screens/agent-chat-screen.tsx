import { useLocalSearchParams } from 'expo-router';
import { ChatView } from '@/features/chat/components/chat-view';
import { useDs } from '@ds/provider';
import { Unavailable } from '@ds/routes';
export function AgentChatScreen() {
    const { agentId } = useLocalSearchParams<{
        agentId: string;
    }>();
    const { view } = useDs();
    const bot = view?.bots.find(b => b.id === agentId);
    return bot?.conversationId ? <ChatView key={bot.conversationId} conversationId={bot.conversationId} ownerId={bot.id}/> : <Unavailable />;
}
