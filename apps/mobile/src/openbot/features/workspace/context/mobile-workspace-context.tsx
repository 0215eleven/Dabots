// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
export type { MobileAgent } from "../model/workspace-types";

interface WorkspaceSnapshot {
  connectionState: "connected" | "connecting" | "offline";
  browserViewSupport(serverId: string): { view: boolean; clipboard: boolean; contextMenu: boolean };
}
const snapshot: WorkspaceSnapshot = { connectionState: "connected", browserViewSupport: () => ({ view: false, clipboard: false, contextMenu: false }) };

/** The OpenBot screens read their server state through this selector; DS Bot has no browser view. */
export function useMobileWorkspaceSelector<T>(select: (current: WorkspaceSnapshot) => T): T {
  return select(snapshot);
}
