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
    const [edits, setEdits] = useState<DsGroupPatch>({});
    const current = { name: '', notice: '', mode: 'admin' as const, members: [] as string[], admin: null as string | null, ...group, ...edits };
    const {name, notice, mode, members, admin} = current;
    const change = (patch: DsGroupPatch) => setEdits(old => ({...old, ...patch}));
    const dirty = Object.keys(edits).length > 0;
    const form = useDsForm(dirty);
    const available = online && view?.serverId === owner && !view?.readOnly && view?.capabilities.actions.includes(group ? 'update-room' : 'create-room');
    const submit = () => void form.submit(async () => { if (!commands || !available)
        throw Error('This computer is unavailable.'); if (group) {
        await commands.updateGroup(group.id, edits);
    }
    else
        await commands.createGroup({ name, members, ...(admin ? { admin } : {}) }); }, () => router.back());
    return <SheetScrollView className="bg-sheet" contentContainerClassName="gap-5 px-5 pb-safe-offset-5" keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
  <SheetFormField label={tr("Group name")} value={name} onChangeText={name => change({name})} editable={!form.saving}/>
  {group ? <><SheetFormField label={tr("Notice")} value={notice} onChangeText={notice => change({notice})} editable={!form.saving} multiline/><SettingsSection title={tr("Who responds")}><View className="flex-row gap-2 p-3">{(['admin', 'everyone'] as const).map(value => <Button key={value} variant={mode === value ? 'primary' : 'secondary'} isDisabled={form.saving} onPress={() => change({mode: value})}><Button.Label>{value}</Button.Label></Button>)}</View></SettingsSection></> : null}
  <SettingsSection title={tr("Members")}>{agents.map(agent => <MemberChoice key={agent.id} id={agent.id} name={agent.name} serverId={agent.serverId} avatarSeed={agent.avatarSeed} avatarHue={agent.avatarHue} selected={members.includes(agent.id)} disabled={form.saving} onToggle={id => { change({members: members.includes(id) ? members.filter(x => x !== id) : [...members, id], ...(admin === id ? {admin: null} : {})}); }}/>)}</SettingsSection>
  <SettingsSection title={tr("Group lead")}><View className="flex-row flex-wrap gap-2 p-3">{agents.filter(a => members.includes(a.id)).map(agent => <Button key={agent.id} variant={admin === agent.id ? 'primary' : 'secondary'} isDisabled={form.saving} onPress={() => change({admin: agent.id})}><Button.Label>{agent.name}</Button.Label></Button>)}</View></SettingsSection>
  {form.error ? <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">{form.error}</Typography.Paragraph> : null}
  <SheetSaveAction dirty={dirty && !form.finished} canSave={Boolean(available && members.length && !form.blocked)} pending={form.saving} label={group ? 'Save group' : 'Create group'} onSave={submit}/>
 </SheetScrollView>;
}
