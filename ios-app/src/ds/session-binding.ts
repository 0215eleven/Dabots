import type { MobileClient } from '@ds-bot/mobile-sdk';
import type { Outbox } from '../outbox/outbox.ts';
import type { DsSnapshot } from './contracts.ts';
import { createDsCore } from './core.ts';
export interface DsSessionSource {
    client: MobileClient | null;
    host: {
        serverId: string;
    } | null;
    outbox: Outbox | null;
    workspace: {
        getSnapshot(): DsSnapshot | null;
        refreshSnapshot(options: {
            fresh: true;
        }): Promise<DsSnapshot | undefined>;
        online: boolean;
    };
}
/** Called by the real React provider, with refs updated on every SessionProvider render. */
export function bindSessionCore(owner: DsSessionSource, read: () => DsSessionSource) {
    const { client, host, outbox } = owner;
    if (!client || !host)
        return null;
    const serverId = host.serverId;
    return createDsCore({ client, serverId, outbox, getSnapshot: () => read().workspace.getSnapshot(), refresh: options => read().workspace.refreshSnapshot(options), isOnline: () => read().workspace.online, isCurrent: () => read().client === client && read().host?.serverId === serverId && read().outbox === outbox });
}
