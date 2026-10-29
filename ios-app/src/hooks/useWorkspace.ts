import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { Conversation, MobileClient } from "@ds-bot/mobile-sdk";
import { Host, readCache, writeCache } from "../storage";
import { errorText, TeamState } from "../types";
import { createDsWorkspaceCoordinator } from "../ds/workspace.ts";
import type { DsSnapshot } from "../ds/contracts.ts";
const emptyTeam = (): TeamState => ({ bots: [], rooms: [], models: [] });
export function useWorkspace(client: MobileClient | null, host: Host | null) {
    const [team, setTeam] = useState<TeamState>(emptyTeam);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [transcription, setTranscription] = useState(false);
    const [online, setOnline] = useState(false);
    const [error, setError] = useState("");
    const renderedClient = useRef(client);
    const renderedServer = useRef(host?.serverId);
    const scope = useRef({ client, serverId: host?.serverId });
    scope.current = { client, serverId: host?.serverId };
    const canonical = useRef<DsSnapshot | null>(null);
    // Polling usually returns identical data; retain the same React objects.
    const snapshot = useRef({ team: "", conversations: "" });
    const coordinator = useRef<{
        client: MobileClient;
        serverId: string;
        value: ReturnType<typeof createDsWorkspaceCoordinator>;
    } | null>(null);
    if (client && host && (coordinator.current?.client !== client || coordinator.current.serverId !== host.serverId)) {
        const current = () => scope.current.client === client && scope.current.serverId === host.serverId;
        coordinator.current = { client, serverId: host.serverId, value: createDsWorkspaceCoordinator({
                client, serverId: host.serverId, isCurrent: current,
                publish(value) {
                    canonical.current = value;
                    const parsed = value.team;
                    setTranscription(parsed.mobileCapabilities?.transcription === true);
                    const teamText = JSON.stringify(parsed), conversationsText = JSON.stringify(value.conversations);
                    const teamChanged = teamText !== snapshot.current.team;
                    const conversationsChanged = conversationsText !== snapshot.current.conversations;
                    snapshot.current = { team: teamText, conversations: conversationsText };
                    if (teamChanged)
                        setTeam(parsed);
                    if (conversationsChanged)
                        setConversations(value.conversations);
                    setOnline(true);
                    setError("");
                    // Cache failure does not turn a successful host read into an offline host.
                    void Promise.all([
                        teamChanged ? writeCache(host.serverId, "team", parsed) : undefined,
                        conversationsChanged ? writeCache(host.serverId, "conversations", value.conversations) : undefined,
                    ]).catch(err => { if (current())
                        setError(`Local cache could not be saved: ${errorText(err)}`); });
                },
            }) };
    }
    const owned = client && host && coordinator.current?.client === client && coordinator.current.serverId === host.serverId ? coordinator.current.value : null;
    const refreshSnapshot = useCallback(async (options?: {
        fresh?: boolean;
    }): Promise<DsSnapshot | undefined> => {
        if (!owned || scope.current.client !== client || scope.current.serverId !== host?.serverId)
            return;
        try {
            return await owned.refresh(options);
        }
        catch (err) {
            if (scope.current.client === client && scope.current.serverId === host?.serverId) {
                if (err && typeof err === 'object' && 'status' in err && [401, 403].includes(Number(err.status)) && canonical.current?.client === client) canonical.current = {...canonical.current, accessDenied: true};
                setOnline(false);
                setError(errorText(err));
            }
            // Existing callers use fire-and-forget refresh. A missing canonical return
            // explicitly tells commands that acknowledgement has not reached readback.
            return undefined;
        }
    }, [client, host?.serverId, owned]);
    // Preserve the original Promise<void> interface used by existing screens.
    const refresh = useCallback(async (options?: {
        fresh?: boolean;
    }): Promise<void> => {
        await refreshSnapshot(options);
    }, [refreshSnapshot]);
    const getSnapshot = useCallback((): DsSnapshot | null => {
        const value = canonical.current;
        return value && value.client === scope.current.client && value.serverId === scope.current.serverId ? value : null;
    }, []);
    useEffect(() => {
        renderedClient.current = client;
        renderedServer.current = host?.serverId;
        setTeam(emptyTeam());
        setConversations([]);
        snapshot.current = { team: "", conversations: "" };
        canonical.current = null;
        setOnline(false);
        setTranscription(false);
        setError("");
        if (!client || !host)
            return;
        let alive = true;
        void Promise.all([
            readCache<TeamState>(host.serverId, "team"),
            readCache<Conversation[]>(host.serverId, "conversations"),
        ])
            .then(([state, list]) => {
            if (!alive || snapshot.current.team)
                return;
            const cached = { ...(state ?? emptyTeam()), mobileCapabilities: {}, agentAccess: false };
            canonical.current = { client, serverId: host.serverId, source: 'cache', team: cached, conversations: list ?? [] };
            if (state)
                setTeam(cached);
            if (list)
                setConversations(list);
        })
            .catch(err => { if (alive)
            setError(`Local cache could not be loaded: ${errorText(err)}`); })
            .finally(() => { if (alive)
            void refresh(); });
        const timer = setInterval(() => {
            if (AppState.currentState === "active")
                void refresh();
        }, 8000);
        const sub = AppState.addEventListener("change", state => { if (state === "active")
            void refresh(); });
        return () => { alive = false; clearInterval(timer); sub.remove(); };
    }, [client, host?.serverId, refresh]);
    if (renderedClient.current !== client || renderedServer.current !== host?.serverId)
        return { team: emptyTeam(), conversations: [], transcription: false, online: false, error: "", refresh, refreshSnapshot, getSnapshot };
    return { team, conversations, transcription, online, error, refresh, refreshSnapshot, getSnapshot };
}
