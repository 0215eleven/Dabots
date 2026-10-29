import { useLocalSearchParams } from 'expo-router';
import { useSession } from '../../src/session/SessionProvider';
import { useDs } from '../../src/ds/provider';
import { Unavailable } from '../../src/ds/routes';
import { OpenBotChat } from '../../src/openbot/chat-screen';
export default function LegacyAgent() { const { id } = useLocalSearchParams<{
    id: string;
}>(); const { view } = useDs(); const { workspace } = useSession(); const granted = view?.agents.find(a => a.id === id); const conversation = granted && workspace.conversations.find(c => c.id === granted.sourceId && c.kind === 'agent'); return conversation ? <OpenBotChat key={id} conversation={conversation}/> : <Unavailable />; }
