export type DsKind = 'bot' | 'group' | 'agent' | 'conversation' | 'session' | 'message';
export interface DsIdentity {
    serverId: string;
    kind: DsKind;
    sourceId: string;
}
const kinds: readonly string[] = ['bot', 'group', 'agent', 'conversation', 'session', 'message'];
/** UI identity only. Never send this ID to DSH or change persisted DS storage keys. */
export function dsId(serverId: string, kind: DsKind, sourceId: string): string {
    if (!serverId || !sourceId || !kinds.includes(kind))
        throw new Error('Invalid DS identity.');
    return `ds:${encodeURIComponent(serverId)}:${kind}:${encodeURIComponent(sourceId)}`;
}
export function parseDsId(id: string): DsIdentity {
    const parts = id.split(':');
    if (parts.length !== 4 || parts[0] !== 'ds' || !kinds.includes(parts[2]))
        throw new Error('Invalid DS identity.');
    const result = { serverId: decodeURIComponent(parts[1]), kind: parts[2] as DsKind, sourceId: decodeURIComponent(parts[3]) };
    if (dsId(result.serverId, result.kind, result.sourceId) !== id)
        throw new Error('Noncanonical DS identity.');
    return result;
}
