import type { MobileClient } from '@ds-bot/mobile-sdk';
import { teamState } from '../types.ts';
import { DsCoreError, type DsSnapshot } from './contracts.ts';
export interface DsWorkspaceCoordinatorOptions {
    client: MobileClient;
    serverId: string;
    isCurrent(): boolean;
    publish(snapshot: DsSnapshot): void;
}
/** Sequencing only: SessionProvider/useWorkspace still own foreground polling and recovery. */
export function createDsWorkspaceCoordinator(options: DsWorkspaceCoordinatorOptions) {
    let pending: Promise<DsSnapshot | undefined> | undefined;
    let sequence = 0;
    async function refresh(input?: {
        fresh?: boolean;
    }): Promise<DsSnapshot | undefined> {
        if (!options.isCurrent())
            return;
        if (pending) {
            if (!input?.fresh)
                return pending;
            await pending.catch(() => { });
            if (!options.isCurrent())
                return;
        }
        const ticket = ++sequence;
        const request = (async () => {
            const [state, list, info] = await Promise.all([options.client.state(), options.client.conversations(), options.client.info()]);
            if (!options.isCurrent() || ticket !== sequence)
                return;
            if (info.serverId !== options.serverId)
                throw new DsCoreError('STALE_HOST', 'The discovery response belongs to another computer.');
            const snapshot: DsSnapshot = { serverId: options.serverId, client: options.client, source: 'live', conversations: list.conversations,
                team: teamState({ ...state, mobileCapabilities: info.capabilities && !Array.isArray(info.capabilities) ? info.capabilities : {} }) };
            options.publish(snapshot);
            return snapshot;
        })().catch(error => {
            if (!options.isCurrent() || ticket !== sequence)
                return undefined;
            throw error;
        });
        pending = request;
        try {
            return await request;
        }
        finally {
            if (pending === request)
                pending = undefined;
        }
    }
    return { refresh };
}
