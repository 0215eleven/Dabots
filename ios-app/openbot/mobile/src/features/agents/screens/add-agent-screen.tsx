import { useDsText } from '@ds/text';
import { avatarHueSwatch } from '@openbot/brand/bloub-avatar';
import type { AvatarHue } from '@openbot/contracts/ipc';
import { router } from 'expo-router';
import { Typography } from 'heroui-native';
import { useState } from 'react';
import { AgentAppearancePicker } from '@/features/agents/components/agent-appearance-picker';
import { SheetFormField } from '@/shared/components/sheet-form-field';
import { SheetScrollView } from '@/shared/components/sheet-scroll-view';
import { SheetSaveAction } from '@/shared/components/sheet-save-action';
import { DsModelFields, type ModelChoice } from '@ds/model-fields';
import { useDs } from '@ds/provider';
import { useDsForm } from '@ds/form-state';
/** Original appearance/form/sheet composition; DS owns fields and persistence. */
export function AddAgentScreen() {
    const { commands, online, view } = useDs();
    const { tr } = useDsText();
    const [name, setName] = useState(''), [role, setRole] = useState(''), [instructions, setInstructions] = useState(''), [seed, setSeed] = useState('ds-bot'), [color, setColor] = useState(''), [runtime, setRuntime] = useState<ModelChoice>({});
    const [hue, setHue] = useState<AvatarHue | null>(null);
    const [owner] = useState(view?.serverId);
    const dirty = Boolean(name || role || instructions || color || runtime.model || seed !== 'ds-bot');
    const form = useDsForm(dirty);
    const available = online && view?.serverId === owner && !view?.readOnly && view?.capabilities.actions.includes('create-bot');
    const submit = () => void form.submit(async () => { if (!commands || !available)
        throw Error('This computer is unavailable.'); await commands.createBot({ name, role, instructions, avatar: { shape: seed }, ...(color ? { color } : {}), ...runtime }); }, () => router.back());
    return <SheetScrollView className="bg-sheet" contentContainerClassName="gap-5 px-5 pb-safe-offset-5" keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
  <AgentAppearancePicker seed={seed} hue={hue} name={name} nameField={<SheetFormField label={tr("Bot name")} value={name} onChangeText={setName} editable={!form.saving}/>} disabled={form.saving} onSeedChange={setSeed} onHueChange={value => { setHue(value); setColor(value === null ? '' : avatarHueSwatch(value)); }} showFaces={true}/>
  <SheetFormField label={tr("Role")} value={role} onChangeText={setRole} editable={!form.saving}/><SheetFormField label={tr("Instructions")} value={instructions} onChangeText={setInstructions} editable={!form.saving} multiline/><SheetFormField label={tr("Color")} value={color} onChangeText={setColor} editable={!form.saving}/>
  <DsModelFields value={runtime} onChange={setRuntime} disabled={form.saving || !available}/>
  {form.error ? <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">{tr(form.error)}</Typography.Paragraph> : null}
  <SheetSaveAction dirty={dirty && !form.finished} canSave={Boolean(name.trim() && available && !form.blocked)} pending={form.saving} label={tr("Create Bot")} onSave={submit}/>
 </SheetScrollView>;
}
