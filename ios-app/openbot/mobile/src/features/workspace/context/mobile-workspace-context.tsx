// DS activation: provider ownership remains in src/session and src/ds/provider.
// The complete upstream account/WebRTC provider is preserved under openbot/adaptations/original.
export {useMobileWorkspace,useMobileWorkspaceActions,useMobileWorkspaceReader,useMobileWorkspaceSelector} from './workspace-store';
export type {MobileAgent,MobileServer,MobileServerDirectoryState,MobileWorkspaceActions,MobileWorkspaceContextValue,MobileWorkspaceState} from '../model/workspace-types';
