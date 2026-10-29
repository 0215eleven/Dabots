import { useLocalSearchParams } from 'expo-router';
import { ChatView } from '@/features/chat/components/chat-view';
import { useDs } from '@ds/provider';
import { Unavailable } from '@ds/routes';
export function ChannelChatScreen() {
    const { channelId } = useLocalSearchParams<{
        channelId: string;
    }>();
    const { view } = useDs();
    const group = view?.groups.find(g => g.id === channelId);
    return group?.conversationId ? <ChatView key={group.conversationId} conversationId={group.conversationId} ownerId={group.id}/> : <Unavailable />;
}
