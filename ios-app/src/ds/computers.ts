// The paired computers for adapted OpenBot screens; the session stays DS Bot's own.
export { useSession as useComputers } from '../session/SessionProvider';
export { useComputerNames } from '../names/ComputerNamesProvider';
export { usePeerHosts } from '../session/PeerHostsProvider';
export { peerRows, type PeerRow } from '../logic/peer-hosts';
import { botAvatarColor, fallbackAvatarColor } from './presentation';
import type { Bot } from '../types';
/** The avatar color a watched computer's Bot shows, as DsProvider colors the active computer's. */
export const peerBotColor = (dark: boolean) => (bot: Bot) => botAvatarColor(bot, dark) ?? fallbackAvatarColor(bot.id, dark);
