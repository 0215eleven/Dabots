import type { Conversation } from '@ds-bot/mobile-sdk';
import type { TeamPage } from '../screens/TeamScreen';
import type { SettingsPage } from '../screens/SettingsScreen';

export type Route =
  | { page: 'home' }
  | { page: 'chat'; id?: string }
  | { page: 'team'; section: 'bots' | 'groups'; id?: string; create?: 'bot' | 'group'; subpage?: TeamPage }
  | { page: 'settings'; initial?: SettingsPage }
  | { page: 'agent' };

// The conversation list is the only root. Team and Settings are pushed above it
// from the settings button, like any other page.
export type Tab = 'home';
export function tabOf(route: Route): Tab | null {
  return route.page === 'home' ? 'home' : null;
}

/** The canonical root page. */
export function tabRoute(_route: Route): Route {
  return { page: 'home' };
}

export function selectConversation(
  conversations: Conversation[], selected: string, classic: boolean, chiefSession?: string,
): Conversation | undefined {
  const exact = conversations.find(item => item.id === selected);
  // An explicitly chosen Agent conversation that is not listed (yet, or any
  // more) opens nothing; falling back would put a writable chat on another one.
  if (exact || selected.startsWith('agent:')) return exact;
  return (classic
      ? conversations.find(item => item.kind === 'agent')
      : (chiefSession ? conversations.find(item => item.sessionId === chiefSession) : undefined) || conversations[0]);
}
