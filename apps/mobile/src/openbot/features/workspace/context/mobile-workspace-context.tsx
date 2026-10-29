// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
import { useSession } from "../../../../session/SessionProvider";
import { agentFor } from "../../../adapters/chat-model";
import type { MobileAgent } from "../model/workspace-types";

export type { MobileAgent } from "../model/workspace-types";

/** The server the phone is paired with, as the OpenBot components read it. */
export interface MobileServer {
  id: string;
  name: string;
  online: boolean;
}
interface WorkspaceSnapshot {
  agents: MobileAgent[];
  servers: MobileServer[];
  activeServer: MobileServer;
  connectionState: "connected" | "offline";
  browserViewSupport(serverId: string): { view: boolean; clipboard: boolean; contextMenu: boolean };
}
const NO_BROWSER = () => ({ view: false, clipboard: false, contextMenu: false });

/** The OpenBot screens read their server state through this selector; DS Bot's session supplies it. */
export function useMobileWorkspaceSelector<T>(select: (current: WorkspaceSnapshot) => T): T {
  const { host, workspace } = useSession();
  const server: MobileServer = { id: host?.serverId ?? "", name: host?.name ?? "", online: workspace.online };
  return select({
    agents: workspace.team.bots.map((bot) => agentFor(bot, server.id)),
    servers: host ? [server] : [],
    activeServer: server,
    connectionState: workspace.online ? "connected" : "offline",
    browserViewSupport: NO_BROWSER,
  });
}
