import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useDs } from './provider';
import { createChatBinding } from './chat-controller';
export function useDsChat(conversationId: string) {
    const { core, view, online } = useDs();
    const binding = useMemo(() => core ? createChatBinding(core, conversationId) : null, [core, conversationId, online]);
    if (!binding)
        throw Error('Conversation requires the selected DS session.');
    const state = useSyncExternalStore(binding.subscribe, binding.get, binding.get);
    useEffect(() => { binding.start(); return () => binding.dispose(); }, [binding]);
    return { ...state, core, view, online, setError: binding.setError, load: binding.load, pending: core?.pending(conversationId) ?? [] };
}
