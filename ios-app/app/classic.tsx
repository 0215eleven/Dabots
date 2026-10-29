import { router, Stack } from 'expo-router';
import { Typography } from 'heroui-native';
import { SettingsContent, SettingsRow, SettingsSection } from '@/features/settings/components/settings-content';
import { useDs } from '../src/ds/provider';
import { Unavailable } from '../src/ds/routes';
import { tr } from '../src/i18n';
/** Explicit owner-granted DSH Agent surface, separate from Bots and groups. */
export default function LegacyAgents() { const { view } = useDs(); if (!view?.capabilities.agents)
    return <Unavailable />; return <SettingsContent><Stack.Screen options={{ title: 'DSH Agent' }}/><SettingsSection title="DSH Agent">{view.agents.map(agent => <SettingsRow key={agent.id} onPress={() => router.push({ pathname: '/legacy-agent/[id]', params: { id: agent.id } })}><Typography.Paragraph>{agent.name}</Typography.Paragraph></SettingsRow>)}</SettingsSection>{!view.agents.length ? <Typography.Paragraph>{tr('No conversations')}</Typography.Paragraph> : null}</SettingsContent>; }
