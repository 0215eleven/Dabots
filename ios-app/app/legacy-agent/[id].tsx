import { Stack, useLocalSearchParams } from 'expo-router';
import { useSession } from '../../src/session/SessionProvider';
import { useDs } from '../../src/ds/provider';
import { findAgentConversation } from '../../src/ds/agent-route';
import { Unavailable } from '../../src/ds/routes';
import { OpenBotChat } from '../../src/openbot/chat-screen';
export default function LegacyAgent() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const { view } = useDs();
    const { workspace } = useSession();
    const granted = findAgentConversation(view?.agents, id);
    const conversation = granted && workspace.conversations.find(c => c.id === granted.sourceId && c.kind === 'agent');
    return conversation
        ? <><Stack.Screen options={{ title: conversation.name || 'DSH Agent' }} /><OpenBotChat key={granted.id} conversation={conversation} /></>
        : <Unavailable />;
}
