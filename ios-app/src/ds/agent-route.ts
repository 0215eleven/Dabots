import type { DsConversationView } from './contracts.ts';

// Decodes until stable: the router may encode the parameter once more, or decode it fully.
const decoded = (value: string) => {
    for (let round = 0; round < 3; round++) {
        let next: string;
        try { next = decodeURIComponent(value); } catch { return value; }
        if (next === value) return value;
        value = next;
    }
    return value;
};

/**
 * The granted Agent conversation a route names. An Agent ID holds colons (`agent:<agent>:<session>`),
 * which the DS ID percent-encodes; the router may hand the parameter back decoded, so both forms match.
 */
export function findAgentConversation(agents: readonly DsConversationView[] | undefined, id: string | undefined): DsConversationView | undefined {
    if (!agents || !id) return undefined;
    return agents.find(agent => agent.id === id || decoded(agent.id) === decoded(id) || agent.sourceId === id);
}
