import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { Conversation, MobileClient } from "@ds-bot/mobile-sdk";
import { Host, readCache, writeCache } from "../storage";
import { errorText, teamState, TeamState } from "../types";
const emptyTeam = (): TeamState => ({ bots: [], rooms: [], models: [] });
export function useWorkspace(client: MobileClient | null, host: Host | null) {
  const [team, setTeam] = useState<TeamState>(emptyTeam);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [transcription, setTranscription] = useState(false);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState("");
  const renderedClient = useRef(client);
  const scope = useRef({ client, serverId: host?.serverId });
  scope.current = { client, serverId: host?.serverId };
  const refreshing = useRef<MobileClient | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  // Polling usually returns identical data; keeping the same objects avoids re-rendering every screen.
  const snapshot = useRef({ team: "", conversations: "" });
  // Polls share one request. `fresh` (after creating something) waits out a
  // running poll and fetches again, so the result includes the new item.
  const refresh = useCallback(async (options?: { fresh?: boolean }) => {
    if (!client || !host) return;
    if (refreshing.current === client) {
      if (!options?.fresh) return;
      await inflight.current?.catch(() => {});
      if (refreshing.current === client) await inflight.current?.catch(() => {});
    }
    const current = () =>
      scope.current.client === client &&
      scope.current.serverId === host.serverId;
    refreshing.current = client;
    let done!: () => void;
    inflight.current = new Promise<void>(resolve => { done = resolve; });
    try {
      const [state, list, info] = await Promise.all([
        client.state(),
        client.conversations(),
        client.info(),
      ]);
      if (!current()) return;
      const parsed = teamState({ ...state, mobileCapabilities: info.capabilities && !Array.isArray(info.capabilities) ? info.capabilities : {} });
      setTranscription(
        !!(
          info.capabilities &&
          !Array.isArray(info.capabilities) &&
          info.capabilities.transcription
        ),
      );
      const teamText = JSON.stringify(parsed);
      const conversationsText = JSON.stringify(list.conversations);
      const teamChanged = teamText !== snapshot.current.team;
      const conversationsChanged = conversationsText !== snapshot.current.conversations;
      snapshot.current = { team: teamText, conversations: conversationsText };
      if (teamChanged) setTeam(parsed);
      if (conversationsChanged) setConversations(list.conversations);
      setOnline(true);
      setError("");
      await Promise.all([
        teamChanged ? writeCache(host.serverId, "team", parsed) : undefined,
        conversationsChanged ? writeCache(host.serverId, "conversations", list.conversations) : undefined,
      ]);
    } catch (err) {
      if (current()) {
        setOnline(false);
        setError(errorText(err));
      }
    } finally {
      if (refreshing.current === client) refreshing.current = null;
      done();
    }
  }, [client, host]);
  useEffect(() => {
    renderedClient.current = client;
    setTeam(emptyTeam());
    setConversations([]);
    snapshot.current = { team: "", conversations: "" };
    setOnline(false);
    setTranscription(false);
    setError("");
    if (!client || !host) return;
    let alive = true;
    void Promise.all([
      readCache<TeamState>(host.serverId, "team"),
      readCache<Conversation[]>(host.serverId, "conversations"),
    ])
      .then(([state, list]) => {
        // Foreground events/polling can finish discovery before SQLite reads.
        // Never replace that live snapshot with older cached data or grants.
        if (!alive || snapshot.current.team) return;
        // Cached summaries are useful offline, but only this connection's
        // successful discovery response can authorize optional operations.
        if (state) setTeam({ ...state, mobileCapabilities: {} });
        if (list) setConversations(list);
      })
      .catch((err) => {
        if (alive)
          setError(`Local cache could not be loaded: ${errorText(err)}`);
      })
      .finally(() => {
        if (alive) void refresh();
      });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 8000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      alive = false;
      clearInterval(timer);
      sub.remove();
    };
  }, [client, host, refresh]);
  // Effects run after render: do not expose the previous computer's capability
  // grants or connected state during the first render of a new client.
  if (renderedClient.current !== client)
    return { team: emptyTeam(), conversations: [], transcription: false, online: false, error: "", refresh };
  return { team, conversations, transcription, online, error, refresh };
}
