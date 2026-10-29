import { tr } from '@ds/text';
import type { AvatarHue } from '@openbot/contracts/ipc';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Typography } from 'heroui-native';
import Check from 'lucide-react-native/icons/check';
import { memo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { BloubAvatarThumbnail } from '@/features/agents/components/bloub-avatar';
import { SettingsSection } from '@/features/settings/components/settings-content';
import { SheetFormField } from '@/shared/components/sheet-form-field';
import { SheetScrollView } from '@/shared/components/sheet-scroll-view';
import { SheetSaveAction } from '@/shared/components/sheet-save-action';
import { haptics } from '@/shared/lib/haptics';
import { useDs } from '@ds/provider';
import { useDsForm } from '@ds/form-state';
import { Unavailable } from '@ds/routes';
import type { DsGroupView, DsGroupPatch } from '@ds/contracts';
// No workspace/activity subscriptions, animation frames, or live agent avatars in this row.
const MemberChoice = memo(function MemberChoice({ id, name, serverId, avatarSeed, avatarHue, selected, disabled, onToggle, }: {
    id: string;
    name: string;
    serverId: string;
    avatarSeed: string;
    avatarHue: AvatarHue | null;
    selected: boolean;
    disabled: boolean;
    onToggle: (id: string) => void;
}) {
    const accent = String(useCSSVariable("--openbot-accent"));
    return (<Pressable accessibilityRole="checkbox" accessibilityLabel={name} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={() => {
            void haptics.selection();
            onToggle(id);
        }} className="min-h-12 flex-row items-center gap-3 px-4 py-3">
      <BloubAvatarThumbnail agentId={id} serverId={serverId} seed={avatarSeed} hue={avatarHue} size={32}/>
      <Typography.Paragraph className="flex-1">{name}</Typography.Paragraph>
      {selected ? <Check size={18} color={accent} strokeWidth={2}/> : null}
    </Pressable>);
});
export function ChannelFormScreen({ create = false }: {
    create?: boolean;
}) {
    const { channelId } = useLocalSearchParams<{
        channelId?: string;
    }>();
    const { view } = useDs();
    const group = view?.groups.find(g => g.id === channelId);
    return create || group ? <ChannelForm key={group?.id ?? view?.serverId} group={group}/> : <Unavailable />;
}
function ChannelForm({ group }: {
    group?: DsGroupView;
}) {
    const { view, commands, online, agents } = useDs();
    const [owner] = useState(view?.serverId);
    const [name, setName] = useState(group?.name ?? ''), [notice, setNotice] = useState(group?.notice ?? ''), [mode, setMode] = useState<'admin' | 'everyone'>(group?.mode === 'everyone' ? 'everyone' : 'admin'), [members, setMembers] = useState(group?.members ?? []), [admin, setAdmin] = useState(group?.admin ?? null);
    const dirty = name !== (group?.name ?? '') || notice !== (group?.notice ?? '') || mode !== (group?.mode ?? 'admin') || JSON.stringify(members) !== JSON.stringify(group?.members ?? []) || admin !== (group?.admin ?? null);
    const form = useDsForm(dirty);
    const available = online && view?.serverId === owner && !view?.readOnly && view?.capabilities.actions.includes(group ? 'update-room' : 'create-room');
    const submit = () => void form.submit(async () => { if (!commands || !available)
        throw Error('This computer is unavailable.'); if (group) {
        const patch: DsGroupPatch = {};
        if (name !== group.name)
            patch.name = name;
        if (notice !== (group.notice ?? ''))
            patch.notice = notice;
        if (mode !== group.mode)
            patch.mode = mode;
        if (JSON.stringify(members) !== JSON.stringify(group.members))
            patch.members = members;
        if (admin !== group.admin)
            patch.admin = admin;
        await commands.updateGroup(group.id, patch);
    }
    else
        await commands.createGroup({ name, members, ...(admin ? { admin } : {}) }); }, () => router.back());
    return <SheetScrollView className="bg-sheet" contentContainerClassName="gap-5 px-5 pb-safe-offset-5" keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
  <SheetFormField label={tr("Group name")} value={name} onChangeText={setName} editable={!form.saving}/>
  {group ? <><SheetFormField label={tr("Notice")} value={notice} onChangeText={setNotice} editable={!form.saving} multiline/><SettingsSection title={tr("Who responds")}><View className="flex-row gap-2 p-3">{(['admin', 'everyone'] as const).map(value => <Button key={value} variant={mode === value ? 'primary' : 'secondary'} isDisabled={form.saving} onPress={() => setMode(value)}><Button.Label>{value}</Button.Label></Button>)}</View></SettingsSection></> : null}
  <SettingsSection title={tr("Members")}>{agents.map(agent => <MemberChoice key={agent.id} id={agent.id} name={agent.name} serverId={agent.serverId} avatarSeed={agent.avatarSeed} avatarHue={agent.avatarHue} selected={members.includes(agent.id)} disabled={form.saving} onToggle={id => { setMembers(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id]); if (admin === id)
        setAdmin(null); }}/>)}</SettingsSection>
  <SettingsSection title={tr("Group lead")}><View className="flex-row flex-wrap gap-2 p-3">{agents.filter(a => members.includes(a.id)).map(agent => <Button key={agent.id} variant={admin === agent.id ? 'primary' : 'secondary'} isDisabled={form.saving} onPress={() => setAdmin(agent.id)}><Button.Label>{agent.name}</Button.Label></Button>)}</View></SettingsSection>
  {form.error ? <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">{form.error}</Typography.Paragraph> : null}
  <SheetSaveAction dirty={dirty && !form.finished} canSave={Boolean(available && members.length && !form.blocked)} pending={form.saving} label={group ? 'Save group' : 'Create group'} onSave={submit}/>
 </SheetScrollView>;
}
